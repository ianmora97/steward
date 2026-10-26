import type { LiveLogsEndEvent, LiveLogsEvent, LogLine, LokiLiveSubscription } from '@shared/schemas/observability';
import { StewardServiceError } from '@shared/types/result';
import { uuidv7 } from '../db/id';
import { translateObservabilityError } from './observability-errors';
import type { ResolvedSource } from './observability-provider';
import { compareNs, msToNs, type LokiProvider } from './provider-loki';

/** Loki's tail is a WebSocket that needs authentication headers; polling every two seconds is enough for a person reading. */
const POLL_MS = 2000;
const CATCH_UP_MS = 250;
const MAX_BACKOFF_MS = 16_000;
const MAX_FAILURES = 3;
export const MAX_LIVE_SUBSCRIPTIONS = 3;
const PAGE = 1000;

export interface LiveLogsDeps {
  loki: LokiProvider;
  resolve: (sourceId: string) => ResolvedSource;
  emit: (event: LiveLogsEvent) => void;
  emitEnd: (event: LiveLogsEndEvent) => void;
}

interface Tail {
  sourceId: string;
  query: string;
  /** The timestamp of the newest line delivered. Each poll asks from here, so no line is skipped. */
  cursorNs: string;
  /** Lines already delivered that share the cursor's timestamp: the next poll returns them again. */
  seenAtCursor: Set<string>;
  timer: NodeJS.Timeout | null;
  abort: AbortController;
  failures: number;
}

function lineKey(line: LogLine): string {
  return `${line.tsNs}\u0000${line.line}\u0000${JSON.stringify(line.labels)}`;
}

/**
 * Live logs by polling: `query_range` forward from the newest line seen. Lines that share the cursor's
 * nanosecond come back on the next poll, so they are told apart from new ones by content.
 */
export function createObservabilityLive(deps: LiveLogsDeps) {
  const tails = new Map<string, Tail>();

  function finish(subscriptionId: string, reason: string | null): void {
    const tail = tails.get(subscriptionId);
    if (tail === undefined) return;
    if (tail.timer !== null) clearTimeout(tail.timer);
    tail.abort.abort();
    tails.delete(subscriptionId);
    if (reason !== null) deps.emitEnd({ subscriptionId, reason });
  }

  function schedule(subscriptionId: string, delayMs: number): void {
    const tail = tails.get(subscriptionId);
    if (tail === undefined) return;
    tail.timer = setTimeout(() => void poll(subscriptionId), delayMs);
  }

  async function poll(subscriptionId: string): Promise<void> {
    const tail = tails.get(subscriptionId);
    if (tail === undefined) return;
    tail.timer = null;
    try {
      const source = deps.resolve(tail.sourceId);
      const result = await deps.loki.queryRangeNs(source, tail.query, tail.cursorNs, msToNs(Date.now() + 1000), {
        limit: PAGE,
        direction: 'forward',
        signal: tail.abort.signal
      });
      // Stopped while the request travelled.
      if (!tails.has(subscriptionId)) return;
      if (result.matrix !== null) {
        finish(subscriptionId, 'This is a metric query, which has no lines to follow.');
        return;
      }

      const fresh = result.lines.filter((line) => line.tsNs !== tail.cursorNs || !tail.seenAtCursor.has(lineKey(line)));
      tail.failures = 0;
      const newest = fresh[fresh.length - 1];
      if (newest !== undefined) {
        if (compareNs(newest.tsNs, tail.cursorNs) > 0) {
          tail.cursorNs = newest.tsNs;
          tail.seenAtCursor = new Set();
        }
        for (const line of fresh) if (line.tsNs === tail.cursorNs) tail.seenAtCursor.add(lineKey(line));
        deps.emit({ subscriptionId, lines: fresh });
      }
      // A full page means more are waiting: ask again at once instead of after the pause.
      schedule(subscriptionId, result.lines.length >= PAGE && fresh.length > 0 ? CATCH_UP_MS : POLL_MS);
    } catch (error) {
      if (!tails.has(subscriptionId) || tail.abort.signal.aborted) return;
      tail.failures += 1;
      if (tail.failures >= MAX_FAILURES) {
        const translated = translateObservabilityError(error, 'loki');
        finish(subscriptionId, `${translated.message}${translated.details === undefined ? '' : `. ${translated.details}`}`);
        return;
      }
      schedule(subscriptionId, Math.min(POLL_MS * 2 ** tail.failures, MAX_BACKOFF_MS));
    }
  }

  function start(sourceId: string, query: string): LokiLiveSubscription {
    if (tails.size >= MAX_LIVE_SUBSCRIPTIONS) {
      throw new StewardServiceError(
        'OBS_LIVE_LIMIT',
        `Only ${MAX_LIVE_SUBSCRIPTIONS} live tails can run at once`,
        'Stop one of them first.'
      );
    }
    // Fails early (unknown source, no Loki) instead of on the first poll.
    deps.resolve(sourceId);
    const subscriptionId = uuidv7();
    tails.set(subscriptionId, {
      sourceId,
      query,
      cursorNs: msToNs(Date.now()),
      seenAtCursor: new Set(),
      timer: null,
      abort: new AbortController(),
      failures: 0
    });
    schedule(subscriptionId, 0);
    return { subscriptionId };
  }

  return {
    start,
    stop: (subscriptionId: string): { subscriptionId: string } => {
      finish(subscriptionId, null);
      return { subscriptionId };
    },
    /** A source that is edited or deleted, or a project that goes: its tails would poll something that changed. */
    stopBySource: (sourceId: string, reason: string): void => {
      for (const [id, tail] of [...tails]) if (tail.sourceId === sourceId) finish(id, reason);
    },
    /** The page reloaded or the app is closing: nobody listens any more, so nothing is announced. */
    stopAll: (): void => {
      for (const id of [...tails.keys()]) finish(id, null);
    }
  };
}

export type ObservabilityLive = ReturnType<typeof createObservabilityLive>;

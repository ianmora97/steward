import {
  LOKI_DEFAULT_LIMIT,
  LOKI_MAX_LIMIT,
  LOKI_MAX_RANGE_MS,
  type ConnectionCheck,
  type LogLevel,
  type LogLine,
  type LokiLabelsResult,
  type LokiLabelValuesResult,
  type LokiQueryResult,
  type LokiVolumeResult,
  type MetricPoint,
  type MetricSeries,
  type OperationalCheck
} from '@shared/schemas/observability';
import { StewardServiceError } from '@shared/types/result';
import { assertValidRange, computeStep } from './observability-math';
import { redactObservability } from './observability-errors';
import { requestJson, type ObservabilityProvider, type ResolvedSource } from './observability-provider';

const QUERY_RANGE_TIMEOUT_MS = 30_000;
const MAX_LINE_CHARS = 8000;
const MAX_LABEL_VALUES = 2000;
const DEFAULT_LABEL_WINDOW_MS = 6 * 60 * 60 * 1000;
const VOLUME_BUCKETS = 60;
const MAX_SERIES = 50;

export interface LokiQueryOptions {
  limit?: number;
  direction?: 'backward' | 'forward';
  signal?: AbortSignal;
}

export interface LokiProvider extends ObservabilityProvider {
  /** Times are nanoseconds since the epoch as strings, which is what Loki speaks and a JavaScript number cannot hold. */
  queryRangeNs(source: ResolvedSource, query: string, startNs: string, endNs: string, options?: LokiQueryOptions): Promise<LokiQueryResult>;
  queryRange(source: ResolvedSource, query: string, fromMs: number, toMs: number, options?: LokiQueryOptions): Promise<LokiQueryResult>;
  labels(source: ResolvedSource): Promise<LokiLabelsResult>;
  labelValues(source: ResolvedSource, name: string): Promise<LokiLabelValuesResult>;
  volume(source: ResolvedSource, query: string, fromMs: number, toMs: number): Promise<LokiVolumeResult>;
}

interface Envelope<T> {
  status?: string;
  data?: T;
}

interface StreamsData {
  resultType?: string;
  result?: unknown;
}

/** Milliseconds as the nanosecond string Loki expects, without ever going through a float. */
export function msToNs(ms: number): string {
  return `${Math.trunc(ms)}000000`;
}

export function compareNs(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

const LEVEL_WORDS: [RegExp, LogLevel][] = [
  [/^(error|err|fatal|panic|critical|crit|severe|emerg|alert)$/i, 'error'],
  [/^(warn|warning)$/i, 'warn'],
  [/^(info|notice|information)$/i, 'info'],
  [/^(debug|trace|verbose)$/i, 'debug']
];

function levelFromWord(word: string): LogLevel | null {
  for (const [pattern, level] of LEVEL_WORDS) if (pattern.test(word)) return level;
  return null;
}

/** The label Loki or the agent attached if there is one; otherwise what the line itself says (`level=warn`, `"level":"error"`, `ERROR`). */
export function detectLevel(labels: Record<string, string>, line: string): LogLevel {
  for (const key of ['level', 'detected_level', 'severity', 'lvl']) {
    const value = labels[key];
    const level = value === undefined ? null : levelFromWord(value);
    if (level !== null) return level;
  }
  const keyed = /(?:\blevel|\blvl|\bseverity)["']?\s*[:=]\s*["']?([A-Za-z]+)/i.exec(line);
  const fromKey = keyed?.[1] === undefined ? null : levelFromWord(keyed[1]);
  if (fromKey !== null) return fromKey;
  const bare = /\b(FATAL|PANIC|ERROR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b/.exec(line);
  const fromWord = bare?.[1] === undefined ? null : levelFromWord(bare[1]);
  return fromWord ?? 'unknown';
}

function labelsOf(value: unknown): Record<string, string> {
  const labels: Record<string, string> = {};
  if (typeof value !== 'object' || value === null) return labels;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && item !== '') labels[key] = redactObservability(item).slice(0, 300);
  }
  return labels;
}

function unwrap<T>(envelope: Envelope<T>): T {
  if (envelope.status !== 'success' || envelope.data === undefined) {
    throw new StewardServiceError('OBS_BAD_RESPONSE', 'Loki answered with an unexpected shape');
  }
  return envelope.data;
}

function matrixOf(result: unknown): MetricSeries[] {
  if (!Array.isArray(result)) return [];
  return (result as { metric?: unknown; values?: unknown }[]).slice(0, MAX_SERIES).map((item) => {
    const points: MetricPoint[] = [];
    if (Array.isArray(item.values)) {
      for (const pair of item.values) {
        if (!Array.isArray(pair) || typeof pair[0] !== 'number') continue;
        const value = Number(pair[1]);
        points.push([Math.round(pair[0] * 1000), Number.isFinite(value) ? value : null]);
      }
    }
    return { labels: labelsOf(item.metric), points };
  });
}

function assertLokiRange(fromMs: number, toMs: number): void {
  assertValidRange(fromMs, toMs);
  if (toMs - fromMs > LOKI_MAX_RANGE_MS) {
    throw new StewardServiceError('OBS_RANGE_TOO_LARGE', 'Loki is queried 24 hours at a time at most', 'Pick a shorter range, or narrow the selector.');
  }
}

export function createLokiProvider(): LokiProvider {
  async function checkConnection(source: ResolvedSource): Promise<ConnectionCheck> {
    const now = Date.now();
    const probe = await requestJson<Envelope<string[]>>(source, {
      path: '/loki/api/v1/labels',
      query: { start: msToNs(now - 60 * 60 * 1000), end: msToNs(now) }
    });
    unwrap(probe.data);
    const info = await requestJson<{ version?: string }>(source, { path: '/loki/api/v1/status/buildinfo' }).catch(() => null);
    return {
      state: 'connected',
      version: typeof info?.data.version === 'string' ? info.data.version.slice(0, 40) : null,
      identity: null,
      latencyMs: probe.elapsedMs,
      message: null
    };
  }

  async function checkHealth(source: ResolvedSource): Promise<OperationalCheck> {
    // Loki has no alerts of its own to count: if it answers a real query it is doing its job.
    const now = Date.now();
    await requestJson<Envelope<string[]>>(source, {
      path: '/loki/api/v1/labels',
      query: { start: msToNs(now - 5 * 60 * 1000), end: msToNs(now) }
    });
    return { state: 'healthy', reasons: [] };
  }

  async function queryRangeNs(
    source: ResolvedSource,
    query: string,
    startNs: string,
    endNs: string,
    options: LokiQueryOptions = {}
  ): Promise<LokiQueryResult> {
    const limit = Math.min(options.limit ?? LOKI_DEFAULT_LIMIT, LOKI_MAX_LIMIT);
    const direction = options.direction ?? 'backward';
    const response = await requestJson<Envelope<StreamsData>>(source, {
      path: '/loki/api/v1/query_range',
      query: { query, start: startNs, end: endNs, limit: String(limit), direction },
      timeoutMs: QUERY_RANGE_TIMEOUT_MS,
      ...(options.signal === undefined ? {} : { signal: options.signal })
    });
    const data = unwrap(response.data);

    if (data.resultType === 'matrix') {
      return { lines: [], truncated: false, matrix: matrixOf(data.result) };
    }

    const lines: LogLine[] = [];
    for (const stream of Array.isArray(data.result) ? (data.result as { stream?: unknown; values?: unknown }[]) : []) {
      const labels = labelsOf(stream.stream);
      for (const entry of Array.isArray(stream.values) ? stream.values : []) {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') continue;
        const raw = entry[1].length > MAX_LINE_CHARS ? `${entry[1].slice(0, MAX_LINE_CHARS)}…` : entry[1];
        const line = redactObservability(raw);
        lines.push({ tsNs: entry[0], line, labels, level: detectLevel(labels, line) });
      }
    }
    lines.sort((a, b) => (direction === 'forward' ? compareNs(a.tsNs, b.tsNs) : compareNs(b.tsNs, a.tsNs)));
    return { lines: lines.slice(0, limit), truncated: lines.length >= limit, matrix: null };
  }

  async function queryRange(
    source: ResolvedSource,
    query: string,
    fromMs: number,
    toMs: number,
    options: LokiQueryOptions = {}
  ): Promise<LokiQueryResult> {
    assertLokiRange(fromMs, toMs);
    return queryRangeNs(source, query, msToNs(fromMs), msToNs(toMs), options);
  }

  async function labels(source: ResolvedSource): Promise<LokiLabelsResult> {
    const now = Date.now();
    const response = await requestJson<Envelope<string[]>>(source, {
      path: '/loki/api/v1/labels',
      query: { start: msToNs(now - DEFAULT_LABEL_WINDOW_MS), end: msToNs(now) }
    });
    const names = unwrap(response.data).filter((name): name is string => typeof name === 'string');
    return { labels: names.sort((a, b) => a.localeCompare(b)) };
  }

  async function labelValues(source: ResolvedSource, name: string): Promise<LokiLabelValuesResult> {
    const now = Date.now();
    const response = await requestJson<Envelope<string[]>>(source, {
      path: `/loki/api/v1/label/${encodeURIComponent(name)}/values`,
      query: { start: msToNs(now - DEFAULT_LABEL_WINDOW_MS), end: msToNs(now) }
    });
    const values = unwrap(response.data).filter((value): value is string => typeof value === 'string');
    return { values: values.slice(0, MAX_LABEL_VALUES).map((value) => redactObservability(value).slice(0, 300)), truncated: values.length > MAX_LABEL_VALUES };
  }

  /** How many lines matched, per slice of the range: the histogram above the log list. */
  async function volume(source: ResolvedSource, query: string, fromMs: number, toMs: number): Promise<LokiVolumeResult> {
    assertLokiRange(fromMs, toMs);
    const step = computeStep(fromMs, toMs, { targetPoints: VOLUME_BUCKETS });
    const response = await requestJson<Envelope<StreamsData>>(source, {
      path: '/loki/api/v1/query_range',
      query: { query: `sum(count_over_time(${query} [${step}s]))`, start: msToNs(fromMs), end: msToNs(toMs), step: String(step) },
      timeoutMs: QUERY_RANGE_TIMEOUT_MS
    });
    return { series: matrixOf(unwrap(response.data).result), stepSeconds: step };
  }

  return { kind: 'loki', capabilities: ['logs'], checkConnection, checkHealth, queryRangeNs, queryRange, labels, labelValues, volume };
}

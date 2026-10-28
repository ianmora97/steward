import { StewardServiceError } from '@shared/types/result';
import { findCheck, listChecksByProject, listEnabledChecks, type CheckResultRecord } from '../db/cloud.repo';
import type { SqlDatabase } from '../db/driver';

/** Checks running at once, in the whole app. */
const MAX_PARALLEL = 4;
const TICK_MS = 5000;
/** More than this between two ticks means the computer slept: nothing is "late", everything starts afresh. */
const SLEEP_GAP_MS = 60_000;
/** The first run of every check is spread over this long, so opening the app is not a burst. */
const MAX_STAGGER_MS = 30_000;
/** A check that was just created or edited runs almost at once. */
const SOON_MS = 2000;

export interface CheckSchedulerDeps {
  db: SqlDatabase;
  run: (checkId: string, signal: AbortSignal) => Promise<CheckResultRecord | null>;
  now?: () => number;
}

interface Running {
  controller: AbortController;
  promise: Promise<CheckResultRecord | null>;
}

/**
 * Runs the enabled checks while the app is open. Each check is due `interval` after its last run finished (not at a
 * fixed rate), so a slow destination never piles runs up, and after the computer wakes every overdue check runs
 * once, not once per interval it missed. At most four run at a time; the rest wait their turn on the next tick.
 */
export function createCheckScheduler(deps: CheckSchedulerDeps) {
  const { db, run } = deps;
  const now = deps.now ?? Date.now;
  const due = new Map<string, number>();
  const running = new Map<string, Running>();
  const waiters: (() => void)[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastTick = 0;
  let stopped = false;

  function jitter(maxMs: number): number {
    return Math.floor(Math.random() * maxMs);
  }

  function dueAfter(intervalSeconds: number): number {
    return now() + intervalSeconds * 1000;
  }

  function releaseSlot(): void {
    waiters.shift()?.();
  }

  async function takeSlot(): Promise<void> {
    while (running.size >= MAX_PARALLEL) await new Promise<void>((resolve) => waiters.push(resolve));
  }

  /** Runs a check (or joins the run already in flight) and, when it ends, schedules the next one. */
  function execute(checkId: string): Promise<CheckResultRecord | null> {
    const existing = running.get(checkId);
    if (existing !== undefined) return existing.promise;

    const controller = new AbortController();
    const promise = (async () => {
      try {
        return await run(checkId, controller.signal);
      } finally {
        running.delete(checkId);
        // Read the check again: it may have been switched off, deleted or given another interval while it ran.
        const check = stopped ? null : findCheck(db, checkId);
        if (check !== null && check.enabled && due.has(checkId)) due.set(checkId, dueAfter(check.intervalSeconds));
        else due.delete(checkId);
        releaseSlot();
      }
    })();
    running.set(checkId, { controller, promise });
    return promise;
  }

  function launch(checkId: string): void {
    execute(checkId).catch((error: unknown) => {
      if (error instanceof StewardServiceError && error.code === 'CANCELLED') return;
      console.error('[steward] a scheduled check failed to run:', error);
    });
  }

  function restaggerAll(): void {
    for (const check of listEnabledChecks(db)) {
      due.set(check.id, now() + jitter(Math.min(check.intervalSeconds * 1000, MAX_STAGGER_MS)));
    }
  }

  function tick(): void {
    const current = now();
    if (lastTick !== 0 && current - lastTick > SLEEP_GAP_MS) restaggerAll();
    lastTick = current;

    const overdue = [...due.entries()].filter(([id, at]) => at <= current && !running.has(id)).sort((a, b) => a[1] - b[1]);
    for (const [id] of overdue) {
      if (running.size >= MAX_PARALLEL) break;
      launch(id);
    }
  }

  function start(): void {
    if (timer !== null) return;
    stopped = false;
    restaggerAll();
    lastTick = now();
    timer = setInterval(tick, TICK_MS);
  }

  /** Call after a check is created, edited or switched on or off: it is looked at again from the database. */
  function reschedule(checkId: string): void {
    const check = findCheck(db, checkId);
    if (check === null || !check.enabled || check.domainId === null) {
      forget(checkId);
      return;
    }
    due.set(checkId, now() + jitter(SOON_MS));
  }

  /** Stops scheduling a check and abandons the run in flight, if any. */
  function forget(checkId: string): void {
    due.delete(checkId);
    running.get(checkId)?.controller.abort();
  }

  /** Call before a project is deleted, while its checks can still be listed. */
  function forgetProject(projectId: string): void {
    for (const check of listChecksByProject(db, projectId)) forget(check.id);
  }

  /** "Run now": goes through the same limit of four as everything else, and joins a run already in flight. */
  async function runNow(checkId: string): Promise<CheckResultRecord | null> {
    if (!running.has(checkId)) await takeSlot();
    // Count the manual run from now: the check is not due again until a full interval after it.
    const check = findCheck(db, checkId);
    if (check !== null && check.enabled) due.set(checkId, dueAfter(check.intervalSeconds));
    return execute(checkId);
  }

  function shutdown(): void {
    stopped = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
    for (const { controller } of running.values()) controller.abort();
    due.clear();
    running.clear();
    waiters.length = 0;
  }

  return { start, reschedule, forget, forgetProject, runNow, shutdown };
}

export type CheckScheduler = ReturnType<typeof createCheckScheduler>;

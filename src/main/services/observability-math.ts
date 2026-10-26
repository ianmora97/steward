import { StewardServiceError } from '@shared/types/result';

/** Prometheus refuses a range query that would return more points than this per series. */
export const PROMETHEUS_MAX_POINTS = 11_000;
/** A chart of a few hundred points is as sharp as the screen can show. */
export const DEFAULT_TARGET_POINTS = 500;
export const MAX_RANGE_DAYS = 366;

const NICE_STEPS_SECONDS = [1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14_400, 21_600, 43_200, 86_400] as const;

/**
 * The step of a range query, in seconds: the smallest "round" step that keeps the answer at about
 * `targetPoints` points and, whatever the range, below the 11 000 points Prometheus accepts.
 */
export function computeStep(
  fromMs: number,
  toMs: number,
  options: { targetPoints?: number; maxPoints?: number } = {}
): number {
  const targetPoints = options.targetPoints ?? DEFAULT_TARGET_POINTS;
  const maxPoints = options.maxPoints ?? PROMETHEUS_MAX_POINTS;
  const spanSeconds = Math.max(1, (toMs - fromMs) / 1000);
  const wanted = Math.max(spanSeconds / targetPoints, spanSeconds / maxPoints, 1);
  const nice = NICE_STEPS_SECONDS.find((step) => step >= wanted);
  return nice ?? Math.ceil(wanted);
}

/**
 * The common sense every range query shares: the start comes before the end, the end is not in the far
 * future, and the span is a year at most. Loki adds its own, tighter limit on top.
 */
export function assertValidRange(fromMs: number, toMs: number, nowMs: number = Date.now()): void {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    throw new StewardServiceError('VALIDATION_FAILED', 'The time range is not valid');
  }
  if (fromMs >= toMs) {
    throw new StewardServiceError('VALIDATION_FAILED', 'The start of the range must be before its end', 'Swap the two dates or pick a preset.');
  }
  if (toMs > nowMs + 60_000) {
    throw new StewardServiceError('VALIDATION_FAILED', 'The end of the range is in the future', 'Pick a range that ends now or earlier.');
  }
  if (toMs - fromMs > MAX_RANGE_DAYS * 86_400_000) {
    throw new StewardServiceError('OBS_RANGE_TOO_LARGE', 'That range is longer than a year', 'Pick a shorter range.');
  }
}

export interface WindowComparison {
  before: number | null;
  after: number | null;
  /** The change from `before` to `after`, in percent of `before`. Null when `before` is missing or zero: no invented number. */
  changePct: number | null;
}

function meanBetween(points: readonly (readonly [number, number | null])[], fromMs: number, toMs: number): number | null {
  let sum = 0;
  let count = 0;
  for (const [at, value] of points) {
    if (value === null || at < fromMs || at >= toMs) continue;
    sum += value;
    count += 1;
  }
  return count === 0 ? null : sum / count;
}

/**
 * The mean of a signal in the window before a moment against the mean in an equally long window after it.
 * Plain arithmetic the user can redo on a graph; it says nothing about what caused the difference.
 */
export function compareWindows(points: readonly (readonly [number, number | null])[], atMs: number, windowMs: number): WindowComparison {
  const before = meanBetween(points, atMs - windowMs, atMs);
  const after = meanBetween(points, atMs, atMs + windowMs);
  const changePct = before === null || after === null || before === 0 ? null : ((after - before) / Math.abs(before)) * 100;
  return { before, after, changePct };
}

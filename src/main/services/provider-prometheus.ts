import type {
  ConnectionCheck,
  MetricPoint,
  MetricSeries,
  ObservabilityAlert,
  OperationalCheck,
  PrometheusInstantResult,
  PrometheusMetricNamesResult,
  PrometheusRangeResult,
  PrometheusTargetsResult
} from '@shared/schemas/observability';
import { StewardServiceError } from '@shared/types/result';
import { assertValidRange, computeStep, PROMETHEUS_MAX_POINTS } from './observability-math';
import { redactObservability, translateObservabilityError } from './observability-errors';
import { requestJson, type ObservabilityProvider, type ResolvedSource } from './observability-provider';

const QUERY_RANGE_TIMEOUT_MS = 30_000;
const MAX_SERIES = 50;
const MAX_SAMPLES = 500;
const MAX_TARGETS = 500;
const MAX_ALERTS = 500;
const MAX_METRIC_NAMES = 20_000;
const SUGGESTIONS = 20;
const NAMES_CACHE_MS = 60_000;

export interface PrometheusProvider extends ObservabilityProvider {
  queryInstant(source: ResolvedSource, query: string, timeMs?: number): Promise<PrometheusInstantResult>;
  queryRange(source: ResolvedSource, query: string, fromMs: number, toMs: number, stepSeconds?: number): Promise<PrometheusRangeResult>;
  targets(source: ResolvedSource): Promise<PrometheusTargetsResult>;
  alerts(source: ResolvedSource): Promise<ObservabilityAlert[]>;
  metricNames(source: ResolvedSource, prefix?: string): Promise<PrometheusMetricNamesResult>;
}

interface Envelope<T> {
  status?: string;
  data?: T;
  error?: string;
}

interface MatrixResult {
  resultType?: string;
  result?: unknown;
}

function text(value: unknown, max = 500): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const safe = redactObservability(value);
  return safe.length > max ? `${safe.slice(0, max)}…` : safe;
}

function labelsOf(value: unknown): Record<string, string> {
  const labels: Record<string, string> = {};
  if (typeof value !== 'object' || value === null) return labels;
  for (const [key, item] of Object.entries(value)) {
    const safe = text(item, 200);
    if (safe !== null) labels[key] = safe;
  }
  return labels;
}

function numberOrNull(raw: unknown): number | null {
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

/** `[unix seconds, "value"]` pairs → `[ms, number | null]`. */
function pointsOf(values: unknown): MetricPoint[] {
  if (!Array.isArray(values)) return [];
  const points: MetricPoint[] = [];
  for (const pair of values) {
    if (!Array.isArray(pair) || typeof pair[0] !== 'number') continue;
    points.push([Math.round(pair[0] * 1000), numberOrNull(pair[1])]);
  }
  return points;
}

function unwrap<T>(envelope: Envelope<T>): T {
  if (envelope.status !== 'success' || envelope.data === undefined) {
    throw new StewardServiceError(
      'OBS_BAD_QUERY',
      'Prometheus did not accept the query',
      envelope.error === undefined ? undefined : (text(envelope.error) ?? undefined)
    );
  }
  return envelope.data;
}

export function createPrometheusProvider(): PrometheusProvider {
  const namesCache = new Map<string, { at: number; names: string[]; truncated: boolean }>();

  async function checkConnection(source: ResolvedSource): Promise<ConnectionCheck> {
    const probe = await requestJson<Envelope<unknown>>(source, { path: '/api/v1/query', query: { query: 'vector(1)' } });
    unwrap(probe.data);
    // Prometheus-compatible servers (Thanos, VictoriaMetrics, Mimir) may not offer buildinfo; the version is a nicety.
    const info = await requestJson<Envelope<{ version?: string }>>(source, { path: '/api/v1/status/buildinfo' }).catch(() => null);
    return {
      state: 'connected',
      version: text(info?.data.data?.version, 40),
      identity: null,
      latencyMs: probe.elapsedMs,
      message: null
    };
  }

  async function checkHealth(source: ResolvedSource): Promise<OperationalCheck> {
    const reasons: string[] = [];
    let answered = 0;
    try {
      const response = await requestJson<Envelope<{ activeTargets?: { health?: string }[] }>>(source, {
        path: '/api/v1/targets',
        query: { state: 'active' }
      });
      const down = (unwrap(response.data).activeTargets ?? []).filter((target) => target.health === 'down').length;
      if (down > 0) reasons.push(`${down} ${down === 1 ? 'target is' : 'targets are'} down`);
      answered += 1;
    } catch (error) {
      if (translateObservabilityError(error, 'prometheus').code === 'OBS_AUTH_FAILED') throw error;
    }
    try {
      const response = await requestJson<Envelope<{ alerts?: { state?: string }[] }>>(source, { path: '/api/v1/alerts' });
      const firing = (unwrap(response.data).alerts ?? []).filter((alert) => alert.state === 'firing').length;
      if (firing > 0) reasons.push(`${firing} ${firing === 1 ? 'alert is' : 'alerts are'} firing`);
      answered += 1;
    } catch (error) {
      if (translateObservabilityError(error, 'prometheus').code === 'OBS_AUTH_FAILED') throw error;
    }
    // With neither endpoint readable, "healthy" would be a guess.
    if (answered === 0) return { state: 'unknown', reasons: ['Prometheus did not answer the targets or alerts endpoints'] };
    return reasons.length === 0 ? { state: 'healthy', reasons } : { state: 'degraded', reasons };
  }

  async function queryInstant(source: ResolvedSource, query: string, timeMs?: number): Promise<PrometheusInstantResult> {
    const response = await requestJson<Envelope<MatrixResult>>(source, {
      path: '/api/v1/query',
      query: { query, ...(timeMs === undefined ? {} : { time: String(timeMs / 1000) }) }
    });
    const data = unwrap(response.data);
    const resultType = data.resultType ?? 'vector';
    const samples: PrometheusInstantResult['samples'] = [];
    let total = 0;

    if (resultType === 'vector' && Array.isArray(data.result)) {
      for (const item of data.result as { metric?: unknown; value?: unknown[] }[]) {
        total += 1;
        if (samples.length >= MAX_SAMPLES || !Array.isArray(item.value) || typeof item.value[0] !== 'number') continue;
        samples.push({ labels: labelsOf(item.metric), timeMs: Math.round(item.value[0] * 1000), text: String(item.value[1] ?? '') });
      }
    } else if ((resultType === 'scalar' || resultType === 'string') && Array.isArray(data.result) && typeof data.result[0] === 'number') {
      total = 1;
      samples.push({ labels: {}, timeMs: Math.round(data.result[0] * 1000), text: String(data.result[1] ?? '') });
    } else if (resultType === 'matrix') {
      throw new StewardServiceError(
        'OBS_BAD_QUERY',
        'That query returns a range of values',
        'Remove the [duration] selector or wrap it in a function such as rate(...).'
      );
    }
    return { resultType, samples, totalSamples: total, truncated: total > samples.length };
  }

  async function queryRange(
    source: ResolvedSource,
    query: string,
    fromMs: number,
    toMs: number,
    stepSeconds?: number
  ): Promise<PrometheusRangeResult> {
    assertValidRange(fromMs, toMs);
    // Never finer than the step that keeps the answer under what Prometheus accepts.
    const floor = computeStep(fromMs, toMs, { targetPoints: PROMETHEUS_MAX_POINTS });
    const step = stepSeconds === undefined ? computeStep(fromMs, toMs) : Math.max(stepSeconds, floor);
    const response = await requestJson<Envelope<MatrixResult>>(source, {
      path: '/api/v1/query_range',
      query: { query, start: String(fromMs / 1000), end: String(toMs / 1000), step: String(step) },
      timeoutMs: QUERY_RANGE_TIMEOUT_MS
    });
    const data = unwrap(response.data);
    const all = Array.isArray(data.result) ? (data.result as { metric?: unknown; values?: unknown }[]) : [];
    const series: MetricSeries[] = all.slice(0, MAX_SERIES).map((item) => ({ labels: labelsOf(item.metric), points: pointsOf(item.values) }));
    return { series, fromMs, toMs, stepSeconds: step, totalSeries: all.length, truncated: all.length > series.length };
  }

  async function targets(source: ResolvedSource): Promise<PrometheusTargetsResult> {
    const response = await requestJson<
      Envelope<{ activeTargets?: { labels?: unknown; health?: string; lastError?: string; lastScrape?: string }[] }>
    >(source, { path: '/api/v1/targets', query: { state: 'active' } });
    const all = unwrap(response.data).activeTargets ?? [];
    const order: Record<'up' | 'down' | 'unknown', number> = { down: 0, unknown: 1, up: 2 };
    const mapped = all.map((target) => {
      const labels = labelsOf(target.labels);
      const health: 'up' | 'down' | 'unknown' = target.health === 'up' || target.health === 'down' ? target.health : 'unknown';
      return {
        job: labels['job'] ?? '',
        instance: labels['instance'] ?? '',
        health,
        lastError: text(target.lastError),
        lastScrape: text(target.lastScrape, 40),
        labels
      };
    });
    mapped.sort((a, b) => order[a.health] - order[b.health] || a.job.localeCompare(b.job) || a.instance.localeCompare(b.instance));
    return { targets: mapped.slice(0, MAX_TARGETS), totalTargets: mapped.length, truncated: mapped.length > MAX_TARGETS };
  }

  async function alerts(source: ResolvedSource): Promise<ObservabilityAlert[]> {
    const response = await requestJson<
      Envelope<{ alerts?: { labels?: unknown; annotations?: unknown; state?: string; activeAt?: string }[] }>
    >(source, { path: '/api/v1/alerts' });
    const all = (unwrap(response.data).alerts ?? []).filter((alert) => alert.state === 'firing' || alert.state === 'pending');
    return all.slice(0, MAX_ALERTS).map((alert, index) => {
      const labels = labelsOf(alert.labels);
      const annotations = labelsOf(alert.annotations);
      return {
        id: `${labels['alertname'] ?? 'alert'}-${index}`,
        name: labels['alertname'] ?? 'Alert',
        state: alert.state === 'pending' ? ('pending' as const) : ('firing' as const),
        severity: labels['severity'] ?? null,
        summary: annotations['summary'] ?? annotations['description'] ?? null,
        labels,
        startsAt: text(alert.activeAt, 40)
      };
    });
  }

  async function metricNames(source: ResolvedSource, prefix?: string): Promise<PrometheusMetricNamesResult> {
    let entry = namesCache.get(source.id);
    if (entry === undefined || Date.now() - entry.at > NAMES_CACHE_MS) {
      const response = await requestJson<Envelope<string[]>>(source, { path: '/api/v1/label/__name__/values' });
      const names = unwrap(response.data).filter((name): name is string => typeof name === 'string');
      entry = { at: Date.now(), names: names.slice(0, MAX_METRIC_NAMES), truncated: names.length > MAX_METRIC_NAMES };
      namesCache.set(source.id, entry);
    }
    const needle = (prefix ?? '').toLowerCase();
    if (needle === '') return { names: entry.names.slice(0, SUGGESTIONS), truncated: entry.names.length > SUGGESTIONS };
    const starts = entry.names.filter((name) => name.toLowerCase().startsWith(needle));
    const contains = entry.names.filter((name) => !name.toLowerCase().startsWith(needle) && name.toLowerCase().includes(needle));
    const matches = [...starts, ...contains];
    return { names: matches.slice(0, SUGGESTIONS), truncated: matches.length > SUGGESTIONS };
  }

  return { kind: 'prometheus', capabilities: ['metrics', 'alerts'], checkConnection, checkHealth, queryInstant, queryRange, targets, alerts, metricNames };
}

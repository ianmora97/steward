import {
  DEFAULT_ERROR_PATTERN,
  LOKI_MAX_RANGE_MS,
  type AlertMarker,
  type ContainerState,
  type DeployMarker,
  type InvestigateInput,
  type InvestigatePreset,
  type InvestigateResult,
  type MetricSeries,
  type ObservabilityAlert,
  type ReleaseIssues,
  type SentryIssue,
  type SentryPeriod,
  type SignalComparison,
  type SignalSeries
} from '@shared/schemas/observability';
import type { DockerContainer, DockerTargetInput } from '@shared/schemas/docker';
import { StewardServiceError } from '@shared/types/result';
import { listDeploymentsByProject } from '../db/deployment.repo';
import type { SqlDatabase } from '../db/driver';
import { findEnvironmentById } from '../db/environment.repo';
import { listSourcesByProject, type ObservabilitySignalRecord, type ObservabilitySourceRecord } from '../db/observability.repo';
import { findSshHost } from '../db/ssh-host.repo';
import { renderSignalQuery, type ObservabilityCatalogService } from './observability-catalog.service';
import { translateObservabilityError } from './observability-errors';
import { assertValidRange, compareWindows } from './observability-math';
import type { ObservabilitySourceService } from './observability-source.service';
import type { GrafanaProvider } from './provider-grafana';
import type { LokiProvider } from './provider-loki';
import type { PrometheusProvider } from './provider-prometheus';
import type { SentryProvider } from './provider-sentry';
import { requireProject } from './project.service';

export interface InvestigateDeps {
  db: SqlDatabase;
  catalog: ObservabilityCatalogService;
  sources: ObservabilitySourceService;
  loki: LokiProvider;
  prometheus: PrometheusProvider;
  grafana: GrafanaProvider;
  sentry: SentryProvider;
  docker: { listContainers: (input: DockerTargetInput) => Promise<DockerContainer[]> };
}

/** Data before the window, so a deploy at its very start still has something to be compared with. */
const PAD_MS = 15 * 60_000;
const COMPARE_MS = 15 * 60_000;
const MIN_COMPARE_MS = 2 * 60_000;
const MAX_SIGNALS = 12;
const MAX_COMPARED_DEPLOYS = 5;
const ERROR_LINES = 200;
const MAX_ALERTS = 50;
const FALLBACK_WINDOW_MS = 60 * 60_000;
const MAX_ISSUES = 25;
const MAX_RELEASES = 3;
/** A release name goes into Sentry's search box, so only a plain token is allowed to: a space would add a second condition. */
const RELEASE_TOKEN = /^[A-Za-z0-9._-]{1,64}$/;

const PRESET_MS: Record<Exclude<InvestigatePreset, 'since_last_deploy'>, number> = {
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000
};

type Failure = { ok: false; code: string; message: string; details?: string };
type Section<T> = { ok: true; data: T } | Failure;

function failure(error: unknown): Failure {
  const translated = translateObservabilityError(error);
  return {
    ok: false,
    code: translated.code,
    message: translated.message,
    ...(translated.details === undefined ? {} : { details: translated.details })
  };
}

async function guarded<T>(run: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return failure(error);
  }
}

/** The source for a service: the one named, else one of the service's environment, else one with no environment. */
function pickSource(
  records: ObservabilitySourceRecord[],
  kind: ObservabilitySourceRecord['kind'],
  environmentId: string | null,
  chosenId: string | undefined
): ObservabilitySourceRecord | null {
  const ofKind = records.filter((record) => record.kind === kind);
  if (chosenId !== undefined) {
    const chosen = ofKind.find((record) => record.id === chosenId);
    if (chosen === undefined) throw new StewardServiceError('NOT_FOUND', `that ${kind} source is not in this project`);
    return chosen;
  }
  return (
    ofKind.find((record) => environmentId !== null && record.environmentId === environmentId) ??
    ofKind.find((record) => record.environmentId === null) ??
    ofKind[0] ??
    null
  );
}

/** A regular expression typed by the user, as a LogQL string: backslashes and quotes are escaped, nothing else is interpreted. */
function logqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The smallest period Sentry offers that covers the window. */
function sentryPeriodFor(spanMs: number): SentryPeriod {
  if (spanMs <= 60 * 60_000) return '1h';
  if (spanMs <= 24 * 60 * 60_000) return '24h';
  return '7d';
}

function deployLabel(deploy: DeployMarker): string {
  return deploy.ref ?? deploy.commitSha?.slice(0, 7) ?? deploy.targetName;
}

export function createObservabilityInvestigateService(deps: InvestigateDeps) {
  const { db, catalog, sources, loki, prometheus, grafana, sentry, docker } = deps;

  async function investigate(input: InvestigateInput): Promise<InvestigateResult> {
    requireProject(db, input.projectId);
    const service = catalog.requireService(input.serviceId);
    if (service.projectId !== input.projectId) throw new StewardServiceError('NOT_FOUND', 'that service is not in this project');
    const environmentName = service.environmentId === null ? null : (findEnvironmentById(db, service.environmentId)?.name ?? null);
    const records = listSourcesByProject(db, input.projectId);
    const logsRecord = pickSource(records, 'loki', service.environmentId, input.logsSourceId);
    const metricsRecord = pickSource(records, 'prometheus', service.environmentId, input.metricsSourceId);
    const grafanaRecord = pickSource(records, 'grafana', service.environmentId, undefined);
    const sentryRecord = pickSource(records, 'sentry', service.environmentId, undefined);

    // ── the window ──────────────────────────────────────────────────────────
    const now = Date.now();
    const allDeploys = listDeploymentsByProject(db, input.projectId, 200).filter(
      (deploy) => service.environmentId === null || deploy.environmentId === service.environmentId
    );
    const atOf = (deploy: (typeof allDeploys)[number]): number => Date.parse(deploy.finishedAt ?? deploy.requestedAt);

    let toMs = input.toMs ?? now;
    let fromMs: number;
    let noDeployFound = false;
    let preset: InvestigatePreset | null = input.preset ?? null;
    if (input.preset === 'since_last_deploy') {
      const last = allDeploys.filter((deploy) => deploy.status !== 'cancelled').sort((a, b) => atOf(b) - atOf(a))[0];
      if (last === undefined) {
        noDeployFound = true;
        fromMs = toMs - FALLBACK_WINDOW_MS;
      } else {
        fromMs = atOf(last);
      }
    } else if (input.preset !== undefined) {
      fromMs = toMs - PRESET_MS[input.preset];
    } else {
      fromMs = input.fromMs ?? toMs - FALLBACK_WINDOW_MS;
      toMs = input.toMs ?? now;
      preset = null;
    }
    assertValidRange(fromMs, toMs, now);
    // Loki accepts a day at most, and the padding before the window counts.
    const maxSpan = LOKI_MAX_RANGE_MS - PAD_MS;
    const clamped = toMs - fromMs > maxSpan;
    if (clamped) fromMs = toMs - maxSpan;
    const fetchFromMs = Math.max(fromMs - PAD_MS, toMs - LOKI_MAX_RANGE_MS);

    // ── deploys ─────────────────────────────────────────────────────────────
    const deployMarkers = allDeploys
      .map<DeployMarker>((deploy) => ({
        id: deploy.id,
        atMs: atOf(deploy),
        ref: deploy.ref,
        commitSha: deploy.commitSha,
        status: deploy.status,
        targetName: deploy.targetName
      }))
      .filter((deploy) => deploy.atMs >= fetchFromMs && deploy.atMs <= toMs)
      .sort((a, b) => a.atMs - b.atMs);
    const deploys: Section<DeployMarker[]> = { ok: true, data: deployMarkers };

    // ── signals ─────────────────────────────────────────────────────────────
    const signalRecords = catalog.listSignalRecords(input.projectId).slice(0, MAX_SIGNALS);

    async function fetchSignal(signal: ObservabilitySignalRecord): Promise<SignalSeries> {
      const base = { signalId: signal.id, name: signal.name, unit: signal.unit, kind: signal.kind };
      const result = await guarded(async () => {
        const query = renderSignalQuery(signal.queryTemplate, service);
        if (signal.kind === 'promql') {
          if (metricsRecord === null) throw new StewardServiceError('OBS_NOT_SUPPORTED', 'No Prometheus source for this service', 'Add one in Sources.');
          const range = await prometheus.queryRange(sources.resolved(metricsRecord.id, 'prometheus'), query, fetchFromMs, toMs);
          return { series: range.series, stepSeconds: range.stepSeconds, totalSeries: range.totalSeries, truncated: range.truncated };
        }
        if (logsRecord === null) throw new StewardServiceError('OBS_NOT_SUPPORTED', 'No Loki source for this service', 'Add one in Sources.');
        const answer = await loki.queryRange(sources.resolved(logsRecord.id, 'loki'), query, fetchFromMs, toMs);
        if (answer.matrix === null) throw new StewardServiceError('OBS_BAD_QUERY', 'This LogQL signal returns lines, not numbers', 'Wrap it in rate(...) or count_over_time(...).');
        const series: MetricSeries[] = answer.matrix;
        return { series, stepSeconds: 0, totalSeries: series.length, truncated: false };
      });
      return { ...base, result };
    }

    // ── error logs ──────────────────────────────────────────────────────────
    async function fetchErrorLogs(): Promise<{ query: string; result: Awaited<ReturnType<LokiProvider['queryRange']>> }> {
      if (logsRecord === null) throw new StewardServiceError('OBS_NOT_SUPPORTED', 'No Loki source for this service', 'Add one in Sources.');
      if (service.logSelector === null) {
        throw new StewardServiceError('VALIDATION_FAILED', 'This service has no log selector', 'Add one in the Services view, for example {app="api"}.');
      }
      const pattern = (input.errorPattern ?? '').trim() === '' ? DEFAULT_ERROR_PATTERN : (input.errorPattern ?? DEFAULT_ERROR_PATTERN);
      const query = `${service.logSelector} |~ ${logqlString(pattern)}`;
      const result = await loki.queryRange(sources.resolved(logsRecord.id, 'loki'), query, Math.max(fromMs, toMs - LOKI_MAX_RANGE_MS), toMs, {
        limit: ERROR_LINES
      });
      return { query, result };
    }

    // ── alerts ──────────────────────────────────────────────────────────────
    async function fetchAlerts(): Promise<AlertMarker[]> {
      const attempts: { name: string; run: () => Promise<ObservabilityAlert[]> }[] = [];
      if (grafanaRecord !== null) {
        attempts.push({ name: grafanaRecord.name, run: () => grafana.listAlerts(sources.resolved(grafanaRecord.id, 'grafana')) });
      }
      if (metricsRecord !== null) {
        attempts.push({ name: metricsRecord.name, run: () => prometheus.alerts(sources.resolved(metricsRecord.id, 'prometheus')) });
      }
      if (attempts.length === 0) {
        throw new StewardServiceError('OBS_NOT_SUPPORTED', 'No Grafana or Prometheus source to read alerts from');
      }
      const settled = await Promise.allSettled(attempts.map((attempt) => attempt.run()));
      const markers: AlertMarker[] = [];
      settled.forEach((outcome, index) => {
        if (outcome.status !== 'fulfilled') return;
        for (const alert of outcome.value) {
          const startsAt = alert.startsAt === null ? Number.NaN : Date.parse(alert.startsAt);
          markers.push({
            name: alert.name,
            severity: alert.severity,
            state: alert.state,
            startsAtMs: Number.isFinite(startsAt) ? startsAt : null,
            sourceName: attempts[index]?.name ?? ''
          });
        }
      });
      // Every source failed: say so instead of showing an empty list that looks like good news.
      if (markers.length === 0 && settled.every((outcome) => outcome.status === 'rejected')) {
        const first = settled[0];
        throw first?.status === 'rejected' ? first.reason : new StewardServiceError('OBS_UNREACHABLE', 'Alerts could not be read');
      }
      return markers.slice(0, MAX_ALERTS);
    }

    // ── container ───────────────────────────────────────────────────────────
    async function fetchContainer(): Promise<ContainerState | null> {
      if (service.sshHostId === null || service.dockerContainer === null) return null;
      const host = findSshHost(db, service.sshHostId);
      if (host === null) return null;
      const containers = await docker.listContainers({ projectId: input.projectId, target: { kind: 'ssh', sshHostId: host.id } });
      const found = containers.find((container) => container.name === service.dockerContainer);
      return found === undefined
        ? { name: service.dockerContainer, state: 'missing', status: 'No container with that name on the server', image: '', serverName: host.name }
        : { name: found.name, state: found.state, status: found.status, image: found.image, serverName: host.name };
    }

    // ── Sentry ──────────────────────────────────────────────────────────────
    async function fetchIssues(): Promise<{ issues: SentryIssue[]; byRelease: ReleaseIssues[] }> {
      if (sentryRecord === null) throw new StewardServiceError('OBS_NOT_SUPPORTED', 'No Sentry source for this service');
      const resolved = sources.resolved(sentryRecord.id, 'sentry');
      const listed = await sentry.listIssues(resolved, { query: 'is:unresolved', statsPeriod: sentryPeriodFor(toMs - fromMs), limit: MAX_ISSUES });
      const issues = listed.issues.filter((issue) => issue.lastSeenMs === null || issue.lastSeenMs >= fromMs);

      // What each recent deploy's release brought: only deploys that know their commit can be matched to a release.
      const withCommit = deployMarkers.filter((deploy) => deploy.commitSha !== null && RELEASE_TOKEN.test(deploy.commitSha)).slice(-MAX_RELEASES);
      const settled = await Promise.allSettled(
        withCommit.map(async (deploy): Promise<ReleaseIssues> => {
          const release = deploy.commitSha ?? '';
          const found = await sentry.listIssues(resolved, { query: `is:unresolved release:${release}`, statsPeriod: '14d', limit: 10 });
          return { deployId: deploy.id, release, count: found.issues.length, titles: found.issues.slice(0, 3).map((issue) => issue.title) };
        })
      );
      const byRelease = settled.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []));
      return { issues, byRelease };
    }

    const [signals, errorLogs, alerts, container, issues] = await Promise.all([
      Promise.all(signalRecords.map(fetchSignal)),
      guarded(fetchErrorLogs),
      guarded(fetchAlerts),
      guarded(fetchContainer),
      guarded(fetchIssues)
    ]);

    // ── before / after each deploy ──────────────────────────────────────────
    const comparison: SignalComparison[] = [];
    const finished = deployMarkers.filter((deploy) => deploy.status === 'succeeded' || deploy.status === 'failed').slice(-MAX_COMPARED_DEPLOYS);
    for (const deploy of finished) {
      const windowMs = Math.min(COMPARE_MS, toMs - deploy.atMs);
      for (const signal of signals) {
        if (!signal.result.ok) continue;
        const row = {
          signalId: signal.signalId,
          signalName: signal.name,
          unit: signal.unit,
          deployId: deploy.id,
          deployAtMs: deploy.atMs,
          deployLabel: deployLabel(deploy),
          windowMinutes: Math.max(0, Math.round(windowMs / 60_000))
        };
        if (windowMs < MIN_COMPARE_MS) {
          comparison.push({ ...row, before: null, after: null, changePct: null, note: 'too_recent' });
          continue;
        }
        const points = signal.result.data.series.flatMap((series) => series.points);
        const compared = compareWindows(points, deploy.atMs, windowMs);
        comparison.push({ ...row, ...compared, note: compared.before === null || compared.after === null ? 'no_data' : 'ok' });
      }
    }

    return {
      window: { fromMs, fetchFromMs, toMs, preset, clamped, noDeployFound },
      service: { id: service.id, name: service.name, environmentName },
      sources: {
        logs: logsRecord === null ? null : { id: logsRecord.id, name: logsRecord.name },
        metrics: metricsRecord === null ? null : { id: metricsRecord.id, name: metricsRecord.name }
      },
      deploys,
      alerts,
      signals,
      errorLogs,
      container,
      issues,
      comparison
    };
  }

  return { investigate };
}

export type ObservabilityInvestigateService = ReturnType<typeof createObservabilityInvestigateService>;

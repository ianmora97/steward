import type {
  GrafanaDashboardsInput,
  GrafanaSourceInput,
  InvestigateInput,
  LiveLogsEndEvent,
  LiveLogsEvent,
  LokiLabelValuesInput,
  LokiLiveStartInput,
  LokiLiveStopInput,
  LokiQueryInput,
  LokiSourceInput,
  LokiVolumeInput,
  ObservabilityCapability,
  ObservabilityKind,
  ObservabilityOpenUrlInput,
  ObservabilityPickedFile,
  ObservabilityPickFileInput,
  ObservabilityServiceCreateInput,
  ObservabilityServiceIdInput,
  ObservabilityServiceListInput,
  ObservabilityServiceUpdateInput,
  ObservabilitySignalCreateInput,
  ObservabilitySignalIdInput,
  ObservabilitySignalListInput,
  ObservabilitySignalPreviewInput,
  ObservabilitySignalReorderInput,
  ObservabilitySignalUpdateInput,
  PrometheusMetricNamesInput,
  PrometheusQueryInput,
  PrometheusRangeInput,
  PrometheusSourceInput,
  SentryEventInput,
  SentryIssuesInput
} from '@shared/schemas/observability';
import type { DockerContainer, DockerTargetInput } from '@shared/schemas/docker';
import type { SqlDatabase } from '../db/driver';
import { buildUrl } from '../net/net-request';
import { validateExistingFile } from '../security/paths';
import type { SecretStore } from '../security/secret-store';
import { createObservabilityCatalogService } from './observability-catalog.service';
import { createObservabilityInvestigateService } from './observability-investigate.service';
import { createObservabilityLive } from './observability-live.service';
import { createProviderRegistry } from './observability-provider';
import { createObservabilitySourceService } from './observability-source.service';
import { createGrafanaProvider } from './provider-grafana';
import { createLokiProvider } from './provider-loki';
import { createPrometheusProvider } from './provider-prometheus';
import { createSentryProvider } from './provider-sentry';

export interface ObservabilityDialogs {
  /** Opens the OS file picker; null when the user cancels. */
  pickFile: (purpose: ObservabilityPickFileInput['purpose']) => Promise<string | null>;
}

export interface ObservabilityServiceDeps {
  db: SqlDatabase;
  secrets: SecretStore;
  dialogs: ObservabilityDialogs;
  /** Opens a web page in the default browser. */
  openExternal: (url: string) => Promise<void>;
  /** Containers of a server, to show whether a service is running. */
  docker: { listContainers: (input: DockerTargetInput) => Promise<DockerContainer[]> };
  /** Lines of a live tail, pushed to the page. */
  emitLogs: (event: LiveLogsEvent) => void;
  emitLogsEnd: (event: LiveLogsEndEvent) => void;
}

const CAPABILITIES: Record<ObservabilityKind, readonly ObservabilityCapability[]> = {
  grafana: ['dashboards', 'alerts'],
  loki: ['logs'],
  prometheus: ['metrics', 'alerts'],
  sentry: ['issues']
};

/** Monitoring as the IPC layer sees it: sources and, per tool, what it can be asked. Read-only end to end. */
export function createObservabilityService(deps: ObservabilityServiceDeps) {
  const grafana = createGrafanaProvider();
  const prometheus = createPrometheusProvider();
  const loki = createLokiProvider();
  const sentry = createSentryProvider();
  const registry = createProviderRegistry([grafana, prometheus, loki, sentry], CAPABILITIES);
  const sources = createObservabilitySourceService({ db: deps.db, secrets: deps.secrets, registry });
  const catalog = createObservabilityCatalogService({ db: deps.db });
  const investigator = createObservabilityInvestigateService({
    db: deps.db,
    catalog,
    sources,
    loki,
    prometheus,
    grafana,
    sentry,
    docker: deps.docker
  });
  const live = createObservabilityLive({
    loki,
    resolve: (sourceId) => sources.resolved(sourceId, 'loki'),
    emit: deps.emitLogs,
    emitEnd: deps.emitLogsEnd
  });

  async function pickFile(input: ObservabilityPickFileInput): Promise<ObservabilityPickedFile> {
    const chosen = await deps.dialogs.pickFile(input.purpose);
    if (chosen === null) return { cancelled: true, path: null };
    return { cancelled: false, path: validateExistingFile(chosen).path };
  }

  async function openUrl(input: ObservabilityOpenUrlInput): Promise<{ opened: true }> {
    const record = sources.recordOf(input.sourceId);
    // The page is always on the server the user configured; the renderer only chooses which page.
    const url = buildUrl(record.baseUrl, input.path ?? '/');
    await deps.openExternal(url.href);
    return { opened: true };
  }

  return {
    listSources: sources.list,
    createSource: sources.create,
    // A tail polls the source as it was when it started: if the source changes or goes, the tail ends.
    updateSource: (input: Parameters<typeof sources.update>[0]) => {
      live.stopBySource(input.id, 'The source was changed, so the live tail stopped.');
      return sources.update(input);
    },
    removeSource: (input: Parameters<typeof sources.remove>[0]) => {
      live.stopBySource(input.id, 'The source was removed.');
      return sources.remove(input);
    },
    testSource: sources.test,
    testDraft: sources.testDraft,
    pickFile,
    openUrl,
    grafanaDashboards: (input: GrafanaDashboardsInput) =>
      grafana.listDashboards(sources.resolved(input.sourceId, 'grafana'), input.query),
    grafanaDatasources: (input: GrafanaSourceInput) => grafana.listDatasources(sources.resolved(input.sourceId, 'grafana')),
    grafanaAlerts: (input: GrafanaSourceInput) => grafana.listAlerts(sources.resolved(input.sourceId, 'grafana')),
    prometheusQuery: (input: PrometheusQueryInput) =>
      prometheus.queryInstant(sources.resolved(input.sourceId, 'prometheus'), input.query, input.timeMs),
    prometheusRange: (input: PrometheusRangeInput) =>
      prometheus.queryRange(sources.resolved(input.sourceId, 'prometheus'), input.query, input.fromMs, input.toMs, input.stepSeconds),
    prometheusTargets: (input: PrometheusSourceInput) => prometheus.targets(sources.resolved(input.sourceId, 'prometheus')),
    prometheusAlerts: (input: PrometheusSourceInput) => prometheus.alerts(sources.resolved(input.sourceId, 'prometheus')),
    prometheusMetricNames: (input: PrometheusMetricNamesInput) =>
      prometheus.metricNames(sources.resolved(input.sourceId, 'prometheus'), input.prefix),
    lokiLabels: (input: LokiSourceInput) => loki.labels(sources.resolved(input.sourceId, 'loki')),
    lokiLabelValues: (input: LokiLabelValuesInput) => loki.labelValues(sources.resolved(input.sourceId, 'loki'), input.name),
    lokiQuery: (input: LokiQueryInput) =>
      loki.queryRange(sources.resolved(input.sourceId, 'loki'), input.query, input.fromMs, input.toMs, {
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.direction === undefined ? {} : { direction: input.direction })
      }),
    lokiVolume: (input: LokiVolumeInput) => loki.volume(sources.resolved(input.sourceId, 'loki'), input.query, input.fromMs, input.toMs),
    lokiStartLive: (input: LokiLiveStartInput) => live.start(input.sourceId, input.query),
    lokiStopLive: (input: LokiLiveStopInput) => live.stop(input.subscriptionId),
    listServices: (input: ObservabilityServiceListInput) => catalog.listServices(input),
    createService: (input: ObservabilityServiceCreateInput) => catalog.createService(input),
    updateService: (input: ObservabilityServiceUpdateInput) => catalog.updateService(input),
    removeService: (input: ObservabilityServiceIdInput) => catalog.removeService(input),
    listSignals: (input: ObservabilitySignalListInput) => catalog.listSignals(input),
    createSignal: (input: ObservabilitySignalCreateInput) => catalog.createSignal(input),
    updateSignal: (input: ObservabilitySignalUpdateInput) => catalog.updateSignal(input),
    removeSignal: (input: ObservabilitySignalIdInput) => catalog.removeSignal(input),
    reorderSignals: (input: ObservabilitySignalReorderInput) => catalog.reorderSignals(input),
    previewSignal: (input: ObservabilitySignalPreviewInput) => catalog.previewSignal(input),
    sentryIssues: (input: SentryIssuesInput) =>
      sentry.listIssues(sources.resolved(input.sourceId, 'sentry'), {
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.statsPeriod === undefined ? {} : { statsPeriod: input.statsPeriod }),
        ...(input.limit === undefined ? {} : { limit: input.limit })
      }),
    sentryEvent: (input: SentryEventInput) => sentry.latestEvent(sources.resolved(input.sourceId, 'sentry'), input.issueId),
    investigate: (input: InvestigateInput) => investigator.investigate(input),
    purgeProject: (projectId: string) => {
      live.stopAll();
      sources.purgeProject(projectId);
    },
    /** The page reloaded: nothing is listening for the lines of a live tail any more. */
    endLive: (): void => live.stopAll(),
    shutdown: (): void => live.stopAll()
  };
}

export type ObservabilityService = ReturnType<typeof createObservabilityService>;

import { z } from 'zod';
import { absolutePathSchema, idSchema, isoTimestampSchema } from './common';

export const OBSERVABILITY_KINDS = ['grafana', 'loki', 'prometheus', 'sentry'] as const;
export const observabilityKindSchema = z.enum(OBSERVABILITY_KINDS);

/** What a tool can do. The tabs and cards the page shows are derived from the capabilities of the configured sources. */
export const observabilityCapabilitySchema = z.enum(['dashboards', 'alerts', 'logs', 'metrics', 'issues']);

/**
 * The address of a source: http or https, no credentials in the URL (they would end up in logs and error
 * messages) and no fragment. A path prefix such as `https://host/grafana/` is allowed.
 */
export const observabilityBaseUrlSchema = z
  .string()
  .trim()
  .min(1, 'the address is required')
  .max(2048)
  .superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'must be a full address such as https://grafana.example.com' });
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      context.addIssue({ code: 'custom', message: 'must start with http:// or https://' });
    }
    if (url.username !== '' || url.password !== '') {
      context.addIssue({ code: 'custom', message: 'must not contain a user name or password; use the token fields' });
    }
    if (url.hash !== '' || url.search !== '') {
      context.addIssue({ code: 'custom', message: 'must not contain a query string or a fragment' });
    }
  });

export const observabilityAuthKindSchema = z.enum(['none', 'bearer', 'basic']);

const identifierSchema = z.string().trim().regex(/^[A-Za-z0-9_.-]{1,100}$/, 'letters, digits, dot, dash and underscore only');

/** Everything about a source that is not secret. */
export const observabilitySourceConfigSchema = z.object({
  authKind: observabilityAuthKindSchema,
  /** Loki multi-tenant: sent as `X-Scope-OrgID`. */
  tenant: z.string().trim().min(1).max(200).optional(),
  /** Path to the CA that signed the server certificate (a private CA). Only the path is stored. */
  caFile: absolutePathSchema.optional(),
  /** Query this Loki/Prometheus through a Grafana source of the same project. */
  viaSourceId: idSchema.optional(),
  /** The Grafana datasource UID to use with `viaSourceId`. */
  datasourceUid: identifierSchema.optional(),
  /** Sentry. */
  organization: identifierSchema.optional(),
  project: identifierSchema.optional()
});

/** What goes into the secret store. A field the user clears with `null` is removed. */
const secretValueSchema = z.string().max(4096);
export const observabilitySecretInputSchema = z.object({
  token: secretValueSchema.optional(),
  username: z.string().max(256).optional(),
  password: secretValueSchema.optional()
});
export const observabilitySecretPatchSchema = z.object({
  token: secretValueSchema.nullable().optional(),
  username: z.string().max(256).nullable().optional(),
  password: secretValueSchema.nullable().optional()
});

export const connectionStateSchema = z.enum(['connected', 'auth_error', 'unreachable', 'unchecked']);
export const operationalStateSchema = z.enum(['healthy', 'degraded', 'failing', 'unknown']);

export const connectionCheckSchema = z.object({
  state: connectionStateSchema,
  version: z.string().nullable(),
  identity: z.string().nullable(),
  latencyMs: z.number().nullable(),
  message: z.string().nullable()
});

export const operationalCheckSchema = z.object({
  state: operationalStateSchema,
  reasons: z.array(z.string())
});

export const observabilitySourceStatusSchema = z.object({
  connection: connectionCheckSchema,
  operational: operationalCheckSchema,
  checkedAt: isoTimestampSchema.nullable()
});

export const observabilitySourceSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  environmentId: idSchema.nullable(),
  environmentName: z.string().nullable(),
  kind: observabilityKindSchema,
  name: z.string(),
  baseUrl: z.string(),
  config: observabilitySourceConfigSchema,
  allowInsecureTls: z.boolean(),
  /** Secrets never leave main: the renderer only learns whether each one is saved. */
  hasToken: z.boolean(),
  hasPassword: z.boolean(),
  hasUsername: z.boolean(),
  capabilities: z.array(observabilityCapabilitySchema),
  status: observabilitySourceStatusSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema
});

const sourceNameSchema = z.string().trim().min(1, 'name is required').max(80);

export const observabilitySourceListInputSchema = z.object({ projectId: idSchema });
export const observabilitySourceIdInputSchema = z.object({ id: idSchema });

export const observabilitySourceCreateInputSchema = z.object({
  projectId: idSchema,
  environmentId: idSchema.nullable(),
  kind: observabilityKindSchema,
  name: sourceNameSchema,
  baseUrl: observabilityBaseUrlSchema,
  config: observabilitySourceConfigSchema,
  allowInsecureTls: z.boolean(),
  /** Needed when `allowInsecureTls` is turned on: skipping certificate checks is a decision the user confirms. */
  confirmed: z.boolean().optional(),
  secret: observabilitySecretInputSchema
});

export const observabilitySourceUpdateInputSchema = z.object({
  id: idSchema,
  environmentId: idSchema.nullable().optional(),
  name: sourceNameSchema.optional(),
  baseUrl: observabilityBaseUrlSchema.optional(),
  config: observabilitySourceConfigSchema.optional(),
  allowInsecureTls: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  secret: observabilitySecretPatchSchema.optional()
});

/** Tries a source that is not saved yet; `secretFrom` reuses the saved secret of an existing source being edited. */
export const observabilitySourceDraftInputSchema = z.object({
  projectId: idSchema,
  kind: observabilityKindSchema,
  baseUrl: observabilityBaseUrlSchema,
  config: observabilitySourceConfigSchema,
  allowInsecureTls: z.boolean(),
  confirmed: z.boolean().optional(),
  secret: observabilitySecretInputSchema,
  secretFrom: idSchema.optional()
});

export const observabilityPickFileInputSchema = z.object({ purpose: z.literal('ca') });

export const observabilityPickedFileSchema = z.object({
  cancelled: z.boolean(),
  path: z.string().nullable()
});

/**
 * A page inside a saved source, opened in the browser. The path is appended to the source's own address, so
 * what opens is always on the server the user configured.
 */
export const observabilityOpenUrlInputSchema = z.object({
  sourceId: idSchema,
  path: z
    .string()
    .max(512)
    .regex(/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/, 'must be a path on the server')
    .refine((value) => !value.split('/').includes('..'), 'must not climb out of the server path')
    .optional()
});

export type ObservabilityKind = z.infer<typeof observabilityKindSchema>;
export type ObservabilityCapability = z.infer<typeof observabilityCapabilitySchema>;
export type ObservabilityAuthKind = z.infer<typeof observabilityAuthKindSchema>;
export type ObservabilitySourceConfig = z.infer<typeof observabilitySourceConfigSchema>;
export type ObservabilitySecretInput = z.infer<typeof observabilitySecretInputSchema>;
export type ObservabilitySecretPatch = z.infer<typeof observabilitySecretPatchSchema>;
export type ConnectionState = z.infer<typeof connectionStateSchema>;
export type OperationalState = z.infer<typeof operationalStateSchema>;
export type ConnectionCheck = z.infer<typeof connectionCheckSchema>;
export type OperationalCheck = z.infer<typeof operationalCheckSchema>;
export type ObservabilitySourceStatus = z.infer<typeof observabilitySourceStatusSchema>;
export type ObservabilitySource = z.infer<typeof observabilitySourceSchema>;
export type ObservabilitySourceListInput = z.infer<typeof observabilitySourceListInputSchema>;
export type ObservabilitySourceIdInput = z.infer<typeof observabilitySourceIdInputSchema>;
export type ObservabilitySourceCreateInput = z.infer<typeof observabilitySourceCreateInputSchema>;
export type ObservabilitySourceUpdateInput = z.infer<typeof observabilitySourceUpdateInputSchema>;
export type ObservabilitySourceDraftInput = z.infer<typeof observabilitySourceDraftInputSchema>;
export type ObservabilityPickFileInput = z.infer<typeof observabilityPickFileInputSchema>;
export type ObservabilityPickedFile = z.infer<typeof observabilityPickedFileSchema>;
export type ObservabilityOpenUrlInput = z.infer<typeof observabilityOpenUrlInputSchema>;

// ── Grafana ────────────────────────────────────────────────────────────────

export const grafanaDashboardsInputSchema = z.object({
  sourceId: idSchema,
  query: z.string().trim().max(200).optional()
});
export const grafanaSourceInputSchema = z.object({ sourceId: idSchema });

export const observabilityDashboardSchema = z.object({
  uid: z.string(),
  title: z.string(),
  /** Path on the Grafana server (without its own path prefix), ready for `observability:openUrl`. */
  path: z.string(),
  folder: z.string().nullable(),
  tags: z.array(z.string())
});

export const observabilityDatasourceSchema = z.object({
  uid: z.string(),
  name: z.string(),
  type: z.string(),
  isDefault: z.boolean()
});

export const observabilityAlertSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.enum(['firing', 'pending', 'suppressed']),
  severity: z.string().nullable(),
  summary: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
  startsAt: z.string().nullable()
});

export type GrafanaDashboardsInput = z.infer<typeof grafanaDashboardsInputSchema>;
export type GrafanaSourceInput = z.infer<typeof grafanaSourceInputSchema>;
export type ObservabilityDashboard = z.infer<typeof observabilityDashboardSchema>;
export type ObservabilityDatasource = z.infer<typeof observabilityDatasourceSchema>;
export type ObservabilityAlert = z.infer<typeof observabilityAlertSchema>;

// ── Prometheus ─────────────────────────────────────────────────────────────

const queryTextSchema = z.string().min(1, 'write a query').max(8000);

export const prometheusQueryInputSchema = z.object({
  sourceId: idSchema,
  query: queryTextSchema,
  /** Evaluate at this instant (ms since the epoch); now when omitted. */
  timeMs: z.number().int().min(0).optional()
});

export const prometheusRangeInputSchema = z.object({
  sourceId: idSchema,
  query: queryTextSchema,
  fromMs: z.number().int().min(0),
  toMs: z.number().int().min(0),
  /** Wider than the default when the user wants fewer points; main never goes below what keeps the answer under 11 000 points. */
  stepSeconds: z.number().int().min(1).max(86_400).optional()
});

export const prometheusSourceInputSchema = z.object({ sourceId: idSchema });

export const prometheusMetricNamesInputSchema = z.object({
  sourceId: idSchema,
  prefix: z.string().trim().max(200).optional()
});

/** `[time in ms, value]`; a gap (NaN) is `null` so the chart draws a break. */
export const metricPointSchema = z.tuple([z.number(), z.number().nullable()]);

export const metricSeriesSchema = z.object({
  labels: z.record(z.string(), z.string()),
  points: z.array(metricPointSchema)
});

export const prometheusRangeResultSchema = z.object({
  series: z.array(metricSeriesSchema),
  fromMs: z.number(),
  toMs: z.number(),
  stepSeconds: z.number(),
  /** More series came back than are shown. */
  totalSeries: z.number(),
  truncated: z.boolean()
});

export const prometheusSampleSchema = z.object({
  labels: z.record(z.string(), z.string()),
  timeMs: z.number(),
  /** The value as Prometheus printed it (`"NaN"`, `"+Inf"` included). */
  text: z.string()
});

export const prometheusInstantResultSchema = z.object({
  resultType: z.string(),
  samples: z.array(prometheusSampleSchema),
  totalSamples: z.number(),
  truncated: z.boolean()
});

export const prometheusTargetSchema = z.object({
  job: z.string(),
  instance: z.string(),
  health: z.enum(['up', 'down', 'unknown']),
  lastError: z.string().nullable(),
  lastScrape: z.string().nullable(),
  labels: z.record(z.string(), z.string())
});

export const prometheusTargetsResultSchema = z.object({
  targets: z.array(prometheusTargetSchema),
  totalTargets: z.number(),
  truncated: z.boolean()
});

export const prometheusMetricNamesResultSchema = z.object({
  names: z.array(z.string()),
  truncated: z.boolean()
});

export type PrometheusQueryInput = z.infer<typeof prometheusQueryInputSchema>;
export type PrometheusRangeInput = z.infer<typeof prometheusRangeInputSchema>;
export type PrometheusSourceInput = z.infer<typeof prometheusSourceInputSchema>;
export type PrometheusMetricNamesInput = z.infer<typeof prometheusMetricNamesInputSchema>;
export type MetricPoint = z.infer<typeof metricPointSchema>;
export type MetricSeries = z.infer<typeof metricSeriesSchema>;
export type PrometheusRangeResult = z.infer<typeof prometheusRangeResultSchema>;
export type PrometheusSample = z.infer<typeof prometheusSampleSchema>;
export type PrometheusInstantResult = z.infer<typeof prometheusInstantResultSchema>;
export type PrometheusTarget = z.infer<typeof prometheusTargetSchema>;
export type PrometheusTargetsResult = z.infer<typeof prometheusTargetsResultSchema>;
export type PrometheusMetricNamesResult = z.infer<typeof prometheusMetricNamesResultSchema>;

// ── Loki ───────────────────────────────────────────────────────────────────

export const LOKI_DEFAULT_LIMIT = 1000;
export const LOKI_MAX_LIMIT = 5000;
/** Loki refuses wide ranges on most setups, and a day of logs is more than anyone reads. */
export const LOKI_MAX_RANGE_MS = 24 * 60 * 60 * 1000;

export const logLevelSchema = z.enum(['error', 'warn', 'info', 'debug', 'unknown']);

const logQuerySchema = z.string().trim().min(1, 'write a query').max(8000);

export const lokiSourceInputSchema = z.object({ sourceId: idSchema });

export const lokiLabelValuesInputSchema = z.object({
  sourceId: idSchema,
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, 'not a label name')
});

export const lokiQueryInputSchema = z.object({
  sourceId: idSchema,
  query: logQuerySchema,
  fromMs: z.number().int().min(0),
  toMs: z.number().int().min(0),
  limit: z.number().int().min(1).max(LOKI_MAX_LIMIT).optional(),
  direction: z.enum(['backward', 'forward']).optional()
});

export const lokiVolumeInputSchema = z.object({
  sourceId: idSchema,
  query: logQuerySchema,
  fromMs: z.number().int().min(0),
  toMs: z.number().int().min(0)
});

export const lokiLiveStartInputSchema = z.object({ sourceId: idSchema, query: logQuerySchema });
export const lokiLiveStopInputSchema = z.object({ subscriptionId: idSchema });

export const logLineSchema = z.object({
  /** Nanoseconds since the epoch, as a string: 19 digits do not fit a JavaScript number. */
  tsNs: z.string(),
  line: z.string(),
  labels: z.record(z.string(), z.string()),
  level: logLevelSchema
});

export const lokiQueryResultSchema = z.object({
  lines: z.array(logLineSchema),
  /** The limit was reached: there are more lines than shown. */
  truncated: z.boolean(),
  /** A metric query (`rate(...)`) answers with series, not lines. */
  matrix: z.array(metricSeriesSchema).nullable()
});

export const lokiLabelsResultSchema = z.object({ labels: z.array(z.string()) });
export const lokiLabelValuesResultSchema = z.object({ values: z.array(z.string()), truncated: z.boolean() });
export const lokiVolumeResultSchema = z.object({ series: z.array(metricSeriesSchema), stepSeconds: z.number() });
export const lokiLiveSubscriptionSchema = z.object({ subscriptionId: idSchema });

/** Pushed from main while a live tail runs. */
export const liveLogsEventSchema = z.object({ subscriptionId: idSchema, lines: z.array(logLineSchema) });
export const liveLogsEndEventSchema = z.object({ subscriptionId: idSchema, reason: z.string() });

export type LogLevel = z.infer<typeof logLevelSchema>;
export type LokiSourceInput = z.infer<typeof lokiSourceInputSchema>;
export type LokiLabelValuesInput = z.infer<typeof lokiLabelValuesInputSchema>;
export type LokiQueryInput = z.infer<typeof lokiQueryInputSchema>;
export type LokiVolumeInput = z.infer<typeof lokiVolumeInputSchema>;
export type LokiLiveStartInput = z.infer<typeof lokiLiveStartInputSchema>;
export type LokiLiveStopInput = z.infer<typeof lokiLiveStopInputSchema>;
export type LogLine = z.infer<typeof logLineSchema>;
export type LokiQueryResult = z.infer<typeof lokiQueryResultSchema>;
export type LokiLabelsResult = z.infer<typeof lokiLabelsResultSchema>;
export type LokiLabelValuesResult = z.infer<typeof lokiLabelValuesResultSchema>;
export type LokiVolumeResult = z.infer<typeof lokiVolumeResultSchema>;
export type LokiLiveSubscription = z.infer<typeof lokiLiveSubscriptionSchema>;
export type LiveLogsEvent = z.infer<typeof liveLogsEventSchema>;
export type LiveLogsEndEvent = z.infer<typeof liveLogsEndEventSchema>;

// ── Services and signals ───────────────────────────────────────────────────

/** A LogQL stream selector: `{app="api"}`. */
export const logSelectorSchema = z
  .string()
  .trim()
  .min(3)
  .max(2000)
  .refine((value) => value.startsWith('{') && value.endsWith('}') && !/[\r\n]/.test(value), 'must look like {app="api"}');

/** The inside of a PromQL selector: `job="api", env="prod"`. Braces are added by the template. */
export const metricMatcherSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((value) => !/[{}\r\n]/.test(value), 'write only what goes between the braces, such as job="api"');

/** Same alphabet as Docker names: no character that could be read as a flag or a shell word. */
const containerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'not a valid container name')
  .nullable();

export const observabilityServiceSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  environmentId: idSchema.nullable(),
  environmentName: z.string().nullable(),
  name: z.string(),
  repositoryId: idSchema.nullable(),
  logSelector: z.string().nullable(),
  metricMatcher: z.string().nullable(),
  sshHostId: idSchema.nullable(),
  dockerContainer: z.string().nullable(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema
});

export const observabilityServiceListInputSchema = z.object({ projectId: idSchema });
export const observabilityServiceIdInputSchema = z.object({ id: idSchema });

const serviceFields = {
  environmentId: idSchema.nullable(),
  name: z.string().trim().min(1, 'name is required').max(80),
  repositoryId: idSchema.nullable(),
  logSelector: logSelectorSchema.nullable(),
  metricMatcher: metricMatcherSchema.nullable(),
  sshHostId: idSchema.nullable(),
  dockerContainer: containerNameSchema
};

export const observabilityServiceCreateInputSchema = z.object({ projectId: idSchema, ...serviceFields });
export const observabilityServiceUpdateInputSchema = z.object({ id: idSchema, ...serviceFields });

export const signalKindSchema = z.enum(['promql', 'logql_metric']);
export const signalTemplateSchema = z.string().trim().min(1, 'write a query').max(4000);

export const observabilitySignalSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  name: z.string(),
  kind: signalKindSchema,
  queryTemplate: z.string(),
  unit: z.string(),
  position: z.number().int(),
  createdAt: isoTimestampSchema
});

export const observabilitySignalListInputSchema = z.object({ projectId: idSchema });
export const observabilitySignalIdInputSchema = z.object({ id: idSchema });

const signalFields = {
  name: z.string().trim().min(1, 'name is required').max(80),
  kind: signalKindSchema,
  queryTemplate: signalTemplateSchema,
  unit: z.string().trim().max(16)
};

export const observabilitySignalCreateInputSchema = z.object({ projectId: idSchema, ...signalFields });
export const observabilitySignalUpdateInputSchema = z.object({ id: idSchema, ...signalFields });

export const observabilitySignalReorderInputSchema = z.object({
  projectId: idSchema,
  /** Every signal of the project, in the new order. A partial list is refused so the order cannot drift. */
  orderedIds: z.array(idSchema).min(1)
});

/** The template with one service's selector and matcher put in, shown while the user edits a signal. */
export const observabilitySignalPreviewInputSchema = z.object({ serviceId: idSchema, queryTemplate: signalTemplateSchema });
export const observabilitySignalPreviewSchema = z.object({ query: z.string() });

export type ObservabilityServiceEntry = z.infer<typeof observabilityServiceSchema>;
export type ObservabilityServiceListInput = z.infer<typeof observabilityServiceListInputSchema>;
export type ObservabilityServiceIdInput = z.infer<typeof observabilityServiceIdInputSchema>;
export type ObservabilityServiceCreateInput = z.infer<typeof observabilityServiceCreateInputSchema>;
export type ObservabilityServiceUpdateInput = z.infer<typeof observabilityServiceUpdateInputSchema>;
export type SignalKind = z.infer<typeof signalKindSchema>;
export type ObservabilitySignal = z.infer<typeof observabilitySignalSchema>;
export type ObservabilitySignalListInput = z.infer<typeof observabilitySignalListInputSchema>;
export type ObservabilitySignalIdInput = z.infer<typeof observabilitySignalIdInputSchema>;
export type ObservabilitySignalCreateInput = z.infer<typeof observabilitySignalCreateInputSchema>;
export type ObservabilitySignalUpdateInput = z.infer<typeof observabilitySignalUpdateInputSchema>;
export type ObservabilitySignalReorderInput = z.infer<typeof observabilitySignalReorderInputSchema>;
export type ObservabilitySignalPreviewInput = z.infer<typeof observabilitySignalPreviewInputSchema>;
export type ObservabilitySignalPreview = z.infer<typeof observabilitySignalPreviewSchema>;

// ── Sentry ─────────────────────────────────────────────────────────────────

export const sentryPeriodSchema = z.enum(['1h', '24h', '7d', '14d']);

export const sentryIssuesInputSchema = z.object({
  sourceId: idSchema,
  /** Sentry's own search syntax (`is:unresolved level:error`). */
  query: z.string().trim().max(500).optional(),
  statsPeriod: sentryPeriodSchema.optional(),
  limit: z.number().int().min(1).max(100).optional()
});

export const sentryEventInputSchema = z.object({
  sourceId: idSchema,
  issueId: z.string().regex(/^\d{1,20}$/, 'not an issue id')
});

export const sentryIssueSchema = z.object({
  id: z.string(),
  shortId: z.string(),
  title: z.string(),
  culprit: z.string().nullable(),
  level: z.string(),
  status: z.string(),
  count: z.number(),
  userCount: z.number(),
  firstSeenMs: z.number().nullable(),
  lastSeenMs: z.number().nullable(),
  /** The issue's page on the Sentry server, ready for `observability:openUrl`. */
  path: z.string().nullable()
});

export const sentryIssuesResultSchema = z.object({
  issues: z.array(sentryIssueSchema),
  /** The page is full: there may be more. */
  truncated: z.boolean()
});

export const sentryFrameSchema = z.object({
  file: z.string().nullable(),
  function: z.string().nullable(),
  line: z.number().nullable(),
  inApp: z.boolean()
});

export const sentryExceptionSchema = z.object({
  type: z.string().nullable(),
  value: z.string().nullable(),
  frames: z.array(sentryFrameSchema)
});

export const sentryEventSchema = z.object({
  eventId: z.string(),
  dateCreatedMs: z.number().nullable(),
  message: z.string().nullable(),
  release: z.string().nullable(),
  tags: z.array(z.object({ key: z.string(), value: z.string() })),
  exceptions: z.array(sentryExceptionSchema)
});

/** How many unresolved issues a release brought, for the deploys that carry a commit. */
export const releaseIssuesSchema = z.object({
  deployId: idSchema,
  release: z.string(),
  count: z.number(),
  titles: z.array(z.string())
});

export type SentryPeriod = z.infer<typeof sentryPeriodSchema>;
export type SentryIssuesInput = z.infer<typeof sentryIssuesInputSchema>;
export type SentryEventInput = z.infer<typeof sentryEventInputSchema>;
export type SentryIssue = z.infer<typeof sentryIssueSchema>;
export type SentryIssuesResult = z.infer<typeof sentryIssuesResultSchema>;
export type SentryEvent = z.infer<typeof sentryEventSchema>;
export type ReleaseIssues = z.infer<typeof releaseIssuesSchema>;

// ── Investigate ────────────────────────────────────────────────────────────

export const investigatePresetSchema = z.enum(['15m', '1h', '6h', '24h', 'since_last_deploy']);

export const investigateInputSchema = z
  .object({
    projectId: idSchema,
    serviceId: idSchema,
    preset: investigatePresetSchema.optional(),
    /** A custom window instead of a preset. */
    fromMs: z.number().int().min(0).optional(),
    toMs: z.number().int().min(0).optional(),
    /** Which Loki / Prometheus to ask when the project has several; main picks one for the service's environment otherwise. */
    logsSourceId: idSchema.optional(),
    metricsSourceId: idSchema.optional(),
    /** The regular expression that makes a line an "error line". */
    errorPattern: z.string().max(300).optional()
  })
  .refine((value) => value.preset !== undefined || (value.fromMs !== undefined && value.toMs !== undefined), 'choose a window');

export const DEFAULT_ERROR_PATTERN = '(?i)error|exception|panic|fatal';

const sectionErrorSchema = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string(),
  details: z.string().optional()
});

function section<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), data }), sectionErrorSchema]);
}

export const deployMarkerSchema = z.object({
  id: idSchema,
  atMs: z.number(),
  ref: z.string().nullable(),
  commitSha: z.string().nullable(),
  status: z.string(),
  targetName: z.string()
});

export const alertMarkerSchema = z.object({
  name: z.string(),
  severity: z.string().nullable(),
  state: z.string(),
  startsAtMs: z.number().nullable(),
  sourceName: z.string()
});

export const signalSeriesSchema = z.object({
  signalId: idSchema,
  name: z.string(),
  unit: z.string(),
  kind: signalKindSchema,
  result: section(
    z.object({ series: z.array(metricSeriesSchema), stepSeconds: z.number(), totalSeries: z.number(), truncated: z.boolean() })
  )
});

export const containerStateSchema = z.object({
  name: z.string(),
  state: z.string(),
  status: z.string(),
  image: z.string(),
  serverName: z.string()
});

export const signalComparisonSchema = z.object({
  signalId: idSchema,
  signalName: z.string(),
  unit: z.string(),
  deployId: idSchema,
  deployAtMs: z.number(),
  deployLabel: z.string(),
  windowMinutes: z.number(),
  before: z.number().nullable(),
  after: z.number().nullable(),
  changePct: z.number().nullable(),
  note: z.enum(['ok', 'too_recent', 'no_data'])
});

export const investigateResultSchema = z.object({
  window: z.object({
    fromMs: z.number(),
    /** Where the data starts: a little before `fromMs`, so the first deploy has something to be compared with. */
    fetchFromMs: z.number(),
    toMs: z.number(),
    preset: investigatePresetSchema.nullable(),
    /** The window was cut to the 24 hours Loki accepts. */
    clamped: z.boolean(),
    /** "Since the last deploy" found no deploy and fell back to an hour. */
    noDeployFound: z.boolean()
  }),
  service: z.object({ id: idSchema, name: z.string(), environmentName: z.string().nullable() }),
  sources: z.object({
    logs: z.object({ id: idSchema, name: z.string() }).nullable(),
    metrics: z.object({ id: idSchema, name: z.string() }).nullable()
  }),
  deploys: section(z.array(deployMarkerSchema)),
  alerts: section(z.array(alertMarkerSchema)),
  signals: z.array(signalSeriesSchema),
  errorLogs: section(z.object({ query: z.string(), result: lokiQueryResultSchema })),
  container: section(containerStateSchema.nullable()),
  /** Sentry: the unresolved issues of the window and what each deploy's release brought. */
  issues: section(z.object({ issues: z.array(sentryIssueSchema), byRelease: z.array(releaseIssuesSchema) })),
  comparison: z.array(signalComparisonSchema)
});

export type InvestigatePreset = z.infer<typeof investigatePresetSchema>;
export type InvestigateInput = z.infer<typeof investigateInputSchema>;
export type DeployMarker = z.infer<typeof deployMarkerSchema>;
export type AlertMarker = z.infer<typeof alertMarkerSchema>;
export type SignalSeries = z.infer<typeof signalSeriesSchema>;
export type ContainerState = z.infer<typeof containerStateSchema>;
export type SignalComparison = z.infer<typeof signalComparisonSchema>;
export type InvestigateResult = z.infer<typeof investigateResultSchema>;

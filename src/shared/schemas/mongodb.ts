import { z } from 'zod';
import { absolutePathSchema, idSchema } from './common';

export const MONGO_FIND_LIMIT_DEFAULT = 20;
export const MONGO_FIND_LIMIT_MAX = 1000;
export const MONGO_MAX_TIME_DEFAULT_MS = 30_000;
export const MONGO_MAX_TIME_MAX_MS = 120_000;
/** A document bigger than this is shown as "too large" and cannot be edited from here. */
export const MONGO_DOC_MAX_BYTES = 1_000_000;
export const MONGO_RESPONSE_MAX_BYTES = 4_000_000;
export const MONGO_INSERT_MAX_DOCS = 1000;

// ── connections ────────────────────────────────────────────────────────────

export const mongoAuthMechanismSchema = z.enum(['default', 'none', 'SCRAM-SHA-256', 'SCRAM-SHA-1', 'X509']);
export const mongoReadPreferenceSchema = z.enum([
  'primary',
  'primaryPreferred',
  'secondary',
  'secondaryPreferred',
  'nearest'
]);

/** Everything about a connection that is not a secret. The password and the full URI live in the secret store. */
export const mongoConnectionOptionsSchema = z.object({
  authSource: z.string().trim().max(128).optional(),
  authMechanism: mongoAuthMechanismSchema,
  replicaSet: z.string().trim().max(128).optional(),
  readPreference: mongoReadPreferenceSchema.optional(),
  directConnection: z.boolean().optional(),
  tls: z.boolean().optional(),
  /** Paths only: Steward hands them to the driver and never reads the files itself. */
  tlsCAFile: absolutePathSchema.optional(),
  tlsCertificateKeyFile: absolutePathSchema.optional(),
  /** Accepting any certificate is a decision the user makes knowingly; the UI keeps a warning on the connection. */
  tlsAllowInvalidCertificates: z.boolean().optional()
});

/** Where to connect and as whom. Goes in once, is kept encrypted, and never comes back to the renderer. */
export const mongoSecretInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uri'), uri: z.string().trim().min(10).max(4096) }),
  z.object({
    kind: z.literal('form'),
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65535).optional(),
    username: z.string().max(256).optional(),
    password: z.string().max(1024).optional(),
    /** `mongodb+srv://`: Atlas and other DNS seed lists. The port is then not used. */
    srv: z.boolean().optional(),
    database: z.string().trim().max(64).optional()
  })
]);

const connectionNameSchema = z.string().trim().min(1, 'name is required').max(80);

export const mongoConnectionCreateInputSchema = z.object({
  projectId: idSchema,
  environmentId: idSchema.nullable(),
  name: connectionNameSchema,
  secret: mongoSecretInputSchema,
  /** Passphrase of the client key, when it has one. */
  tlsKeyPassword: z.string().max(1024).optional(),
  options: mongoConnectionOptionsSchema,
  /** Omitted = read-only when the environment is protected, writable otherwise. */
  readOnly: z.boolean().optional(),
  /** Needed to create a writable connection in a protected environment. */
  confirmed: z.boolean().optional()
});

export const mongoConnectionUpdateInputSchema = z.object({
  id: idSchema,
  name: connectionNameSchema.optional(),
  environmentId: idSchema.nullable().optional(),
  options: mongoConnectionOptionsSchema.optional(),
  readOnly: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  /** Replaces the stored URI / credentials. Omitted = keep them. */
  secret: mongoSecretInputSchema.optional(),
  /** `null` forgets the stored key passphrase; omitted keeps it. */
  tlsKeyPassword: z.string().max(1024).nullable().optional()
});

export const mongoConnectionIdInputSchema = z.object({ id: idSchema });
export const mongoConnectionListInputSchema = z.object({ projectId: idSchema });

/** Tries a connection that is not saved yet. */
export const mongoConnectionDraftInputSchema = z.object({
  projectId: idSchema,
  secret: mongoSecretInputSchema,
  tlsKeyPassword: z.string().max(1024).optional(),
  options: mongoConnectionOptionsSchema
});

export const mongoPickFileInputSchema = z.object({ purpose: z.enum(['tlsCa', 'tlsCertificate', 'import']) });

// ── namespaces and queries ─────────────────────────────────────────────────

export const mongoDatabaseNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[^/\\. "$*<>:|?\0]+$/, 'not a valid database name');

export const mongoCollectionNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^$\0]+$/, 'not a valid collection name');

const namespaceShape = {
  connectionId: idSchema,
  db: mongoDatabaseNameSchema,
  collection: mongoCollectionNameSchema
};

const queryText = z.string().max(100_000);
const maxTimeMsSchema = z.number().int().min(100).max(MONGO_MAX_TIME_MAX_MS);

export const mongoDatabaseInputSchema = z.object({ connectionId: idSchema, db: mongoDatabaseNameSchema });
export const mongoNamespaceInputSchema = z.object(namespaceShape);

export const mongoFindInputSchema = z.object({
  ...namespaceShape,
  filter: queryText,
  project: queryText.optional(),
  sort: queryText.optional(),
  skip: z.number().int().min(0).max(10_000_000).optional(),
  limit: z.number().int().min(1).max(MONGO_FIND_LIMIT_MAX).optional(),
  maxTimeMS: maxTimeMsSchema.optional()
});

export const mongoCountInputSchema = z.object({
  ...namespaceShape,
  filter: queryText,
  /** Count for real even with an empty filter, instead of the estimate: what a bulk change must be checked against. */
  exact: z.boolean().optional(),
  maxTimeMS: maxTimeMsSchema.optional()
});

export const mongoExplainInputSchema = z.object({
  ...namespaceShape,
  filter: queryText,
  sort: queryText.optional(),
  maxTimeMS: maxTimeMsSchema.optional()
});

// ── writes ─────────────────────────────────────────────────────────────────

/** A document's `_id` exactly as the server returned it: canonical Extended JSON, so its type survives the trip. */
const idEjsonSchema = z.string().min(2).max(4096);

export const mongoInsertInputSchema = z.object({
  ...namespaceShape,
  /** One document or an array of up to 1000, in shell syntax. */
  documents: queryText
});

export const mongoReplaceInputSchema = z.object({
  ...namespaceShape,
  id: idEjsonSchema,
  document: queryText,
  /** The document as it was loaded: if the server's copy differs, nothing is written unless `force` is set. */
  expected: z.string().max(2_000_000),
  force: z.boolean().optional()
});

export const mongoDeleteOneInputSchema = z.object({ ...namespaceShape, id: idEjsonSchema, confirmed: z.literal(true) });

export const mongoDeleteManyInputSchema = z.object({
  ...namespaceShape,
  filter: queryText,
  /** What the user was shown. Main counts again and refuses if the number changed in between. */
  expectedCount: z.number().int().min(0),
  confirmed: z.literal(true),
  /** An empty filter matches everything, so the collection's name has to be typed. */
  confirmCollection: z.string().max(255).optional()
});

export const mongoUpdateManyInputSchema = z.object({
  ...namespaceShape,
  filter: queryText,
  update: queryText,
  expectedCount: z.number().int().min(0),
  confirmed: z.literal(true),
  confirmCollection: z.string().max(255).optional()
});

export const mongoCreateCollectionInputSchema = z.object({
  connectionId: idSchema,
  db: mongoDatabaseNameSchema,
  collection: mongoCollectionNameSchema
});

/** Dropping needs the exact name typed; on a protected connection also the connection's own name. */
export const mongoDropCollectionInputSchema = z.object({
  ...namespaceShape,
  confirmed: z.literal(true),
  confirmName: z.string().max(255),
  confirmConnection: z.string().max(80).optional()
});

export const mongoDropDatabaseInputSchema = z.object({
  connectionId: idSchema,
  db: mongoDatabaseNameSchema,
  confirmed: z.literal(true),
  confirmName: z.string().max(255),
  confirmConnection: z.string().max(80).optional()
});

// ── aggregation, indexes, schema, validation ───────────────────────────────

export const mongoAggregateInputSchema = z.object({
  ...namespaceShape,
  /** The pipeline in shell syntax: an array of stages. */
  pipeline: queryText,
  /** Run only the first N stages (0-based, inclusive) and cap the output: the per-stage preview. */
  previewUpToStage: z.number().int().min(0).max(100).optional(),
  allowDiskUse: z.boolean().optional(),
  maxTimeMS: maxTimeMsSchema.optional(),
  /** `$out` and `$merge` write to the database, so they need this. */
  confirmedWrite: z.boolean().optional()
});

export const mongoAggregateExplainInputSchema = z.object({
  ...namespaceShape,
  pipeline: queryText,
  maxTimeMS: maxTimeMsSchema.optional()
});

export const mongoIndexCreateInputSchema = z.object({
  ...namespaceShape,
  keys: queryText,
  name: z.string().trim().max(127).optional(),
  unique: z.boolean().optional(),
  sparse: z.boolean().optional(),
  expireAfterSeconds: z.number().int().min(0).max(315_360_000).optional(),
  partialFilterExpression: queryText.optional(),
  /** Building an index can be heavy: on a protected connection this is asked for. */
  confirmed: z.boolean().optional()
});

export const mongoIndexDropInputSchema = z.object({
  ...namespaceShape,
  name: z.string().min(1).max(127),
  confirmed: z.literal(true)
});

export const mongoSchemaInputSchema = z.object({
  ...namespaceShape,
  sampleSize: z.number().int().min(10).max(5000).optional()
});

export const mongoValidationSetInputSchema = z.object({
  ...namespaceShape,
  /** `$jsonSchema` or any validator expression, in shell syntax. Empty removes the validator. */
  validator: queryText,
  validationLevel: z.enum(['off', 'strict', 'moderate']),
  validationAction: z.enum(['error', 'warn']),
  confirmed: z.literal(true)
});

// ── import / export, saved queries ─────────────────────────────────────────

export const mongoExportFormatSchema = z.enum(['json', 'ndjson', 'csv']);

export const mongoExportInputSchema = z.object({
  ...namespaceShape,
  filter: queryText,
  project: queryText.optional(),
  sort: queryText.optional(),
  format: mongoExportFormatSchema,
  maxTimeMS: maxTimeMsSchema.optional()
});

export const mongoImportInputSchema = z.object({
  ...namespaceShape,
  /** The file was chosen in the dialog that `mongo:pickFile` opened; its path is looked up here, never sent by the renderer. */
  fileToken: idSchema,
  format: mongoExportFormatSchema
});

export const mongoSavedQueryKindSchema = z.enum(['find', 'aggregate']);

export const mongoSavedQueryListInputSchema = z.object({ connectionId: idSchema, db: mongoDatabaseNameSchema, collection: mongoCollectionNameSchema });
export const mongoSavedQuerySaveInputSchema = z.object({
  ...namespaceShape,
  name: z.string().trim().min(1).max(80),
  kind: mongoSavedQueryKindSchema,
  body: z.object({
    filter: queryText.optional(),
    project: queryText.optional(),
    sort: queryText.optional(),
    pipeline: queryText.optional()
  })
});
export const mongoSavedQueryDeleteInputSchema = z.object({ id: idSchema });

// ── inferred input types ───────────────────────────────────────────────────

export type MongoConnectionOptions = z.infer<typeof mongoConnectionOptionsSchema>;
export type MongoSecretInput = z.infer<typeof mongoSecretInputSchema>;
export type MongoConnectionCreateInput = z.infer<typeof mongoConnectionCreateInputSchema>;
export type MongoConnectionUpdateInput = z.infer<typeof mongoConnectionUpdateInputSchema>;
export type MongoConnectionIdInput = z.infer<typeof mongoConnectionIdInputSchema>;
export type MongoConnectionListInput = z.infer<typeof mongoConnectionListInputSchema>;
export type MongoConnectionDraftInput = z.infer<typeof mongoConnectionDraftInputSchema>;
export type MongoPickFileInput = z.infer<typeof mongoPickFileInputSchema>;
export type MongoDatabaseInput = z.infer<typeof mongoDatabaseInputSchema>;
export type MongoNamespaceInput = z.infer<typeof mongoNamespaceInputSchema>;
export type MongoFindInput = z.infer<typeof mongoFindInputSchema>;
export type MongoCountInput = z.infer<typeof mongoCountInputSchema>;
export type MongoExplainInput = z.infer<typeof mongoExplainInputSchema>;
export type MongoInsertInput = z.infer<typeof mongoInsertInputSchema>;
export type MongoReplaceInput = z.infer<typeof mongoReplaceInputSchema>;
export type MongoDeleteOneInput = z.infer<typeof mongoDeleteOneInputSchema>;
export type MongoDeleteManyInput = z.infer<typeof mongoDeleteManyInputSchema>;
export type MongoUpdateManyInput = z.infer<typeof mongoUpdateManyInputSchema>;
export type MongoCreateCollectionInput = z.infer<typeof mongoCreateCollectionInputSchema>;
export type MongoDropCollectionInput = z.infer<typeof mongoDropCollectionInputSchema>;
export type MongoDropDatabaseInput = z.infer<typeof mongoDropDatabaseInputSchema>;
export type MongoAggregateInput = z.infer<typeof mongoAggregateInputSchema>;
export type MongoAggregateExplainInput = z.infer<typeof mongoAggregateExplainInputSchema>;
export type MongoIndexCreateInput = z.infer<typeof mongoIndexCreateInputSchema>;
export type MongoIndexDropInput = z.infer<typeof mongoIndexDropInputSchema>;
export type MongoSchemaInput = z.infer<typeof mongoSchemaInputSchema>;
export type MongoValidationSetInput = z.infer<typeof mongoValidationSetInputSchema>;
export type MongoExportFormat = z.infer<typeof mongoExportFormatSchema>;
export type MongoExportInput = z.infer<typeof mongoExportInputSchema>;
export type MongoImportInput = z.infer<typeof mongoImportInputSchema>;
export type MongoSavedQueryKind = z.infer<typeof mongoSavedQueryKindSchema>;
export type MongoSavedQueryListInput = z.infer<typeof mongoSavedQueryListInputSchema>;
export type MongoSavedQuerySaveInput = z.infer<typeof mongoSavedQuerySaveInputSchema>;
export type MongoSavedQueryDeleteInput = z.infer<typeof mongoSavedQueryDeleteInputSchema>;

// ── results ────────────────────────────────────────────────────────────────

export interface MongoConnection {
  id: string;
  projectId: string;
  environmentId: string | null;
  environmentName: string | null;
  /** The environment is protected: the connection starts read-only and asks before building indexes. */
  protectedEnvironment: boolean;
  name: string;
  /** Host(s) without credentials, e.g. `cluster0.ab12c.mongodb.net`. */
  hostDisplay: string;
  isAtlas: boolean;
  options: MongoConnectionOptions;
  readOnly: boolean;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MongoTestResult {
  serverVersion: string;
  latencyMs: number;
  /** `Single`, `ReplicaSetWithPrimary`, `Sharded`, … as the driver names it. */
  topology: string;
}

export interface MongoDatabaseInfo {
  name: string;
  sizeOnDisk: number | null;
  empty: boolean;
}

export interface MongoCollectionInfo {
  name: string;
  type: 'collection' | 'view' | 'timeseries';
}

export interface MongoCollectionStats {
  documentCount: number | null;
  size: number | null;
  avgObjSize: number | null;
  storageSize: number | null;
  indexCount: number | null;
  totalIndexSize: number | null;
}

/** One document as canonical Extended JSON text, so ObjectId, dates and 64-bit numbers keep their types. */
export interface MongoDocument {
  json: string;
  /** Too big to show or edit here; `json` then holds only its `_id`. */
  tooLarge: boolean;
  sizeBytes: number;
}

export interface MongoFindResult {
  documents: MongoDocument[];
  hasMore: boolean;
  /** The response stopped early to stay under the size cap. */
  truncated: boolean;
  elapsedMs: number;
}

export interface MongoCountResult {
  count: number;
  /** An estimate from collection metadata (empty filter) rather than a count. */
  estimated: boolean;
}

export interface MongoExplainSummary {
  stage: string;
  indexName: string | null;
  usesIndex: boolean;
  nReturned: number | null;
  keysExamined: number | null;
  docsExamined: number | null;
  executionTimeMillis: number | null;
  /** The whole explain output, canonical Extended JSON. */
  raw: string;
}

export interface MongoWriteResult {
  count: number;
}

export interface MongoInsertResult {
  insertedCount: number;
}

export interface MongoAggregateResult {
  documents: MongoDocument[];
  truncated: boolean;
  elapsedMs: number;
}

export interface MongoIndex {
  name: string;
  keys: string;
  unique: boolean;
  sparse: boolean;
  expireAfterSeconds: number | null;
  partial: boolean;
  /** Times it was used since the server started, when the server reports it. */
  accesses: number | null;
  sizeBytes: number | null;
}

export interface MongoSchemaField {
  path: string;
  presentPercent: number;
  types: { type: string; percent: number }[];
  samples: string[];
}

export interface MongoSchemaResult {
  sampled: number;
  fields: MongoSchemaField[];
}

export interface MongoValidation {
  validator: string;
  validationLevel: 'off' | 'strict' | 'moderate';
  validationAction: 'error' | 'warn';
}

export interface MongoPickedFile {
  cancelled: boolean;
  /** A path for a TLS file; for an import, an opaque token that main maps to the chosen file. */
  value: string | null;
  fileName: string | null;
}

export interface MongoExportResult {
  cancelled: boolean;
  path: string | null;
  count: number;
}

export interface MongoImportResult {
  insertedCount: number;
  failedCount: number;
  firstError: string | null;
}

export interface MongoSavedQuery {
  id: string;
  connectionId: string;
  namespace: string;
  name: string;
  kind: MongoSavedQueryKind;
  body: { filter?: string; project?: string; sort?: string; pipeline?: string };
  createdAt: string;
}

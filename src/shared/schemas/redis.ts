import { z } from 'zod';
import { absolutePathSchema, idSchema } from './common';

export const REDIS_SCAN_COUNT_DEFAULT = 500;
export const REDIS_SCAN_COUNT_MAX = 1000;
export const REDIS_PAGE_COUNT_DEFAULT = 100;
export const REDIS_PAGE_COUNT_MAX = 500;
/** A string longer than this is read only up to this many bytes. */
export const REDIS_STRING_MAX_BYTES = 1_048_576;
/** What the console prints before it truncates, whichever limit is reached first. */
export const REDIS_CLI_MAX_BYTES = 1_048_576;
export const REDIS_CLI_MAX_ELEMENTS = 5000;
export const REDIS_COUNT_PATTERN_MAX = 1_000_000;
export const REDIS_DELETE_BATCH = 500;
export const REDIS_MEMORY_SAMPLE_MAX = 5000;
export const REDIS_PUBSUB_MAX_SUBSCRIPTIONS = 3;

/** A value that may be binary travels as base64; text is just the common case. */
export const redisBytesSchema = z.string().max(4_000_000);

// ── connections ────────────────────────────────────────────────────────────

export const redisModeSchema = z.enum(['standalone', 'sentinel', 'cluster']);

export const redisEndpointSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535)
});

/**
 * Everything about a connection that is not a secret. `endpoints` is the one server for standalone, the
 * Sentinels for sentinel, and the seed nodes for cluster. Passwords live in the secret store.
 */
export const redisConnectionOptionsSchema = z.object({
  mode: redisModeSchema,
  endpoints: z.array(redisEndpointSchema).min(1).max(16),
  database: z.number().int().min(0).max(15).optional(),
  username: z.string().trim().max(256).optional(),
  sentinelMaster: z.string().trim().max(128).optional(),
  tls: z.boolean().optional(),
  tlsCAFile: absolutePathSchema.optional(),
  tlsCertFile: absolutePathSchema.optional(),
  tlsKeyFile: absolutePathSchema.optional(),
  /** Accepting any certificate is a decision the user makes knowingly; the UI keeps a warning on the connection. */
  tlsAllowInvalidCertificates: z.boolean().optional(),
  /** Folders in the key tree are cut at this text. */
  keyDelimiter: z.string().min(1).max(3).optional()
});

export const redisSecretInputSchema = z.object({
  password: z.string().max(1024).optional(),
  sentinelPassword: z.string().max(1024).optional(),
  tlsKeyPassword: z.string().max(1024).optional()
});

/** On update, `null` forgets a stored secret and an omitted field keeps it. */
export const redisSecretUpdateSchema = z.object({
  password: z.string().max(1024).nullable().optional(),
  sentinelPassword: z.string().max(1024).nullable().optional(),
  tlsKeyPassword: z.string().max(1024).nullable().optional()
});

const connectionNameSchema = z.string().trim().min(1, 'name is required').max(80);

export const redisConnectionCreateInputSchema = z.object({
  projectId: idSchema,
  environmentId: idSchema.nullable(),
  name: connectionNameSchema,
  options: redisConnectionOptionsSchema,
  secret: redisSecretInputSchema,
  /** Omitted = read-only when the environment is protected, writable otherwise. */
  readOnly: z.boolean().optional(),
  /** Needed to create a writable connection in a protected environment. */
  confirmed: z.boolean().optional()
});

export const redisConnectionUpdateInputSchema = z.object({
  id: idSchema,
  name: connectionNameSchema.optional(),
  environmentId: idSchema.nullable().optional(),
  options: redisConnectionOptionsSchema.optional(),
  secret: redisSecretUpdateSchema.optional(),
  readOnly: z.boolean().optional(),
  confirmed: z.boolean().optional()
});

export const redisConnectionIdInputSchema = z.object({ id: idSchema });
export const redisConnectionListInputSchema = z.object({ projectId: idSchema });

/** Tries a connection that is not saved yet. */
export const redisConnectionDraftInputSchema = z.object({
  projectId: idSchema,
  options: redisConnectionOptionsSchema,
  secret: redisSecretInputSchema,
  /** An edit being tried: secrets left empty are borrowed from this saved connection instead of being lost. */
  secretFrom: idSchema.optional()
});

export const redisPickFileInputSchema = z.object({ purpose: z.enum(['tlsCa', 'tlsCert', 'tlsKey']) });

// ── keys ───────────────────────────────────────────────────────────────────

const keySchema = z.string().min(1).max(4096);
const connectionShape = { connectionId: idSchema };
const keyShape = { ...connectionShape, key: keySchema };

export const redisKeyTypeSchema = z.enum(['string', 'hash', 'list', 'set', 'zset', 'stream', 'ReJSON-RL']);

export const redisScanInputSchema = z.object({
  ...connectionShape,
  /** Opaque: what the previous page returned, or `0` to start. */
  cursor: z.string().max(64),
  pattern: z.string().max(512).optional(),
  type: redisKeyTypeSchema.optional(),
  count: z.number().int().min(10).max(REDIS_SCAN_COUNT_MAX).optional()
});

export const redisKeyGetInputSchema = z.object({
  ...keyShape,
  /** Where to continue a collection; omitted = from the start. What each type means is in RedisValuePage. */
  cursor: z.string().max(64).optional(),
  count: z.number().int().min(1).max(REDIS_PAGE_COUNT_MAX).optional()
});

export const redisKeyInputSchema = z.object(keyShape);

// ── writes ─────────────────────────────────────────────────────────────────

const ttlSecondsSchema = z.number().int().min(1).max(31_536_000 * 10);

export const redisWriteOpSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('string.set'), value: redisBytesSchema, keepTtl: z.boolean().optional() }),
  z.object({ kind: z.literal('hash.set'), field: redisBytesSchema, value: redisBytesSchema }),
  z.object({ kind: z.literal('hash.del'), field: redisBytesSchema }),
  z.object({ kind: z.literal('list.push'), side: z.enum(['left', 'right']), value: redisBytesSchema }),
  z.object({ kind: z.literal('list.set'), index: z.number().int().min(0), value: redisBytesSchema }),
  z.object({ kind: z.literal('list.remove'), value: redisBytesSchema, count: z.number().int().min(-1_000_000).max(1_000_000) }),
  z.object({ kind: z.literal('set.add'), member: redisBytesSchema }),
  z.object({ kind: z.literal('set.remove'), member: redisBytesSchema }),
  z.object({ kind: z.literal('zset.add'), member: redisBytesSchema, score: z.number().finite() }),
  z.object({ kind: z.literal('zset.remove'), member: redisBytesSchema }),
  z.object({
    kind: z.literal('stream.add'),
    id: z.string().regex(/^(\*|\d+(-(\d+|\*))?)$/).optional(),
    /** field, value, field, value … */
    fields: z.array(redisBytesSchema).min(2).max(200).refine((list) => list.length % 2 === 0, 'fields come in pairs')
  }),
  z.object({ kind: z.literal('stream.del'), id: z.string().regex(/^\d+-\d+$/) }),
  z.object({ kind: z.literal('json.set'), value: z.string().max(4_000_000) }),
  z.object({ kind: z.literal('rename'), newKey: keySchema, overwrite: z.boolean().optional() }),
  z.object({ kind: z.literal('ttl.set'), seconds: ttlSecondsSchema }),
  z.object({ kind: z.literal('ttl.persist') })
]);

export const redisKeyWriteInputSchema = z.object({ ...keyShape, op: redisWriteOpSchema });

export const redisKeyDeleteInputSchema = z.object({ ...keyShape, confirmed: z.literal(true) });

export const redisPatternInputSchema = z.object({ ...connectionShape, pattern: z.string().min(1).max(512) });

export const redisPatternDeleteInputSchema = z.object({
  ...connectionShape,
  pattern: z.string().min(1).max(512),
  /** What the user was shown. Main counts again and refuses if the number changed in between. */
  expectedCount: z.number().int().min(0),
  confirmed: z.literal(true),
  /** The pattern `*` matches everything, so the connection's name has to be typed. */
  confirmName: z.string().max(80).optional()
});

// ── workbench ──────────────────────────────────────────────────────────────

export const redisExecuteInputSchema = z.object({
  ...connectionShape,
  /** Already split into arguments (see shared/redis/tokenize); never a line of text for a shell. */
  args: z.array(z.string().max(1_000_000)).min(1).max(1000),
  confirmed: z.boolean().optional(),
  /** Needed with `confirmed` on a connection of a protected environment. */
  confirmName: z.string().max(80).optional()
});

export const redisSavedListInputSchema = z.object({ ...connectionShape });
export const redisSavedSaveInputSchema = z.object({
  ...connectionShape,
  name: z.string().trim().min(1).max(80),
  commandText: z.string().min(1).max(10_000)
});
export const redisSavedDeleteInputSchema = z.object({ id: idSchema });

// ── insights ───────────────────────────────────────────────────────────────

export const redisSlowlogResetInputSchema = z.object({ ...connectionShape, confirmed: z.literal(true) });

export const redisPubsubSubscribeInputSchema = z
  .object({
    ...connectionShape,
    channels: z.array(z.string().min(1).max(512)).max(20),
    patterns: z.array(z.string().min(1).max(512)).max(20)
  })
  .refine((value) => value.channels.length + value.patterns.length > 0, 'subscribe to at least one channel or pattern');

export const redisPubsubUnsubscribeInputSchema = z.object({ subscriptionId: idSchema });

export const redisPubsubPublishInputSchema = z.object({
  ...connectionShape,
  channel: z.string().min(1).max(512),
  message: z.string().max(1_000_000)
});

export const redisMemoryAnalyzeInputSchema = z.object({
  ...connectionShape,
  pattern: z.string().max(512).optional(),
  sample: z.number().int().min(100).max(REDIS_MEMORY_SAMPLE_MAX).optional()
});

// ── types ──────────────────────────────────────────────────────────────────

export type RedisMode = z.infer<typeof redisModeSchema>;
export type RedisEndpoint = z.infer<typeof redisEndpointSchema>;
export type RedisConnectionOptions = z.infer<typeof redisConnectionOptionsSchema>;
export type RedisSecretInput = z.infer<typeof redisSecretInputSchema>;
export type RedisSecretUpdate = z.infer<typeof redisSecretUpdateSchema>;
export type RedisConnectionCreateInput = z.infer<typeof redisConnectionCreateInputSchema>;
export type RedisConnectionUpdateInput = z.infer<typeof redisConnectionUpdateInputSchema>;
export type RedisConnectionIdInput = z.infer<typeof redisConnectionIdInputSchema>;
export type RedisConnectionListInput = z.infer<typeof redisConnectionListInputSchema>;
export type RedisConnectionDraftInput = z.infer<typeof redisConnectionDraftInputSchema>;
export type RedisPickFileInput = z.infer<typeof redisPickFileInputSchema>;
export type RedisKeyType = z.infer<typeof redisKeyTypeSchema>;
export type RedisScanInput = z.infer<typeof redisScanInputSchema>;
export type RedisKeyGetInput = z.infer<typeof redisKeyGetInputSchema>;
export type RedisKeyInput = z.infer<typeof redisKeyInputSchema>;
export type RedisWriteOp = z.infer<typeof redisWriteOpSchema>;
export type RedisKeyWriteInput = z.infer<typeof redisKeyWriteInputSchema>;
export type RedisKeyDeleteInput = z.infer<typeof redisKeyDeleteInputSchema>;
export type RedisPatternInput = z.infer<typeof redisPatternInputSchema>;
export type RedisPatternDeleteInput = z.infer<typeof redisPatternDeleteInputSchema>;
export type RedisExecuteInput = z.infer<typeof redisExecuteInputSchema>;
export type RedisSavedListInput = z.infer<typeof redisSavedListInputSchema>;
export type RedisSavedSaveInput = z.infer<typeof redisSavedSaveInputSchema>;
export type RedisSavedDeleteInput = z.infer<typeof redisSavedDeleteInputSchema>;
export type RedisSlowlogResetInput = z.infer<typeof redisSlowlogResetInputSchema>;
export type RedisPubsubSubscribeInput = z.infer<typeof redisPubsubSubscribeInputSchema>;
export type RedisPubsubUnsubscribeInput = z.infer<typeof redisPubsubUnsubscribeInputSchema>;
export type RedisPubsubPublishInput = z.infer<typeof redisPubsubPublishInputSchema>;
export type RedisMemoryAnalyzeInput = z.infer<typeof redisMemoryAnalyzeInputSchema>;

// ── results ────────────────────────────────────────────────────────────────

export interface RedisConnection {
  id: string;
  projectId: string;
  environmentId: string | null;
  environmentName: string | null;
  /** The environment is protected: the connection starts read-only. */
  protectedEnvironment: boolean;
  name: string;
  /** Host(s) without credentials, e.g. `cache.internal:6379`. */
  hostDisplay: string;
  options: RedisConnectionOptions;
  /** Only whether something is stored; the values never come back. */
  hasPassword: boolean;
  hasSentinelPassword: boolean;
  hasTlsKeyPassword: boolean;
  readOnly: boolean;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RedisTestResult {
  serverVersion: string;
  mode: RedisMode;
  /** `master` or `replica`; a replica is read-only whatever the connection says. */
  role: string;
  latencyMs: number;
  /** Keys in the selected database (the sum over masters in a cluster). */
  dbSize: number;
  usedMemory: number | null;
  /** RedisJSON is loaded on the server. */
  hasJson: boolean;
}

export interface RedisPickedFile {
  cancelled: boolean;
  path: string | null;
}

export interface RedisKeyEntry {
  key: string;
  type: string;
  /** Milliseconds to live; null = no expiry. */
  ttlMs: number | null;
}

export interface RedisScanResult {
  keys: RedisKeyEntry[];
  /** `0` when the scan is complete. */
  cursor: string;
  dbSize: number;
}

export interface RedisKeyMeta {
  key: string;
  type: string;
  ttlMs: number | null;
  encoding: string | null;
}

export interface RedisStreamEntry {
  id: string;
  /** field, value, field, value … */
  fields: string[];
}

/** What a page holds depends on the type. `next` is the cursor to ask for more, or null at the end. */
export type RedisValuePage =
  | { type: 'string'; length: number; value: string; truncated: boolean }
  | { type: 'hash'; total: number; entries: { field: string; value: string }[]; next: string | null }
  | { type: 'list'; total: number; offset: number; items: string[]; next: string | null }
  | { type: 'set'; total: number; members: string[]; next: string | null }
  | { type: 'zset'; total: number; offset: number; members: { member: string; score: number }[]; next: string | null }
  | { type: 'stream'; total: number; entries: RedisStreamEntry[]; next: string | null }
  | { type: 'json'; value: string; truncated: boolean }
  | { type: 'unsupported'; name: string };

export interface RedisKeyGetResult {
  meta: RedisKeyMeta;
  page: RedisValuePage;
}

export interface RedisKeyMemory {
  bytes: number | null;
}

export interface RedisStreamInfo {
  length: number;
  lastGeneratedId: string;
  groups: {
    name: string;
    consumers: number;
    pending: number;
    lastDeliveredId: string;
    members: { name: string; pending: number; idleMs: number }[];
  }[];
}

export interface RedisWriteResult {
  /** The key after the change (a rename moves it). */
  key: string;
}

export interface RedisCountResult {
  count: number;
  /** The count stopped at the limit: there are at least this many. */
  atLeast: boolean;
}

export interface RedisDeleteResult {
  deleted: number;
}

export interface RedisExecuteResult {
  /** Formatted the way redis-cli prints it. */
  output: string;
  truncated: boolean;
  elapsedMs: number;
}

export interface RedisSavedCommand {
  id: string;
  connectionId: string;
  name: string;
  commandText: string;
  createdAt: string;
}

export interface RedisCommandList {
  names: string[];
}

export interface RedisInfoSnapshot {
  takenAt: number;
  role: string;
  version: string;
  uptimeSeconds: number;
  opsPerSec: number;
  usedMemory: number;
  usedMemoryRss: number;
  maxMemory: number;
  connectedClients: number;
  blockedClients: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  expiredKeys: number;
  evictedKeys: number;
  connectedReplicas: number;
  persistence: { rdbLastStatus: string; aofEnabled: boolean; lastSaveTime: number };
  /** `db0` → keys, expires. */
  keyspace: { db: string; keys: number; expires: number }[];
  /** Every INFO field, for the detail view. */
  sections: Record<string, Record<string, string>>;
}

export interface RedisSlowlogEntry {
  id: number;
  at: number;
  durationMicros: number;
  command: string;
  client: string;
}

export interface RedisClientEntry {
  id: string;
  address: string;
  name: string;
  ageSeconds: number;
  idleSeconds: number;
  db: string;
  command: string;
  flags: string;
}

export interface RedisConfigEntry {
  name: string;
  value: string;
}

export interface RedisMemoryGroup {
  name: string;
  keys: number;
  bytes: number;
}

export interface RedisMemoryReport {
  /** Always a sample: said as such on screen. */
  sampled: number;
  dbSize: number;
  totalBytes: number;
  byPrefix: RedisMemoryGroup[];
  byType: RedisMemoryGroup[];
  top: { key: string; type: string; bytes: number }[];
}

export interface RedisSubscription {
  subscriptionId: string;
}

export interface RedisMessageEvent {
  subscriptionId: string;
  channel: string;
  /** The pattern that matched, when the subscription was by pattern. */
  pattern: string | null;
  /** Base64, because a message may be binary. */
  message: string;
  at: number;
}

export interface RedisSubscriptionEndEvent {
  subscriptionId: string;
  reason: string;
}

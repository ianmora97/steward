import type {
  RedisConnection,
  RedisConnectionCreateInput,
  RedisConnectionDraftInput,
  RedisConnectionIdInput,
  RedisConnectionListInput,
  RedisConnectionOptions,
  RedisConnectionUpdateInput,
  RedisTestResult
} from '@shared/schemas/redis';
import { StewardServiceError } from '@shared/types/result';
import {
  deleteDataConnection,
  findDataConnection,
  findDataConnectionByName,
  insertDataConnection,
  listDataConnectionIds,
  listDataConnections,
  updateDataConnection,
  type DataConnectionRecord
} from '../db/data-connection.repo';
import type { SqlDatabase } from '../db/driver';
import { findEnvironmentById } from '../db/environment.repo';
import { nowIso, uuidv7 } from '../db/id';
import type { SecretStore } from '../security/secret-store';
import { translateRedisError } from './redis-errors';
import { openDraftHandle, parseSecret, type RedisHandle, type RedisPool, type RedisSecret } from './redis-pool';
import { asNumber, asText, parseInfo } from './redis-reply';
import { requireProject } from './project.service';

export interface RedisConnectionDeps {
  db: SqlDatabase;
  secrets: SecretStore;
  pool: RedisPool;
}

export function hostDisplayOf(options: RedisConnectionOptions): string {
  const list = options.endpoints.map((endpoint) => `${endpoint.host}:${endpoint.port}`);
  const label = list.length > 2 ? `${list.slice(0, 2).join(', ')} +${list.length - 2}` : list.join(', ');
  if (options.mode === 'sentinel') return `${options.sentinelMaster ?? 'master'} via ${label}`;
  return label;
}

/** A Sentinel connection must name its master; the schema cannot say it because it depends on the mode. */
function assertOptionsConsistent(options: RedisConnectionOptions): void {
  if (options.mode === 'standalone' && options.endpoints.length !== 1) {
    throw new StewardServiceError('VALIDATION_FAILED', 'A standalone connection has exactly one server address');
  }
  if (options.mode === 'sentinel' && (options.sentinelMaster === undefined || options.sentinelMaster.trim() === '')) {
    throw new StewardServiceError('VALIDATION_FAILED', 'A Sentinel connection needs the name of the master');
  }
  if (options.mode === 'cluster' && options.database !== undefined && options.database !== 0) {
    throw new StewardServiceError('VALIDATION_FAILED', 'A cluster has only database 0');
  }
  if (options.tlsAllowInvalidCertificates === true && options.tls !== true) {
    throw new StewardServiceError('VALIDATION_FAILED', 'Accepting invalid certificates only applies when TLS is on');
  }
}

export function createRedisConnectionService(deps: RedisConnectionDeps) {
  const { db, secrets, pool } = deps;

  function environmentOf(projectId: string, environmentId: string | null): { name: string | null; isProtected: boolean } {
    if (environmentId === null) return { name: null, isProtected: false };
    const environment = findEnvironmentById(db, environmentId);
    if (environment === null || environment.projectId !== projectId) {
      throw new StewardServiceError('NOT_FOUND', 'that environment no longer exists');
    }
    return { name: environment.name, isProtected: environment.isProtected };
  }

  function toView(record: DataConnectionRecord): RedisConnection {
    const environment =
      record.environmentId === null ? { name: null, isProtected: false } : environmentOf(record.projectId, record.environmentId);
    const secret = parseSecret(secrets.load(record.id));
    return {
      id: record.id,
      projectId: record.projectId,
      environmentId: record.environmentId,
      environmentName: environment.name,
      protectedEnvironment: environment.isProtected,
      name: record.name,
      hostDisplay: record.hostDisplay,
      options: record.options as RedisConnectionOptions,
      hasPassword: (secret?.password ?? '') !== '',
      hasSentinelPassword: (secret?.sentinelPassword ?? '') !== '',
      hasTlsKeyPassword: (secret?.tlsKeyPassword ?? '') !== '',
      readOnly: record.readOnly,
      lastConnectedAt: record.lastConnectedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  function requireRecord(id: string): DataConnectionRecord {
    const record = findDataConnection(db, id);
    if (record === null || record.kind !== 'redis') {
      throw new StewardServiceError('NOT_FOUND', 'that connection no longer exists');
    }
    return record;
  }

  function assertNameFree(projectId: string, name: string, exceptId: string | null): void {
    const clash = findDataConnectionByName(db, projectId, 'redis', name);
    if (clash !== null && clash.id !== exceptId) {
      throw new StewardServiceError('CONFLICT', 'a Redis connection with that name already exists in this project');
    }
  }

  function list(input: RedisConnectionListInput): RedisConnection[] {
    requireProject(db, input.projectId);
    return listDataConnections(db, input.projectId, 'redis').map(toView);
  }

  function create(input: RedisConnectionCreateInput): RedisConnection {
    requireProject(db, input.projectId);
    assertOptionsConsistent(input.options);
    const environment = environmentOf(input.projectId, input.environmentId);
    assertNameFree(input.projectId, input.name, null);

    // A protected environment starts read-only; opening it for writes is a decision the user confirms.
    const readOnly = input.readOnly ?? environment.isProtected;
    if (!readOnly && environment.isProtected && input.confirmed !== true) {
      throw new StewardServiceError(
        'CONFIRMATION_REQUIRED',
        'This environment is protected, so connections start read-only',
        'Confirm that this connection may write.'
      );
    }

    const secret: RedisSecret = {};
    if (input.secret.password !== undefined && input.secret.password !== '') secret.password = input.secret.password;
    if (input.secret.sentinelPassword !== undefined && input.secret.sentinelPassword !== '') {
      secret.sentinelPassword = input.secret.sentinelPassword;
    }
    if (input.secret.tlsKeyPassword !== undefined && input.secret.tlsKeyPassword !== '') {
      secret.tlsKeyPassword = input.secret.tlsKeyPassword;
    }
    const id = uuidv7();
    const now = nowIso();

    // The secret goes first: with no way to encrypt it nothing is stored, and a failed insert removes it again.
    secrets.save(id, JSON.stringify(secret));
    try {
      const record: DataConnectionRecord = {
        id,
        projectId: input.projectId,
        environmentId: input.environmentId,
        kind: 'redis',
        name: input.name,
        hostDisplay: hostDisplayOf(input.options),
        options: input.options,
        readOnly,
        lastConnectedAt: null,
        createdAt: now,
        updatedAt: now
      };
      insertDataConnection(db, record);
      return toView(record);
    } catch (error) {
      secrets.remove(id);
      throw error;
    }
  }

  async function update(input: RedisConnectionUpdateInput): Promise<RedisConnection> {
    const record = requireRecord(input.id);
    const environmentId = input.environmentId === undefined ? record.environmentId : input.environmentId;
    const environment = environmentOf(record.projectId, environmentId);
    const name = input.name ?? record.name;
    assertNameFree(record.projectId, name, record.id);
    const options = input.options ?? (record.options as RedisConnectionOptions);
    assertOptionsConsistent(options);

    const readOnly = input.readOnly ?? record.readOnly;
    if (record.readOnly && !readOnly && environment.isProtected && input.confirmed !== true) {
      throw new StewardServiceError(
        'CONFIRMATION_REQUIRED',
        'This environment is protected',
        'Confirm that this connection may write.'
      );
    }

    if (input.secret !== undefined) {
      const previous = parseSecret(secrets.load(record.id)) ?? {};
      const next: RedisSecret = { ...previous };
      const apply = (field: keyof RedisSecret, value: string | null | undefined): void => {
        if (value === undefined) return;
        if (value === null || value === '') delete next[field];
        else next[field] = value;
      };
      apply('password', input.secret.password);
      apply('sentinelPassword', input.secret.sentinelPassword);
      apply('tlsKeyPassword', input.secret.tlsKeyPassword);
      secrets.save(record.id, JSON.stringify(next));
    }

    const updated: DataConnectionRecord = {
      ...record,
      environmentId,
      name,
      hostDisplay: hostDisplayOf(options),
      options,
      readOnly,
      updatedAt: nowIso()
    };
    updateDataConnection(db, updated);
    // Any change may alter how it connects: the next use opens a fresh client.
    await pool.close(record.id);
    return toView(updated);
  }

  async function remove(input: RedisConnectionIdInput): Promise<{ id: string }> {
    const record = requireRecord(input.id);
    await pool.close(record.id);
    secrets.remove(record.id);
    deleteDataConnection(db, record.id);
    return { id: record.id };
  }

  /** Called before a project is deleted: its rows would cascade, but their encrypted secrets would stay behind. */
  async function purgeProject(projectId: string): Promise<void> {
    for (const id of listDataConnectionIds(db, projectId)) {
      await pool.close(id);
      secrets.remove(id);
    }
  }

  async function probe(handle: RedisHandle): Promise<RedisTestResult> {
    const started = Date.now();
    await handle.send(['PING']);
    const latencyMs = Date.now() - started;

    const server = parseInfo(asText(await handle.send(['INFO', 'server'])));
    const memory = parseInfo(asText(await handle.send(['INFO', 'memory'])));
    const replication = parseInfo(asText(await handle.send(['INFO', 'replication'])));
    const role = replication['replication']?.['role'] ?? 'master';

    let dbSize = 0;
    for (const node of await handle.nodes()) dbSize += asNumber(await node.send(['DBSIZE']));

    // MODULE LIST may be forbidden to this user, which only means the answer is "no, as far as we can tell".
    const hasJson = await handle.send(['MODULE', 'LIST']).then(
      (modules) => JSON.stringify(modules, (_key, value: unknown) => (Buffer.isBuffer(value) ? value.toString('utf8') : value)).includes('ReJSON'),
      () => false
    );

    const usedMemory = Number(memory['memory']?.['used_memory']);
    return {
      serverVersion: server['server']?.['redis_version'] ?? 'unknown',
      mode: handle.mode,
      role,
      latencyMs,
      dbSize,
      usedMemory: Number.isFinite(usedMemory) ? usedMemory : null,
      hasJson
    };
  }

  async function test(input: RedisConnectionIdInput): Promise<RedisTestResult> {
    const record = requireRecord(input.id);
    const { handle } = await pool.acquire(record.id);
    try {
      return await probe(handle);
    } catch (error) {
      throw translateRedisError(error);
    }
  }

  async function testDraft(input: RedisConnectionDraftInput): Promise<RedisTestResult> {
    requireProject(db, input.projectId);
    assertOptionsConsistent(input.options);
    const secret: RedisSecret = { ...(input.secretFrom === undefined ? {} : (parseSecret(secrets.load(requireRecord(input.secretFrom).id)) ?? {})) };
    for (const field of ['password', 'sentinelPassword', 'tlsKeyPassword'] as const) {
      const typed = input.secret[field];
      if (typed !== undefined && typed !== '') secret[field] = typed;
    }
    const handle = await openDraftHandle(input.options, secret);
    try {
      return await probe(handle);
    } catch (error) {
      throw translateRedisError(error);
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  return { list, create, update, remove, purgeProject, test, testDraft };
}

export type RedisConnectionService = ReturnType<typeof createRedisConnectionService>;

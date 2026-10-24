import { MongoClient } from 'mongodb';
import type {
  MongoConnection,
  MongoConnectionCreateInput,
  MongoConnectionDraftInput,
  MongoConnectionIdInput,
  MongoConnectionListInput,
  MongoConnectionOptions,
  MongoConnectionUpdateInput,
  MongoTestResult
} from '@shared/schemas/mongodb';
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
import { translateMongoError } from './mongo-errors';
import { clientOptions, parseSecret, type MongoPool, type MongoSecret } from './mongo-pool';
import { buildUri, hostDisplayOf, isAtlas } from './mongo-uri';
import { requireProject } from './project.service';

export interface MongoConnectionDeps {
  db: SqlDatabase;
  secrets: SecretStore;
  pool: MongoPool;
}

export function createMongoConnectionService(deps: MongoConnectionDeps) {
  const { db, secrets, pool } = deps;

  function environmentOf(projectId: string, environmentId: string | null): { name: string | null; isProtected: boolean } {
    if (environmentId === null) return { name: null, isProtected: false };
    const environment = findEnvironmentById(db, environmentId);
    if (environment === null || environment.projectId !== projectId) {
      throw new StewardServiceError('NOT_FOUND', 'that environment no longer exists');
    }
    return { name: environment.name, isProtected: environment.isProtected };
  }

  function toView(record: DataConnectionRecord): MongoConnection {
    const environment =
      record.environmentId === null ? { name: null, isProtected: false } : environmentOf(record.projectId, record.environmentId);
    return {
      id: record.id,
      projectId: record.projectId,
      environmentId: record.environmentId,
      environmentName: environment.name,
      protectedEnvironment: environment.isProtected,
      name: record.name,
      hostDisplay: record.hostDisplay,
      isAtlas: isAtlas(record.hostDisplay),
      options: record.options as MongoConnectionOptions,
      readOnly: record.readOnly,
      lastConnectedAt: record.lastConnectedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  function requireRecord(id: string): DataConnectionRecord {
    const record = findDataConnection(db, id);
    if (record === null || record.kind !== 'mongodb') {
      throw new StewardServiceError('NOT_FOUND', 'that connection no longer exists');
    }
    return record;
  }

  function assertNameFree(projectId: string, name: string, exceptId: string | null): void {
    const clash = findDataConnectionByName(db, projectId, 'mongodb', name);
    if (clash !== null && clash.id !== exceptId) {
      throw new StewardServiceError('CONFLICT', 'a MongoDB connection with that name already exists in this project');
    }
  }

  function list(input: MongoConnectionListInput): MongoConnection[] {
    requireProject(db, input.projectId);
    return listDataConnections(db, input.projectId, 'mongodb').map(toView);
  }

  function create(input: MongoConnectionCreateInput): MongoConnection {
    requireProject(db, input.projectId);
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

    const uri = buildUri(input.secret);
    const secret: MongoSecret = { uri, ...(input.tlsKeyPassword === undefined || input.tlsKeyPassword === '' ? {} : { tlsKeyPassword: input.tlsKeyPassword }) };
    const id = uuidv7();
    const now = nowIso();

    // The secret goes first: with no way to encrypt it nothing is stored, and a failed insert removes it again.
    secrets.save(id, JSON.stringify(secret));
    try {
      const record: DataConnectionRecord = {
        id,
        projectId: input.projectId,
        environmentId: input.environmentId,
        kind: 'mongodb',
        name: input.name,
        hostDisplay: hostDisplayOf(uri),
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

  async function update(input: MongoConnectionUpdateInput): Promise<MongoConnection> {
    const record = requireRecord(input.id);
    const environmentId = input.environmentId === undefined ? record.environmentId : input.environmentId;
    const environment = environmentOf(record.projectId, environmentId);
    const name = input.name ?? record.name;
    assertNameFree(record.projectId, name, record.id);

    const readOnly = input.readOnly ?? record.readOnly;
    if (record.readOnly && !readOnly && environment.isProtected && input.confirmed !== true) {
      throw new StewardServiceError(
        'CONFIRMATION_REQUIRED',
        'This environment is protected',
        'Confirm that this connection may write.'
      );
    }

    let hostDisplay = record.hostDisplay;
    if (input.secret !== undefined || input.tlsKeyPassword !== undefined) {
      const previous = parseSecret(secrets.load(record.id));
      const uri = input.secret === undefined ? (previous?.uri ?? null) : buildUri(input.secret);
      if (uri === null) {
        throw new StewardServiceError('NOT_FOUND', 'The stored credentials of this connection are missing', 'Enter its URI or credentials again.');
      }
      const tlsKeyPassword =
        input.tlsKeyPassword === undefined ? previous?.tlsKeyPassword : input.tlsKeyPassword === null || input.tlsKeyPassword === '' ? undefined : input.tlsKeyPassword;
      const next: MongoSecret = { uri, ...(tlsKeyPassword === undefined ? {} : { tlsKeyPassword }) };
      secrets.save(record.id, JSON.stringify(next));
      hostDisplay = hostDisplayOf(uri);
    }

    const updated: DataConnectionRecord = {
      ...record,
      environmentId,
      name,
      hostDisplay,
      options: input.options ?? record.options,
      readOnly,
      updatedAt: nowIso()
    };
    updateDataConnection(db, updated);
    // Any change may alter how it connects: the next use opens a fresh client.
    await pool.close(record.id);
    return toView(updated);
  }

  async function remove(input: MongoConnectionIdInput): Promise<{ id: string }> {
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

  async function ping(client: MongoClient): Promise<MongoTestResult> {
    const started = Date.now();
    const admin = client.db('admin');
    await admin.command({ ping: 1 });
    const latencyMs = Date.now() - started;
    const build = (await admin.command({ buildInfo: 1 }).catch(() => ({}))) as { version?: string };
    const topology = (client as unknown as { topology?: { description?: { type?: string } } }).topology?.description?.type;
    return { serverVersion: build.version ?? 'unknown', latencyMs, topology: topology ?? 'Unknown' };
  }

  async function test(input: MongoConnectionIdInput): Promise<MongoTestResult> {
    const record = requireRecord(input.id);
    const { client } = await pool.acquire(record.id);
    try {
      return await ping(client);
    } catch (error) {
      throw translateMongoError(error, record.hostDisplay);
    }
  }

  async function testDraft(input: MongoConnectionDraftInput): Promise<MongoTestResult> {
    requireProject(db, input.projectId);
    const uri = buildUri(input.secret);
    const secret: MongoSecret = { uri, ...(input.tlsKeyPassword === undefined || input.tlsKeyPassword === '' ? {} : { tlsKeyPassword: input.tlsKeyPassword }) };
    const client = new MongoClient(uri, clientOptions(input.options, secret));
    try {
      await client.connect();
      return await ping(client);
    } catch (error) {
      throw translateMongoError(error, hostDisplayOf(uri));
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  return { list, create, update, remove, purgeProject, test, testDraft };
}

export type MongoConnectionService = ReturnType<typeof createMongoConnectionService>;

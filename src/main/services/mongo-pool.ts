import { MongoClient, type MongoClientOptions } from 'mongodb';
import type { MongoConnectionOptions } from '@shared/schemas/mongodb';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { findDataConnection, touchDataConnection, type DataConnectionRecord } from '../db/data-connection.repo';
import { nowIso } from '../db/id';
import { validateExistingFile } from '../security/paths';
import type { SecretStore } from '../security/secret-store';
import { translateMongoError } from './mongo-errors';

/** A connection that has not been used for this long is closed; the next use opens it again. */
const IDLE_MS = 10 * 60 * 1000;
const MAX_OPEN_CLIENTS = 6;
const SERVER_SELECTION_TIMEOUT_MS = 8000;

/** What is kept encrypted for a connection: the URI (with its password) and the client key's passphrase. */
export interface MongoSecret {
  uri: string;
  tlsKeyPassword?: string;
}

interface Entry {
  client: MongoClient;
  lastUsed: number;
}

export function parseSecret(raw: string | null): MongoSecret | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MongoSecret>;
    return typeof parsed.uri === 'string' ? { uri: parsed.uri, ...(parsed.tlsKeyPassword === undefined ? {} : { tlsKeyPassword: parsed.tlsKeyPassword }) } : null;
  } catch {
    return null;
  }
}

/** Driver options for a connection. Files are checked here; timeouts are always set so nothing hangs. */
export function clientOptions(options: MongoConnectionOptions, secret: MongoSecret): MongoClientOptions {
  const result: MongoClientOptions = {
    serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    connectTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    maxPoolSize: 4,
    appName: 'Steward'
  };
  if (options.authSource !== undefined && options.authSource !== '') result.authSource = options.authSource;
  if (options.authMechanism === 'X509') result.authMechanism = 'MONGODB-X509';
  else if (options.authMechanism === 'SCRAM-SHA-256' || options.authMechanism === 'SCRAM-SHA-1') {
    result.authMechanism = options.authMechanism;
  }
  if (options.replicaSet !== undefined && options.replicaSet !== '') result.replicaSet = options.replicaSet;
  if (options.readPreference !== undefined) result.readPreference = options.readPreference;
  if (options.directConnection !== undefined) result.directConnection = options.directConnection;
  if (options.tls !== undefined) result.tls = options.tls;
  if (options.tlsCAFile !== undefined) result.tlsCAFile = validateExistingFile(options.tlsCAFile).path;
  if (options.tlsCertificateKeyFile !== undefined) {
    result.tlsCertificateKeyFile = validateExistingFile(options.tlsCertificateKeyFile).path;
    if (secret.tlsKeyPassword !== undefined) result.tlsCertificateKeyFilePassword = secret.tlsKeyPassword;
  }
  if (options.tlsAllowInvalidCertificates === true) result.tlsAllowInvalidCertificates = true;
  return result;
}

export interface MongoPoolDeps {
  db: SqlDatabase;
  secrets: SecretStore;
}

/**
 * The open clients, one per connection, opened on first use and closed when idle, when the connection or
 * its project is deleted, and when the app quits. Clients are never handed to the renderer.
 */
export function createMongoPool(deps: MongoPoolDeps) {
  const { db, secrets } = deps;
  const entries = new Map<string, Entry>();
  const opening = new Map<string, Promise<MongoClient>>();

  const sweeper = setInterval(() => {
    const limit = Date.now() - IDLE_MS;
    for (const [id, entry] of entries) {
      if (entry.lastUsed < limit) void close(id);
    }
  }, 60_000);
  sweeper.unref();

  async function close(id: string): Promise<void> {
    const entry = entries.get(id);
    entries.delete(id);
    opening.delete(id);
    if (entry !== undefined) await entry.client.close().catch(() => undefined);
  }

  async function open(record: DataConnectionRecord): Promise<MongoClient> {
    const secret = parseSecret(secrets.load(record.id));
    if (secret === null) {
      throw new StewardServiceError(
        'NOT_FOUND',
        'The stored credentials of this connection are missing',
        'Edit the connection and enter its URI or credentials again.'
      );
    }

    // Opening a seventh client closes the one that has waited longest.
    if (entries.size >= MAX_OPEN_CLIENTS) {
      const oldest = [...entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest !== undefined) await close(oldest[0]);
    }

    const client = new MongoClient(secret.uri, clientOptions(record.options as MongoConnectionOptions, secret));
    try {
      await client.connect();
    } catch (error) {
      await client.close().catch(() => undefined);
      throw translateMongoError(error, record.hostDisplay);
    }
    entries.set(record.id, { client, lastUsed: Date.now() });
    touchDataConnection(db, record.id, nowIso());
    return client;
  }

  /** The connected client for a connection of this kind, plus its record. */
  async function acquire(connectionId: string): Promise<{ client: MongoClient; record: DataConnectionRecord }> {
    const record = findDataConnection(db, connectionId);
    if (record === null || record.kind !== 'mongodb') {
      throw new StewardServiceError('NOT_FOUND', 'that connection no longer exists');
    }
    const existing = entries.get(record.id);
    if (existing !== undefined) {
      existing.lastUsed = Date.now();
      return { client: existing.client, record };
    }
    let pending = opening.get(record.id);
    if (pending === undefined) {
      pending = open(record).finally(() => opening.delete(record.id));
      opening.set(record.id, pending);
    }
    return { client: await pending, record };
  }

  async function closeAll(): Promise<void> {
    clearInterval(sweeper);
    await Promise.all([...entries.keys()].map((id) => close(id)));
  }

  return { acquire, close, closeAll };
}

export type MongoPool = ReturnType<typeof createMongoPool>;

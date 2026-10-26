import { readFileSync } from 'node:fs';
import {
  createClient,
  createCluster,
  createSentinel,
  RESP_TYPES,
  type RedisClientType,
  type RedisClusterType,
  type RedisSentinelType
} from '@redis/client';
import type { RedisConnectionOptions, RedisEndpoint, RedisMode } from '@shared/schemas/redis';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { findDataConnection, touchDataConnection, type DataConnectionRecord } from '../db/data-connection.repo';
import { nowIso } from '../db/id';
import { validateExistingFile } from '../security/paths';
import type { SecretStore } from '../security/secret-store';
import { translateRedisError } from './redis-errors';

/** A connection that has not been used for this long is closed; the next use opens it again. */
const IDLE_MS = 10 * 60 * 1000;
const MAX_OPEN_CLIENTS = 6;
const CONNECT_TIMEOUT_MS = 8000;
/** Every operation is bounded. A command already sent cannot be cancelled on the server; the wait can. */
export const OPERATION_TIMEOUT_MS = 15_000;

/** What is kept encrypted for a connection. Hosts and users are not secret and live in the row's options. */
export interface RedisSecret {
  password?: string;
  sentinelPassword?: string;
  tlsKeyPassword?: string;
}

export function parseSecret(raw: string | null): RedisSecret | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const secret: RedisSecret = {};
    if (typeof parsed['password'] === 'string') secret.password = parsed['password'];
    if (typeof parsed['sentinelPassword'] === 'string') secret.sentinelPassword = parsed['sentinelPassword'];
    if (typeof parsed['tlsKeyPassword'] === 'string') secret.tlsKeyPassword = parsed['tlsKeyPassword'];
    return secret;
  } catch {
    return null;
  }
}

/** Arguments are text or raw bytes; replies come back with every bulk string as a Buffer. */
export type RedisArg = string | Buffer;
export type RedisReply = null | number | string | Buffer | Error | RedisReply[];

/** One master (or the only server): where a SCAN or an INFO runs. */
export interface RedisNode {
  id: string;
  send: (args: RedisArg[]) => Promise<RedisReply>;
}

export interface RedisHandle {
  mode: RedisMode;
  /** Runs one command. `key` routes it in a cluster; elsewhere it is ignored. */
  send: (args: RedisArg[], key?: RedisArg) => Promise<RedisReply>;
  /** The masters, one for a standalone or Sentinel connection. */
  nodes: () => Promise<RedisNode[]>;
  /** A fresh connection for Pub/Sub, which cannot share the one used for commands. */
  createSubscriber: () => Promise<RedisClientType>;
  isOpen: () => boolean;
  close: () => Promise<void>;
}

const BUFFER_REPLIES = { typeMapping: { [RESP_TYPES.BLOB_STRING]: Buffer } };

export function withTimeout<T>(work: Promise<T>, ms = OPERATION_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeout = new Error('timeout: the operation took too long');
      timeout.name = 'TimeoutError';
      reject(timeout);
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function socketCommon(options: RedisConnectionOptions, secret: RedisSecret): Record<string, unknown> {
  const socket: Record<string, unknown> = {
    connectTimeout: CONNECT_TIMEOUT_MS,
    // A dropped link is retried briefly and then reported, so the pool can open a fresh client instead of hanging.
    reconnectStrategy: (retries: number, cause: Error): number | Error => (retries >= 3 ? cause : (retries + 1) * 200)
  };
  if (options.tls === true) {
    socket['tls'] = true;
    socket['rejectUnauthorized'] = options.tlsAllowInvalidCertificates !== true;
    if (options.tlsCAFile !== undefined) socket['ca'] = readFileSync(validateExistingFile(options.tlsCAFile).path);
    if (options.tlsCertFile !== undefined) socket['cert'] = readFileSync(validateExistingFile(options.tlsCertFile).path);
    if (options.tlsKeyFile !== undefined) {
      socket['key'] = readFileSync(validateExistingFile(options.tlsKeyFile).path);
      if (secret.tlsKeyPassword !== undefined) socket['passphrase'] = secret.tlsKeyPassword;
    }
  }
  return socket;
}

function credentials(options: RedisConnectionOptions, secret: RedisSecret): { username?: string; password?: string } {
  const result: { username?: string; password?: string } = {};
  if (options.username !== undefined && options.username !== '') result.username = options.username;
  if (secret.password !== undefined && secret.password !== '') result.password = secret.password;
  return result;
}

function endpointSocket(endpoint: RedisEndpoint, options: RedisConnectionOptions, secret: RedisSecret): Record<string, unknown> {
  return { host: endpoint.host, port: endpoint.port, ...socketCommon(options, secret) };
}

function silence(emitter: { on: (event: 'error', listener: (error: unknown) => void) => unknown }): void {
  // An 'error' event with no listener would take the main process down; the failure surfaces on the next command.
  emitter.on('error', () => undefined);
}

interface RawSender {
  sendCommand: (args: RedisArg[], options: unknown) => Promise<unknown>;
}

function nodeOf(id: string, sender: RawSender): RedisNode {
  return { id, send: (args) => withTimeout(sender.sendCommand(args, BUFFER_REPLIES)) as Promise<RedisReply> };
}

async function openStandalone(
  endpoint: RedisEndpoint,
  options: RedisConnectionOptions,
  secret: RedisSecret
): Promise<RedisClientType> {
  const client = createClient({
    RESP: 2,
    name: 'Steward',
    socket: endpointSocket(endpoint, options, secret),
    ...credentials(options, secret),
    ...(options.database === undefined || options.database === 0 ? {} : { database: options.database })
  } as never) as unknown as RedisClientType;
  silence(client as unknown as Parameters<typeof silence>[0]);
  await client.connect();
  return client;
}

async function openHandle(options: RedisConnectionOptions, secret: RedisSecret): Promise<RedisHandle> {
  const first = options.endpoints[0];
  if (first === undefined) throw new StewardServiceError('VALIDATION_FAILED', 'This connection has no server address');

  if (options.mode === 'standalone') {
    const client = await openStandalone(first, options, secret);
    const node = nodeOf(`${first.host}:${first.port}`, client as unknown as RawSender);
    return {
      mode: 'standalone',
      send: (args) => node.send(args),
      nodes: () => Promise.resolve([node]),
      createSubscriber: async () => {
        const subscriber = client.duplicate();
        silence(subscriber as unknown as Parameters<typeof silence>[0]);
        await subscriber.connect();
        return subscriber;
      },
      isOpen: () => client.isOpen,
      close: async () => {
        client.destroy();
      }
    };
  }

  if (options.mode === 'sentinel') {
    if (options.sentinelMaster === undefined || options.sentinelMaster === '') {
      throw new StewardServiceError('VALIDATION_FAILED', 'A Sentinel connection needs the name of the master');
    }
    const common = socketCommon(options, secret);
    const sentinel = createSentinel({
      RESP: 2,
      name: options.sentinelMaster,
      sentinelRootNodes: options.endpoints.map((endpoint) => ({ host: endpoint.host, port: endpoint.port })),
      nodeClientOptions: {
        name: 'Steward',
        socket: common,
        ...credentials(options, secret),
        ...(options.database === undefined || options.database === 0 ? {} : { database: options.database })
      },
      sentinelClientOptions: {
        socket: common,
        ...(secret.sentinelPassword === undefined ? {} : { password: secret.sentinelPassword })
      }
    } as never) as unknown as RedisSentinelType;
    silence(sentinel as unknown as Parameters<typeof silence>[0]);
    await sentinel.connect();
    const send: RedisHandle['send'] = (args) =>
      withTimeout(
        (sentinel as unknown as { sendCommand: (readonly: boolean, args: RedisArg[], options: unknown) => Promise<unknown> }).sendCommand(
          false,
          args,
          BUFFER_REPLIES
        )
      ) as Promise<RedisReply>;
    return {
      mode: 'sentinel',
      send,
      nodes: () => Promise.resolve([{ id: options.sentinelMaster ?? 'master', send: (args) => send(args) }]),
      createSubscriber: () => {
        return Promise.reject(new StewardServiceError(
          'REDIS_FAILED',
          'Pub/Sub is not available through a Sentinel connection',
          'Create a standalone connection to the master to use Pub/Sub.'
        ));
      },
      isOpen: () => (sentinel as unknown as { isOpen: boolean }).isOpen,
      close: async () => {
        (sentinel as unknown as { destroy: () => void }).destroy();
      }
    };
  }

  const common = socketCommon(options, secret);
  const cluster = createCluster({
    RESP: 2,
    rootNodes: options.endpoints.map((endpoint) => ({ socket: endpointSocket(endpoint, options, secret) })),
    defaults: { name: 'Steward', socket: common, ...credentials(options, secret) }
  } as never) as unknown as RedisClusterType;
  silence(cluster as unknown as Parameters<typeof silence>[0]);
  await cluster.connect();
  const raw = cluster as unknown as {
    sendCommand: (key: RedisArg | undefined, readonly: boolean, args: RedisArg[], options: unknown) => Promise<unknown>;
    masters: { address: string }[];
    nodeClient: (node: unknown) => Promise<RawSender>;
    isOpen: boolean;
    destroy: () => void;
  };
  return {
    mode: 'cluster',
    send: (args, key) => withTimeout(raw.sendCommand(key, false, args, BUFFER_REPLIES)) as Promise<RedisReply>,
    nodes: async () => {
      const result: RedisNode[] = [];
      for (const master of raw.masters) result.push(nodeOf(master.address, await raw.nodeClient(master)));
      return result;
    },
    createSubscriber: async () => {
      // Pub/Sub messages are broadcast across a cluster, so one master is enough.
      const master = raw.masters[0];
      const address = master?.address ?? `${first.host}:${first.port}`;
      const separator = address.lastIndexOf(':');
      const port = Number(address.slice(separator + 1));
      return openStandalone({ host: address.slice(0, separator), port: Number.isFinite(port) ? port : first.port }, { ...options, database: undefined }, secret);
    },
    isOpen: () => raw.isOpen,
    close: async () => {
      raw.destroy();
    }
  };
}

interface Entry {
  handle: RedisHandle;
  lastUsed: number;
}

export interface RedisPoolDeps {
  db: SqlDatabase;
  secrets: SecretStore;
}

/**
 * The open handles, one per connection, opened on first use and closed when idle, when the connection or its
 * project is deleted, and when the app quits. Handles never reach the renderer.
 */
export function createRedisPool(deps: RedisPoolDeps) {
  const { db, secrets } = deps;
  const entries = new Map<string, Entry>();
  const opening = new Map<string, Promise<RedisHandle>>();
  const closeListeners = new Set<(connectionId: string) => void>();

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
    for (const listener of closeListeners) listener(id);
    if (entry !== undefined) await entry.handle.close().catch(() => undefined);
  }

  async function open(record: DataConnectionRecord): Promise<RedisHandle> {
    const secret = parseSecret(secrets.load(record.id));
    if (secret === null) {
      throw new StewardServiceError(
        'NOT_FOUND',
        'The stored credentials of this connection are missing',
        'Edit the connection and enter its password again.'
      );
    }

    // Opening a seventh client closes the one that has waited longest.
    if (entries.size >= MAX_OPEN_CLIENTS) {
      const oldest = [...entries.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest !== undefined) await close(oldest[0]);
    }

    let handle: RedisHandle;
    try {
      handle = await withTimeout(openHandle(record.options as RedisConnectionOptions, secret), CONNECT_TIMEOUT_MS + 2000);
    } catch (error) {
      throw translateRedisError(error);
    }
    entries.set(record.id, { handle, lastUsed: Date.now() });
    touchDataConnection(db, record.id, nowIso());
    return handle;
  }

  /** The connected handle for a connection of this kind, plus its record. */
  async function acquire(connectionId: string): Promise<{ handle: RedisHandle; record: DataConnectionRecord }> {
    const record = findDataConnection(db, connectionId);
    if (record === null || record.kind !== 'redis') {
      throw new StewardServiceError('NOT_FOUND', 'that connection no longer exists');
    }
    const existing = entries.get(record.id);
    if (existing !== undefined) {
      if (existing.handle.isOpen()) {
        existing.lastUsed = Date.now();
        return { handle: existing.handle, record };
      }
      await close(record.id);
    }
    let pending = opening.get(record.id);
    if (pending === undefined) {
      pending = open(record).finally(() => opening.delete(record.id));
      opening.set(record.id, pending);
    }
    return { handle: await pending, record };
  }

  /** Called when a connection's client goes away, so anything riding on it (Pub/Sub) can let go too. */
  function onClose(listener: (connectionId: string) => void): () => void {
    closeListeners.add(listener);
    return () => {
      closeListeners.delete(listener);
    };
  }

  async function closeAll(): Promise<void> {
    clearInterval(sweeper);
    await Promise.all([...entries.keys()].map((id) => close(id)));
  }

  return { acquire, close, closeAll, onClose };
}

export type RedisPool = ReturnType<typeof createRedisPool>;

/** Opens a handle that is not stored, to try a connection that is not saved yet. */
export async function openDraftHandle(options: RedisConnectionOptions, secret: RedisSecret): Promise<RedisHandle> {
  try {
    return await withTimeout(openHandle(options, secret), CONNECT_TIMEOUT_MS + 2000);
  } catch (error) {
    throw translateRedisError(error);
  }
}

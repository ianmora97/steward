import type { RedisMessageEvent, RedisPickedFile, RedisPickFileInput, RedisSubscriptionEndEvent } from '@shared/schemas/redis';
import type { SqlDatabase } from '../db/driver';
import { validateExistingFile } from '../security/paths';
import type { SecretStore } from '../security/secret-store';
import { createRedisAccess } from './redis-access';
import { createRedisCliService } from './redis-cli.service';
import { createRedisConnectionService } from './redis-connection.service';
import { createRedisInfoService } from './redis-info.service';
import { createRedisKeysService } from './redis-keys.service';
import { createRedisMemoryService } from './redis-memory.service';
import { createRedisPool } from './redis-pool';
import { createRedisPubsubService } from './redis-pubsub.service';
import { createRedisWriteService } from './redis-write.service';

export interface RedisDialogs {
  /** Opens the OS file picker; null when the user cancels. */
  pickFile: (purpose: RedisPickFileInput['purpose']) => Promise<string | null>;
}

export interface RedisServiceDeps {
  db: SqlDatabase;
  secrets: SecretStore;
  dialogs: RedisDialogs;
  emitMessage: (event: RedisMessageEvent) => void;
  emitSubscriptionEnd: (event: RedisSubscriptionEndEvent) => void;
}

/** Redis as the IPC layer sees it: connections, keys, console, monitoring and Pub/Sub behind one object. */
export function createRedisService(deps: RedisServiceDeps) {
  const pool = createRedisPool({ db: deps.db, secrets: deps.secrets });
  const access = createRedisAccess({ db: deps.db, pool });
  const connections = createRedisConnectionService({ db: deps.db, secrets: deps.secrets, pool });
  const keys = createRedisKeysService(access);
  const writes = createRedisWriteService(access);
  const cli = createRedisCliService({ db: deps.db, access });
  const info = createRedisInfoService(access);
  const memory = createRedisMemoryService(access, keys);
  const pubsub = createRedisPubsubService({ access, emitMessage: deps.emitMessage, emitEnd: deps.emitSubscriptionEnd });

  async function pickFile(input: RedisPickFileInput): Promise<RedisPickedFile> {
    const chosen = await deps.dialogs.pickFile(input.purpose);
    if (chosen === null) return { cancelled: true, path: null };
    return { cancelled: false, path: validateExistingFile(chosen).path };
  }

  return {
    listConnections: connections.list,
    createConnection: connections.create,
    updateConnection: connections.update,
    removeConnection: connections.remove,
    testConnection: connections.test,
    testDraft: connections.testDraft,
    purgeProject: connections.purgeProject,
    pickFile,
    scan: keys.scan,
    getKey: keys.getKey,
    keyMemory: keys.keyMemory,
    streamInfo: keys.streamInfo,
    writeKey: writes.writeKey,
    deleteKey: writes.deleteKey,
    countPattern: writes.countPattern,
    deletePattern: writes.deletePattern,
    execute: cli.execute,
    listCommands: cli.listCommands,
    listSavedCommands: cli.listSaved,
    saveCommand: cli.saveCommand,
    deleteSavedCommand: cli.deleteSaved,
    info: info.info,
    slowlog: info.slowlog,
    resetSlowlog: info.resetSlowlog,
    clients: info.clients,
    config: info.config,
    analyzeMemory: memory.analyze,
    subscribe: pubsub.subscribe,
    unsubscribe: pubsub.unsubscribe,
    publish: pubsub.publish,
    /** The window reloaded: nobody is listening to those subscriptions any more. */
    endSubscriptions: (): Promise<void> => pubsub.shutdown('The window was reloaded'),
    shutdown: async (): Promise<void> => {
      await pubsub.shutdown();
      await pool.closeAll();
    }
  };
}

export type RedisService = ReturnType<typeof createRedisService>;

import { ErrorReply } from '@redis/client';
import type {
  RedisCommandList,
  RedisConnectionIdInput,
  RedisExecuteInput,
  RedisExecuteResult,
  RedisSavedCommand,
  RedisSavedDeleteInput,
  RedisSavedListInput,
  RedisSavedSaveInput
} from '@shared/schemas/redis';
import { StewardServiceError } from '@shared/types/result';
import {
  deleteSavedCommand,
  findDataConnection,
  insertSavedCommand,
  listSavedCommands
} from '../db/data-connection.repo';
import type { SqlDatabase } from '../db/driver';
import { nowIso, uuidv7 } from '../db/id';
import type { RedisAccess } from './redis-access';
import { formatReply } from './redis-cli-format';
import type { RedisHandle, RedisReply } from './redis-pool';
import { asArray, asText } from './redis-reply';

/**
 * Commands the console never runs. They would end the server, change who is replicating whom, or break the
 * shared connection every other view rides on (a blocking command, a transaction, a changed database).
 */
const DENIED: Record<string, string | Record<string, string>> = {
  SHUTDOWN: 'It would stop the server.',
  DEBUG: 'It can crash or corrupt the server.',
  MODULE: 'Loading modules runs foreign code inside the server.',
  REPLICAOF: 'It changes the replication topology.',
  SLAVEOF: 'It changes the replication topology.',
  MONITOR: 'It streams every command and cannot be stopped from here.',
  SUBSCRIBE: 'Use the Pub/Sub view.',
  PSUBSCRIBE: 'Use the Pub/Sub view.',
  SSUBSCRIBE: 'Use the Pub/Sub view.',
  UNSUBSCRIBE: 'Use the Pub/Sub view.',
  PUNSUBSCRIBE: 'Use the Pub/Sub view.',
  SUNSUBSCRIBE: 'Use the Pub/Sub view.',
  SYNC: 'It turns the connection into a replication stream.',
  PSYNC: 'It turns the connection into a replication stream.',
  FAILOVER: 'It changes the replication topology.',
  SELECT: 'The console shares its connection with the other views: change the database in the connection settings.',
  AUTH: 'The connection\'s credentials are set in its settings.',
  HELLO: 'The protocol is fixed for this connection.',
  MULTI: 'Transactions cannot span the console\'s shared connection.',
  EXEC: 'Transactions cannot span the console\'s shared connection.',
  DISCARD: 'Transactions cannot span the console\'s shared connection.',
  WATCH: 'Transactions cannot span the console\'s shared connection.',
  UNWATCH: 'Transactions cannot span the console\'s shared connection.',
  RESET: 'It would reset the shared connection.',
  QUIT: 'Close the connection from the connections list.',
  BLPOP: 'A blocking command would hold the shared connection.',
  BRPOP: 'A blocking command would hold the shared connection.',
  BRPOPLPUSH: 'A blocking command would hold the shared connection.',
  BLMOVE: 'A blocking command would hold the shared connection.',
  BLMPOP: 'A blocking command would hold the shared connection.',
  BZPOPMIN: 'A blocking command would hold the shared connection.',
  BZPOPMAX: 'A blocking command would hold the shared connection.',
  BZMPOP: 'A blocking command would hold the shared connection.',
  WAIT: 'A blocking command would hold the shared connection.',
  WAITAOF: 'A blocking command would hold the shared connection.',
  CLUSTER: { FAILOVER: 'It changes the cluster topology.', RESET: 'It wipes the node\'s cluster state.', FORGET: 'It changes the cluster topology.' },
  ACL: { SETUSER: 'Managing users is outside Steward.', DELUSER: 'Managing users is outside Steward.' },
  CONFIG: { REWRITE: 'It rewrites the server\'s configuration file.' },
  SCRIPT: { DEBUG: 'It changes how scripts run on the server.' },
  CLIENT: { REPLY: 'It would silence the shared connection.', TRACKING: 'It changes how the shared connection receives data.', CACHING: 'It changes how the shared connection receives data.' }
};

/** Commands that run only after an explicit confirmation. */
const CONFIRMED: Record<string, string | Record<string, string>> = {
  FLUSHDB: 'It deletes every key of the database.',
  FLUSHALL: 'It deletes every key of every database.',
  KEYS: 'It scans the whole keyspace in one blocking step and can stall the server.',
  EVAL: 'A script can change anything.',
  EVALSHA: 'A script can change anything.',
  FCALL: 'A function can change anything.',
  FUNCTION: 'It changes the functions stored on the server.',
  CONFIG: { SET: 'It changes the server\'s configuration while it runs.' },
  CLIENT: { KILL: 'It disconnects other clients.', PAUSE: 'It stops the server from answering clients.' },
  SLOWLOG: { RESET: 'It erases the slow log.' }
};

function lookup(table: Record<string, string | Record<string, string>>, name: string, sub: string | undefined): string | null {
  const entry = table[name];
  if (entry === undefined) return null;
  if (typeof entry === 'string') return entry;
  return sub === undefined ? null : (entry[sub] ?? null);
}

export interface RedisCliDeps {
  db: SqlDatabase;
  access: RedisAccess;
}

export function createRedisCliService(deps: RedisCliDeps) {
  const { db, access } = deps;
  const { connect, guard, assertWritable, assertTypedName, audited, pool } = access;

  /** Command flags by connection, from COMMAND INFO. They do not change while a server runs. */
  const flagCache = new Map<string, Map<string, string[] | null>>();
  pool.onClose((id) => flagCache.delete(id));

  async function flagsOf(handle: RedisHandle, connectionId: string, args: string[]): Promise<string[] | null> {
    const name = (args[0] ?? '').toLowerCase();
    const sub = args[1]?.toLowerCase();
    const cache = flagCache.get(connectionId) ?? new Map<string, string[] | null>();
    flagCache.set(connectionId, cache);

    const names = sub === undefined ? [name] : [`${name}|${sub}`, name];
    for (const candidate of names) {
      if (cache.has(candidate)) {
        const known = cache.get(candidate) ?? null;
        if (known !== null) return known;
        continue;
      }
      const reply = asArray(await handle.send(['COMMAND', 'INFO', candidate]));
      const first = reply[0];
      const details = first === null || first === undefined ? [] : asArray(first);
      if (details.length < 3) {
        cache.set(candidate, null);
        continue;
      }
      const flags = asArray(details[2]).map((flag) => asText(flag).replace(/^@/, '').toLowerCase());
      cache.set(candidate, flags);
      return flags;
    }
    return null;
  }

  async function execute(input: RedisExecuteInput): Promise<RedisExecuteResult> {
    const { handle, record } = await connect(input.connectionId);
    const name = (input.args[0] ?? '').toUpperCase();
    const sub = input.args[1]?.toUpperCase();

    const denied = lookup(DENIED, name, sub);
    if (denied !== null) {
      throw new StewardServiceError(
        'REDIS_COMMAND_BLOCKED',
        `${sub !== undefined && typeof DENIED[name] === 'object' ? `${name} ${sub}` : name} is not available in the console`,
        denied
      );
    }

    const needsConfirmation = lookup(CONFIRMED, name, sub);
    if (needsConfirmation !== null) {
      if (input.confirmed !== true) {
        throw new StewardServiceError('CONFIRMATION_REQUIRED', `${name} needs confirmation`, needsConfirmation);
      }
      assertTypedName(record, input.confirmName, name === 'FLUSHALL');
    }

    return guard(async () => {
      const flags = await flagsOf(handle, record.id, input.args);
      const isWrite = flags?.includes('write') === true || needsConfirmation !== null;

      if (record.readOnly) {
        if (flags?.includes('write') === true) assertWritable(record);
        // A script is not flagged as a write, yet it can write: only the read-only variants run here.
        const scripted = ['EVAL', 'EVALSHA', 'FCALL', 'FUNCTION'].includes(name);
        if (flags?.includes('admin') === true || flags?.includes('dangerous') === true || scripted) {
          throw new StewardServiceError(
            'REDIS_COMMAND_BLOCKED',
            `${name} is not allowed on a read-only connection`,
            'Turn off read-only in the connection\'s settings to run administrative commands or scripts (EVAL_RO and FCALL_RO still work).'
          );
        }
      }

      const started = Date.now();
      const run = async (): Promise<RedisReply> => {
        try {
          return await handle.send(input.args, input.args[1]);
        } catch (error) {
          // The server's own refusal ("wrong number of arguments", "unknown command") is an answer, not a failure.
          if (error instanceof ErrorReply) return error;
          throw error;
        }
      };
      const reply = isWrite ? await audited(record, name, input.args[1] ?? '', run) : await run();
      const formatted = formatReply(reply);
      return { output: formatted.output, truncated: formatted.truncated, elapsedMs: Date.now() - started };
    });
  }

  async function listCommands(input: RedisConnectionIdInput): Promise<RedisCommandList> {
    const { handle } = await connect(input.id);
    return guard(async () => {
      let names: string[];
      try {
        names = asArray(await handle.send(['COMMAND', 'LIST'])).map(asText);
      } catch {
        names = asArray(await handle.send(['COMMAND'])).map((entry) => asText(asArray(entry)[0]));
      }
      return { names: [...new Set(names.map((name) => name.toUpperCase()))].sort() };
    });
  }

  function requireRedis(connectionId: string): void {
    const record = findDataConnection(db, connectionId);
    if (record === null || record.kind !== 'redis') {
      throw new StewardServiceError('NOT_FOUND', 'that connection no longer exists');
    }
  }

  function listSaved(input: RedisSavedListInput): RedisSavedCommand[] {
    requireRedis(input.connectionId);
    return listSavedCommands(db, input.connectionId);
  }

  function saveCommand(input: RedisSavedSaveInput): RedisSavedCommand {
    requireRedis(input.connectionId);
    const command: RedisSavedCommand = {
      id: uuidv7(),
      connectionId: input.connectionId,
      name: input.name,
      commandText: input.commandText,
      createdAt: nowIso()
    };
    insertSavedCommand(db, command);
    return command;
  }

  function deleteSaved(input: RedisSavedDeleteInput): { id: string } {
    deleteSavedCommand(db, input.id);
    return { id: input.id };
  }

  return { execute, listCommands, listSaved, saveCommand, deleteSaved };
}

export type RedisCliService = ReturnType<typeof createRedisCliService>;

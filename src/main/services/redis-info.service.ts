import type {
  RedisClientEntry,
  RedisConfigEntry,
  RedisConnectionIdInput,
  RedisInfoSnapshot,
  RedisSlowlogEntry,
  RedisSlowlogResetInput
} from '@shared/schemas/redis';
import type { RedisAccess } from './redis-access';
import { asArray, asBuffer, asNumber, asText, infoField, parseInfo, parseKeyValueList } from './redis-reply';

const SLOWLOG_COUNT = 128;
const COMMAND_PREVIEW_MAX = 300;
/** Commands whose arguments are credentials: the slow log shows that they ran, not what they carried. */
const SECRET_COMMANDS = new Set(['AUTH', 'HELLO', 'MIGRATE', 'ACL']);
const SECRET_CONFIG = /pass|auth|secret|token|key/i;

function toNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createRedisInfoService(access: RedisAccess) {
  const { connect, guard, assertWritable, audited } = access;

  async function info(input: RedisConnectionIdInput): Promise<RedisInfoSnapshot> {
    const { handle } = await connect(input.id);
    return guard(async () => {
      const sections = parseInfo(asText(await handle.send(['INFO'])));
      const get = (section: string, field: string): string | undefined => infoField(sections, section, field);

      const keyspace = Object.entries(sections['keyspace'] ?? {}).map(([db, value]) => {
        const parts = parseKeyValueList(value);
        return { db, keys: toNumber(parts['keys']), expires: toNumber(parts['expires']) };
      });

      return {
        takenAt: Date.now(),
        role: get('replication', 'role') ?? 'master',
        version: get('server', 'redis_version') ?? 'unknown',
        uptimeSeconds: toNumber(get('server', 'uptime_in_seconds')),
        opsPerSec: toNumber(get('stats', 'instantaneous_ops_per_sec')),
        usedMemory: toNumber(get('memory', 'used_memory')),
        usedMemoryRss: toNumber(get('memory', 'used_memory_rss')),
        maxMemory: toNumber(get('memory', 'maxmemory')),
        connectedClients: toNumber(get('clients', 'connected_clients')),
        blockedClients: toNumber(get('clients', 'blocked_clients')),
        keyspaceHits: toNumber(get('stats', 'keyspace_hits')),
        keyspaceMisses: toNumber(get('stats', 'keyspace_misses')),
        expiredKeys: toNumber(get('stats', 'expired_keys')),
        evictedKeys: toNumber(get('stats', 'evicted_keys')),
        connectedReplicas: toNumber(get('replication', 'connected_slaves')),
        persistence: {
          rdbLastStatus: get('persistence', 'rdb_last_bgsave_status') ?? 'unknown',
          aofEnabled: get('persistence', 'aof_enabled') === '1',
          lastSaveTime: toNumber(get('persistence', 'rdb_last_save_time'))
        },
        keyspace,
        sections: Object.fromEntries(Object.entries(sections).filter(([name]) => name !== 'default'))
      };
    });
  }

  function previewCommand(parts: string[]): string {
    const name = (parts[0] ?? '').toUpperCase();
    const text = SECRET_COMMANDS.has(name) ? `${name} ***` : parts.join(' ');
    return text.length > COMMAND_PREVIEW_MAX ? `${text.slice(0, COMMAND_PREVIEW_MAX)}…` : text;
  }

  async function slowlog(input: RedisConnectionIdInput): Promise<RedisSlowlogEntry[]> {
    const { handle } = await connect(input.id);
    return guard(async () => {
      const rows = asArray(await handle.send(['SLOWLOG', 'GET', String(SLOWLOG_COUNT)]));
      return rows.map((row) => {
        const fields = asArray(row);
        return {
          id: asNumber(fields[0]),
          at: asNumber(fields[1]) * 1000,
          durationMicros: asNumber(fields[2]),
          command: previewCommand(asArray(fields[3]).map((part) => asBuffer(part).toString('utf8'))),
          client: asText(fields[4])
        };
      });
    });
  }

  async function resetSlowlog(input: RedisSlowlogResetInput): Promise<{ reset: true }> {
    const { handle, record } = await connect(input.connectionId);
    assertWritable(record);
    return audited(record, 'SLOWLOG RESET', '', () => guard(async () => {
      await handle.send(['SLOWLOG', 'RESET']);
      return { reset: true as const };
    }));
  }

  async function clients(input: RedisConnectionIdInput): Promise<RedisClientEntry[]> {
    const { handle } = await connect(input.id);
    return guard(async () => {
      const text = asText(await handle.send(['CLIENT', 'LIST']));
      return text
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .map((line) => {
          const fields: Record<string, string> = {};
          for (const part of line.split(' ')) {
            const separator = part.indexOf('=');
            if (separator > 0) fields[part.slice(0, separator)] = part.slice(separator + 1);
          }
          return {
            id: fields['id'] ?? '',
            address: fields['addr'] ?? '',
            name: fields['name'] ?? '',
            ageSeconds: toNumber(fields['age']),
            idleSeconds: toNumber(fields['idle']),
            db: fields['db'] ?? '',
            command: fields['cmd'] ?? '',
            flags: fields['flags'] ?? ''
          };
        });
    });
  }

  async function config(input: RedisConnectionIdInput): Promise<RedisConfigEntry[]> {
    const { handle } = await connect(input.id);
    return guard(async () => {
      const flat = asArray(await handle.send(['CONFIG', 'GET', '*']));
      const entries: RedisConfigEntry[] = [];
      for (let index = 0; index + 1 < flat.length; index += 2) {
        const name = asText(flat[index]);
        const value = asText(flat[index + 1]);
        entries.push({ name, value: SECRET_CONFIG.test(name) && value !== '' ? '••••••' : value });
      }
      return entries.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  return { info, slowlog, resetSlowlog, clients, config };
}

export type RedisInfoService = ReturnType<typeof createRedisInfoService>;

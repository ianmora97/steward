import {
  REDIS_MEMORY_SAMPLE_MAX,
  type RedisMemoryAnalyzeInput,
  type RedisMemoryGroup,
  type RedisMemoryReport
} from '@shared/schemas/redis';
import type { RedisAccess } from './redis-access';
import type { RedisKeysService } from './redis-keys.service';
import { asArray, asBuffer, asNumber, asText } from './redis-reply';

const TOP_KEYS = 20;
const BATCH = 100;
const DEFAULT_SAMPLE = 1000;
const NO_PREFIX = '(no prefix)';

function add(groups: Map<string, RedisMemoryGroup>, name: string, bytes: number): void {
  const group = groups.get(name) ?? { name, keys: 0, bytes: 0 };
  group.keys += 1;
  group.bytes += bytes;
  groups.set(name, group);
}

/**
 * A sample of the keyspace, not an inventory: up to a few thousand keys found by SCAN, each measured with
 * MEMORY USAGE. The report says how many were sampled so nobody reads it as the whole database.
 */
export function createRedisMemoryService(access: RedisAccess, keys: RedisKeysService) {
  const { connect, guard } = access;

  async function analyze(input: RedisMemoryAnalyzeInput): Promise<RedisMemoryReport> {
    const { handle, record } = await connect(input.connectionId);
    const delimiter = (record.options as { keyDelimiter?: string }).keyDelimiter ?? ':';
    const wanted = Math.min(input.sample ?? DEFAULT_SAMPLE, REDIS_MEMORY_SAMPLE_MAX);
    const pattern = input.pattern === undefined || input.pattern === '' ? '*' : input.pattern;

    return guard(async () => {
      const sampled: Buffer[] = [];
      for (const node of await handle.nodes()) {
        let cursor = '0';
        do {
          const reply = asArray(await node.send(['SCAN', cursor, 'COUNT', '500', 'MATCH', pattern]));
          cursor = asText(reply[0]);
          for (const key of asArray(reply[1])) {
            if (sampled.length < wanted) sampled.push(asBuffer(key));
          }
        } while (cursor !== '0' && sampled.length < wanted);
        if (sampled.length >= wanted) break;
      }

      const byPrefix = new Map<string, RedisMemoryGroup>();
      const byType = new Map<string, RedisMemoryGroup>();
      const top: { key: string; type: string; bytes: number }[] = [];
      let totalBytes = 0;
      let measured = 0;

      for (let offset = 0; offset < sampled.length; offset += BATCH) {
        const batch = sampled.slice(offset, offset + BATCH);
        const results = await Promise.all(
          batch.map(async (key) => {
            const [usage, type] = await Promise.all([
              handle.send(['MEMORY', 'USAGE', key, 'SAMPLES', '5'], key),
              handle.send(['TYPE', key], key)
            ]);
            return { key, usage, type: asText(type) };
          })
        );
        for (const { key, usage, type } of results) {
          // A key that expired between SCAN and MEMORY USAGE answers nil: it is simply not part of the sample.
          if (usage === null) continue;
          const bytes = asNumber(usage);
          const text = key.toString('utf8');
          const cut = text.indexOf(delimiter);
          measured += 1;
          totalBytes += bytes;
          add(byPrefix, cut > 0 ? text.slice(0, cut) : NO_PREFIX, bytes);
          add(byType, type, bytes);
          top.push({ key: text, type, bytes });
        }
      }

      top.sort((a, b) => b.bytes - a.bytes);
      const bySize = (a: RedisMemoryGroup, b: RedisMemoryGroup): number => b.bytes - a.bytes;
      return {
        sampled: measured,
        dbSize: await keys.dbSizeOf(handle),
        totalBytes,
        byPrefix: [...byPrefix.values()].sort(bySize).slice(0, 30),
        byType: [...byType.values()].sort(bySize),
        top: top.slice(0, TOP_KEYS)
      };
    });
  }

  return { analyze };
}

export type RedisMemoryService = ReturnType<typeof createRedisMemoryService>;

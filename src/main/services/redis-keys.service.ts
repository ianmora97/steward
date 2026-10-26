import {
  REDIS_PAGE_COUNT_DEFAULT,
  REDIS_SCAN_COUNT_DEFAULT,
  REDIS_STRING_MAX_BYTES,
  type RedisKeyEntry,
  type RedisKeyGetInput,
  type RedisKeyGetResult,
  type RedisKeyInput,
  type RedisKeyMemory,
  type RedisKeyMeta,
  type RedisScanInput,
  type RedisScanResult,
  type RedisStreamEntry,
  type RedisStreamInfo,
  type RedisValuePage
} from '@shared/schemas/redis';
import { StewardServiceError } from '@shared/types/result';
import type { RedisAccess } from './redis-access';
import type { RedisHandle, RedisReply } from './redis-pool';
import { asArray, asBuffer, asNumber, asText } from './redis-reply';

/** One SCAN call returns whatever it likes; a page keeps asking until it has this many keys or runs out of budget. */
const PAGE_TARGET = 100;
const PAGE_MAX_ROUNDS = 40;
const PAGE_BUDGET_MS = 3000;

function b64(reply: RedisReply | undefined): string {
  return asBuffer(reply).toString('base64');
}

function parseCursor(cursor: string): { node: number; cursor: string } {
  const separator = cursor.indexOf(':');
  if (separator < 0) return { node: 0, cursor: /^\d+$/.test(cursor) ? cursor : '0' };
  const node = Number(cursor.slice(0, separator));
  const rest = cursor.slice(separator + 1);
  return { node: Number.isInteger(node) && node >= 0 ? node : 0, cursor: /^\d+$/.test(rest) ? rest : '0' };
}

/** Flat `[name, value, name, value]` replies as a lookup. */
export function pairs(reply: RedisReply | undefined): Map<string, RedisReply> {
  const list = asArray(reply);
  const map = new Map<string, RedisReply>();
  for (let index = 0; index + 1 < list.length; index += 2) map.set(asText(list[index]), list[index + 1] as RedisReply);
  return map;
}

export function createRedisKeysService(access: RedisAccess) {
  const { connect, guard } = access;

  async function dbSizeOf(handle: RedisHandle): Promise<number> {
    let total = 0;
    for (const node of await handle.nodes()) total += asNumber(await node.send(['DBSIZE']));
    return total;
  }

  async function scan(input: RedisScanInput): Promise<RedisScanResult> {
    const { handle } = await connect(input.connectionId);
    return guard(async () => {
      const nodes = await handle.nodes();
      const count = input.count ?? REDIS_SCAN_COUNT_DEFAULT;
      const pattern = input.pattern === undefined || input.pattern === '' ? '*' : input.pattern;
      let { node, cursor } = parseCursor(input.cursor);
      const found: Buffer[] = [];
      const started = Date.now();

      for (let round = 0; round < PAGE_MAX_ROUNDS; round += 1) {
        const current = nodes[node];
        if (current === undefined) {
          cursor = '0';
          node = nodes.length;
          break;
        }
        const args: (string | Buffer)[] = ['SCAN', cursor, 'COUNT', String(count)];
        if (pattern !== '*') args.push('MATCH', pattern);
        if (input.type !== undefined) args.push('TYPE', input.type);
        const reply = asArray(await current.send(args));
        cursor = asText(reply[0]);
        for (const key of asArray(reply[1])) found.push(asBuffer(key));

        if (cursor === '0') {
          node += 1;
          if (node >= nodes.length) break;
        }
        // The loop is the only place a scan can be abandoned, so it is also where the budget is checked.
        if (found.length >= PAGE_TARGET || Date.now() - started > PAGE_BUDGET_MS) break;
      }

      const finished = node >= nodes.length;
      const next = finished ? '0' : nodes.length > 1 ? `${node}:${cursor}` : cursor;

      const entries = await Promise.all(
        found.map(async (key): Promise<RedisKeyEntry> => {
          const [type, ttl] = await Promise.all([handle.send(['TYPE', key], key), handle.send(['PTTL', key], key)]);
          const ttlMs = asNumber(ttl);
          return { key: key.toString('utf8'), type: asText(type), ttlMs: ttlMs >= 0 ? ttlMs : null };
        })
      );
      return { keys: entries.filter((entry) => entry.type !== 'none'), cursor: next, dbSize: await dbSizeOf(handle) };
    });
  }

  async function metaOf(handle: RedisHandle, key: string): Promise<RedisKeyMeta> {
    const [type, ttl] = await Promise.all([handle.send(['TYPE', key], key), handle.send(['PTTL', key], key)]);
    const typeName = asText(type);
    if (typeName === 'none') throw new StewardServiceError('NOT_FOUND', 'That key no longer exists', 'It may have expired or been deleted.');
    // OBJECT may be forbidden to this user; the encoding is a nicety, not a reason to fail.
    const encoding = await handle.send(['OBJECT', 'ENCODING', key], key).then(
      (reply) => asText(reply) || null,
      () => null
    );
    const ttlMs = asNumber(ttl);
    return { key, type: typeName, ttlMs: ttlMs >= 0 ? ttlMs : null, encoding };
  }

  async function pageOf(handle: RedisHandle, meta: RedisKeyMeta, input: RedisKeyGetInput): Promise<RedisValuePage> {
    const { key } = meta;
    const count = input.count ?? REDIS_PAGE_COUNT_DEFAULT;
    const offset = Math.max(0, Number.parseInt(input.cursor ?? '0', 10) || 0);

    switch (meta.type) {
      case 'string': {
        const length = asNumber(await handle.send(['STRLEN', key], key));
        const truncated = length > REDIS_STRING_MAX_BYTES;
        const reply = truncated
          ? await handle.send(['GETRANGE', key, '0', String(REDIS_STRING_MAX_BYTES - 1)], key)
          : await handle.send(['GET', key], key);
        return { type: 'string', length, value: b64(reply), truncated };
      }
      case 'hash': {
        const total = asNumber(await handle.send(['HLEN', key], key));
        const reply = asArray(await handle.send(['HSCAN', key, input.cursor ?? '0', 'COUNT', String(count)], key));
        const flat = asArray(reply[1]);
        const entries: { field: string; value: string }[] = [];
        for (let index = 0; index + 1 < flat.length; index += 2) entries.push({ field: b64(flat[index]), value: b64(flat[index + 1]) });
        const cursor = asText(reply[0]);
        return { type: 'hash', total, entries, next: cursor === '0' ? null : cursor };
      }
      case 'set': {
        const total = asNumber(await handle.send(['SCARD', key], key));
        const reply = asArray(await handle.send(['SSCAN', key, input.cursor ?? '0', 'COUNT', String(count)], key));
        const cursor = asText(reply[0]);
        return { type: 'set', total, members: asArray(reply[1]).map(b64), next: cursor === '0' ? null : cursor };
      }
      case 'zset': {
        const total = asNumber(await handle.send(['ZCARD', key], key));
        const flat = asArray(await handle.send(['ZRANGE', key, String(offset), String(offset + count - 1), 'WITHSCORES'], key));
        const members: { member: string; score: number }[] = [];
        for (let index = 0; index + 1 < flat.length; index += 2) {
          members.push({ member: b64(flat[index]), score: Number(asText(flat[index + 1])) });
        }
        const reached = offset + members.length;
        return { type: 'zset', total, offset, members, next: reached < total ? String(reached) : null };
      }
      case 'list': {
        const total = asNumber(await handle.send(['LLEN', key], key));
        const items = asArray(await handle.send(['LRANGE', key, String(offset), String(offset + count - 1)], key)).map(b64);
        const reached = offset + items.length;
        return { type: 'list', total, offset, items, next: reached < total ? String(reached) : null };
      }
      case 'stream': {
        const total = asNumber(await handle.send(['XLEN', key], key));
        const start = input.cursor === undefined ? '+' : `(${input.cursor}`;
        const rows = asArray(await handle.send(['XREVRANGE', key, start, '-', 'COUNT', String(count)], key));
        const entries: RedisStreamEntry[] = rows.map((row) => {
          const [id, fields] = asArray(row);
          return { id: asText(id), fields: asArray(fields).map(b64) };
        });
        const last = entries[entries.length - 1];
        return { type: 'stream', total, entries, next: entries.length >= count && last !== undefined ? last.id : null };
      }
      case 'ReJSON-RL': {
        const text = asBuffer(await handle.send(['JSON.GET', key], key));
        const truncated = text.length > REDIS_STRING_MAX_BYTES;
        return { type: 'json', value: (truncated ? text.subarray(0, REDIS_STRING_MAX_BYTES) : text).toString('utf8'), truncated };
      }
      default:
        return { type: 'unsupported', name: meta.type };
    }
  }

  async function getKey(input: RedisKeyGetInput): Promise<RedisKeyGetResult> {
    const { handle } = await connect(input.connectionId);
    return guard(async () => {
      const meta = await metaOf(handle, input.key);
      return { meta, page: await pageOf(handle, meta, input) };
    });
  }

  async function keyMemory(input: RedisKeyInput): Promise<RedisKeyMemory> {
    const { handle } = await connect(input.connectionId);
    return guard(async () => {
      const reply = await handle.send(['MEMORY', 'USAGE', input.key], input.key);
      return { bytes: reply === null ? null : asNumber(reply) };
    });
  }

  async function streamInfo(input: RedisKeyInput): Promise<RedisStreamInfo> {
    const { handle } = await connect(input.connectionId);
    return guard(async () => {
      const info = pairs(await handle.send(['XINFO', 'STREAM', input.key], input.key));
      const groups: RedisStreamInfo['groups'] = [];
      for (const raw of asArray(await handle.send(['XINFO', 'GROUPS', input.key], input.key))) {
        const group = pairs(raw);
        const name = asText(group.get('name'));
        const members = asArray(await handle.send(['XINFO', 'CONSUMERS', input.key, name], input.key)).map((consumer) => {
          const fields = pairs(consumer);
          return {
            name: asText(fields.get('name')),
            pending: asNumber(fields.get('pending')),
            idleMs: asNumber(fields.get('idle'))
          };
        });
        groups.push({
          name,
          consumers: asNumber(group.get('consumers')),
          pending: asNumber(group.get('pending')),
          lastDeliveredId: asText(group.get('last-delivered-id')),
          members
        });
      }
      return {
        length: asNumber(info.get('length')),
        lastGeneratedId: asText(info.get('last-generated-id')),
        groups
      };
    });
  }

  return { scan, getKey, keyMemory, streamInfo, dbSizeOf };
}

export type RedisKeysService = ReturnType<typeof createRedisKeysService>;

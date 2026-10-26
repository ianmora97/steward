import {
  REDIS_COUNT_PATTERN_MAX,
  REDIS_DELETE_BATCH,
  type RedisCountResult,
  type RedisDeleteResult,
  type RedisKeyDeleteInput,
  type RedisKeyWriteInput,
  type RedisPatternDeleteInput,
  type RedisPatternInput,
  type RedisWriteOp,
  type RedisWriteResult
} from '@shared/schemas/redis';
import { StewardServiceError } from '@shared/types/result';
import type { RedisAccess } from './redis-access';
import type { RedisArg, RedisHandle } from './redis-pool';
import { asArray, asBuffer, asNumber, asText } from './redis-reply';

const COMMAND_OF: Record<RedisWriteOp['kind'], string> = {
  'string.set': 'SET',
  'hash.set': 'HSET',
  'hash.del': 'HDEL',
  'list.push': 'PUSH',
  'list.set': 'LSET',
  'list.remove': 'LREM',
  'set.add': 'SADD',
  'set.remove': 'SREM',
  'zset.add': 'ZADD',
  'zset.remove': 'ZREM',
  'stream.add': 'XADD',
  'stream.del': 'XDEL',
  'json.set': 'JSON.SET',
  rename: 'RENAME',
  'ttl.set': 'EXPIRE',
  'ttl.persist': 'PERSIST'
};

function bytes(encoded: string): Buffer {
  return Buffer.from(encoded, 'base64');
}

export function createRedisWriteService(access: RedisAccess) {
  const { connect, guard, assertWritable, assertTypedName, audited } = access;

  async function applyOp(handle: RedisHandle, key: string, op: RedisWriteOp): Promise<RedisWriteResult> {
    const send = (args: RedisArg[]): ReturnType<RedisHandle['send']> => handle.send(args, key);
    switch (op.kind) {
      case 'string.set':
        await send(op.keepTtl === true ? ['SET', key, bytes(op.value), 'KEEPTTL'] : ['SET', key, bytes(op.value)]);
        break;
      case 'hash.set':
        await send(['HSET', key, bytes(op.field), bytes(op.value)]);
        break;
      case 'hash.del':
        await send(['HDEL', key, bytes(op.field)]);
        break;
      case 'list.push':
        await send([op.side === 'left' ? 'LPUSH' : 'RPUSH', key, bytes(op.value)]);
        break;
      case 'list.set':
        await send(['LSET', key, String(op.index), bytes(op.value)]);
        break;
      case 'list.remove':
        await send(['LREM', key, String(op.count), bytes(op.value)]);
        break;
      case 'set.add':
        await send(['SADD', key, bytes(op.member)]);
        break;
      case 'set.remove':
        await send(['SREM', key, bytes(op.member)]);
        break;
      case 'zset.add':
        await send(['ZADD', key, String(op.score), bytes(op.member)]);
        break;
      case 'zset.remove':
        await send(['ZREM', key, bytes(op.member)]);
        break;
      case 'stream.add':
        await send(['XADD', key, op.id ?? '*', ...op.fields.map(bytes)]);
        break;
      case 'stream.del':
        await send(['XDEL', key, op.id]);
        break;
      case 'json.set': {
        try {
          JSON.parse(op.value);
        } catch {
          throw new StewardServiceError('VALIDATION_FAILED', 'That is not valid JSON');
        }
        await send(['JSON.SET', key, '$', op.value]);
        break;
      }
      case 'rename': {
        if (op.overwrite === true) {
          await send(['RENAME', key, op.newKey]);
        } else if (asNumber(await send(['RENAMENX', key, op.newKey])) === 0) {
          throw new StewardServiceError('CONFLICT', 'A key with that name already exists', 'Choose another name, or rename over it.');
        }
        return { key: op.newKey };
      }
      case 'ttl.set':
        if (asNumber(await send(['EXPIRE', key, String(op.seconds)])) === 0) {
          throw new StewardServiceError('NOT_FOUND', 'That key no longer exists');
        }
        break;
      case 'ttl.persist':
        await send(['PERSIST', key]);
        break;
    }
    return { key };
  }

  async function writeKey(input: RedisKeyWriteInput): Promise<RedisWriteResult> {
    const { handle, record } = await connect(input.connectionId);
    assertWritable(record);
    return audited(record, COMMAND_OF[input.op.kind], input.key, () => guard(() => applyOp(handle, input.key, input.op)));
  }

  async function deleteKey(input: RedisKeyDeleteInput): Promise<RedisDeleteResult> {
    const { handle, record } = await connect(input.connectionId);
    assertWritable(record);
    return audited(record, 'UNLINK', input.key, () =>
      guard(async () => ({ deleted: asNumber(await handle.send(['UNLINK', input.key], input.key)) }))
    );
  }

  /** Calls `visit` with each batch of keys matching the pattern, over every master. `visit` may stop the walk. */
  async function walkPattern(
    handle: RedisHandle,
    pattern: string,
    batch: number,
    visit: (keys: Buffer[]) => Promise<boolean>
  ): Promise<void> {
    for (const node of await handle.nodes()) {
      let cursor = '0';
      do {
        const reply = asArray(await node.send(['SCAN', cursor, 'COUNT', String(batch), 'MATCH', pattern]));
        cursor = asText(reply[0]);
        const keys = asArray(reply[1]).map(asBuffer);
        if (keys.length > 0 && !(await visit(keys))) return;
      } while (cursor !== '0');
    }
  }

  async function countMatching(handle: RedisHandle, pattern: string): Promise<RedisCountResult> {
    let count = 0;
    let atLeast = false;
    await walkPattern(handle, pattern, 1000, (keys) => {
      count += keys.length;
      if (count >= REDIS_COUNT_PATTERN_MAX) {
        atLeast = true;
        return Promise.resolve(false);
      }
      return Promise.resolve(true);
    });
    return { count, atLeast };
  }

  async function countPattern(input: RedisPatternInput): Promise<RedisCountResult> {
    const { handle } = await connect(input.connectionId);
    return guard(() => countMatching(handle, input.pattern));
  }

  async function deletePattern(input: RedisPatternDeleteInput): Promise<RedisDeleteResult> {
    const { handle, record } = await connect(input.connectionId);
    assertWritable(record);
    assertTypedName(record, input.confirmName, input.pattern === '*');

    return audited(record, 'UNLINK', input.pattern, () =>
      guard(async () => {
        const current = await countMatching(handle, input.pattern);
        if (current.count !== input.expectedCount) {
          throw new StewardServiceError(
            'REDIS_COUNT_MISMATCH',
            `The number of matching keys changed from ${input.expectedCount} to ${current.count}${current.atLeast ? ' or more' : ''}`,
            'Nothing was deleted. Look at the keys again and confirm the new count.'
          );
        }
        let deleted = 0;
        await walkPattern(handle, input.pattern, REDIS_DELETE_BATCH, async (keys) => {
          if (handle.mode === 'cluster') {
            // A multi-key command across slots is refused by a cluster, so each key goes on its own.
            const results = await Promise.all(keys.map((key) => handle.send(['UNLINK', key], key)));
            deleted += results.reduce<number>((sum, reply) => sum + asNumber(reply), 0);
          } else {
            deleted += asNumber(await handle.send(['UNLINK', ...keys]));
          }
          return true;
        });
        return { deleted };
      })
    );
  }

  return { writeKey, deleteKey, countPattern, deletePattern };
}

export type RedisWriteService = ReturnType<typeof createRedisWriteService>;

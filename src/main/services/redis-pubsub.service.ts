import type { RedisClientType } from '@redis/client';
import {
  REDIS_PUBSUB_MAX_SUBSCRIPTIONS,
  type RedisMessageEvent,
  type RedisPubsubPublishInput,
  type RedisPubsubSubscribeInput,
  type RedisPubsubUnsubscribeInput,
  type RedisSubscription,
  type RedisSubscriptionEndEvent
} from '@shared/schemas/redis';
import { StewardServiceError } from '@shared/types/result';
import { uuidv7 } from '../db/id';
import type { RedisAccess } from './redis-access';
import { asNumber } from './redis-reply';

/** More than this many messages in a second from one subscription are dropped: the view keeps the latest 1000 anyway. */
const MAX_MESSAGES_PER_SECOND = 500;

interface Subscription {
  id: string;
  connectionId: string;
  subscriber: RedisClientType;
}

export interface RedisPubsubDeps {
  access: RedisAccess;
  emitMessage: (event: RedisMessageEvent) => void;
  emitEnd: (event: RedisSubscriptionEndEvent) => void;
}

type BufferListener = (message: Buffer, channel: Buffer) => void;

export function createRedisPubsubService(deps: RedisPubsubDeps) {
  const { access, emitMessage, emitEnd } = deps;
  const { connect, guard, assertWritable, audited, pool } = access;
  const live = new Map<string, Subscription>();

  async function end(id: string, reason: string): Promise<void> {
    const subscription = live.get(id);
    if (subscription === undefined) return;
    live.delete(id);
    subscription.subscriber.destroy();
    emitEnd({ subscriptionId: id, reason });
  }

  // A connection that goes away (edited, deleted, idle) takes its subscriptions with it.
  pool.onClose((connectionId) => {
    for (const subscription of [...live.values()]) {
      if (subscription.connectionId === connectionId) void end(subscription.id, 'The connection was closed');
    }
  });

  async function subscribe(input: RedisPubsubSubscribeInput): Promise<RedisSubscription> {
    if (live.size >= REDIS_PUBSUB_MAX_SUBSCRIPTIONS) {
      throw new StewardServiceError(
        'REDIS_TOO_MANY_CONNECTIONS',
        `Only ${REDIS_PUBSUB_MAX_SUBSCRIPTIONS} subscriptions can be open at once`,
        'Close one before starting another.'
      );
    }
    const { handle } = await connect(input.connectionId);
    return guard(async () => {
      const subscriber = await handle.createSubscriber();
      const id = uuidv7();
      subscriber.on('end', () => void end(id, 'The connection to the server ended'));
      live.set(id, { id, connectionId: input.connectionId, subscriber });

      let windowStart = Date.now();
      let inWindow = 0;
      const deliver = (pattern: string | null, message: Buffer, channel: Buffer): void => {
        const now = Date.now();
        if (now - windowStart >= 1000) {
          windowStart = now;
          inWindow = 0;
        }
        inWindow += 1;
        if (inWindow > MAX_MESSAGES_PER_SECOND) return;
        emitMessage({
          subscriptionId: id,
          channel: channel.toString('utf8'),
          pattern,
          message: message.toString('base64'),
          at: now
        });
      };

      try {
        const raw = subscriber as unknown as {
          subscribe: (channel: string, listener: BufferListener, buffers: true) => Promise<void>;
          pSubscribe: (pattern: string, listener: BufferListener, buffers: true) => Promise<void>;
        };
        for (const channel of input.channels) await raw.subscribe(channel, (message, name) => deliver(null, message, name), true);
        for (const pattern of input.patterns) await raw.pSubscribe(pattern, (message, name) => deliver(pattern, message, name), true);
      } catch (error) {
        live.delete(id);
        subscriber.destroy();
        throw error;
      }
      return { subscriptionId: id };
    });
  }

  function unsubscribe(input: RedisPubsubUnsubscribeInput): Promise<{ subscriptionId: string }> {
    return end(input.subscriptionId, 'Unsubscribed').then(() => ({ subscriptionId: input.subscriptionId }));
  }

  async function publish(input: RedisPubsubPublishInput): Promise<{ receivers: number }> {
    const { handle, record } = await connect(input.connectionId);
    assertWritable(record);
    return audited(record, 'PUBLISH', input.channel, () =>
      guard(async () => ({ receivers: asNumber(await handle.send(['PUBLISH', input.channel, input.message])) }))
    );
  }

  /** Ends every subscription: the window reloaded or the app is quitting. */
  async function shutdown(reason = 'The application closed'): Promise<void> {
    await Promise.all([...live.keys()].map((id) => end(id, reason)));
  }

  return { subscribe, unsubscribe, publish, shutdown };
}

export type RedisPubsubService = ReturnType<typeof createRedisPubsubService>;

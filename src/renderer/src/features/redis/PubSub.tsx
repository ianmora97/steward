import { useEffect, useRef, useState } from 'react';
import { REDIS_PUBSUB_MAX_SUBSCRIPTIONS, type RedisConnection } from '@shared/schemas/redis';
import { previewValue } from '@shared/redis/value-format';
import type { StewardError } from '@shared/types/result';
import { Icon } from '../../components/Icon';
import { Pill } from '../../components/Pill';
import { useRedisStore, type RedisSubscriptionView } from '../../stores/redis.store';
import { ValueView } from './ValueView';

function words(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((word) => word.trim())
    .filter((word) => word !== '');
}

export function PubSub({
  connection,
  writable,
  onError
}: {
  connection: RedisConnection;
  writable: boolean;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const all = useRedisStore((state) => state.subscriptions);
  const addSubscription = useRedisStore((state) => state.addSubscription);
  const removeSubscription = useRedisStore((state) => state.removeSubscription);
  const markSeen = useRedisStore((state) => state.markSeen);
  const clearMessages = useRedisStore((state) => state.clearMessages);
  const [channels, setChannels] = useState('');
  const [patterns, setPatterns] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [publishChannel, setPublishChannel] = useState('');
  const [publishMessage, setPublishMessage] = useState('');
  const [receivers, setReceivers] = useState<number | null>(null);
  const log = useRef<HTMLDivElement>(null);

  const mine = Object.values(all).filter((subscription) => subscription.connectionId === connection.id);
  const open = Object.keys(all).length;
  const selected = mine.find((subscription) => subscription.subscriptionId === selectedId) ?? mine[0] ?? null;
  const messages = selected?.messages ?? [];

  useEffect(() => {
    if (selected !== null) markSeen(selected.subscriptionId);
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [selected, selected?.messages.length, markSeen]);

  async function start(): Promise<void> {
    const channelList = words(channels);
    const patternList = words(patterns);
    if (channelList.length + patternList.length === 0) return;
    setBusy(true);
    const result = await window.steward.redis.subscribe({ connectionId: connection.id, channels: channelList, patterns: patternList });
    setBusy(false);
    if (!result.success) {
      onError(result.error);
      return;
    }
    addSubscription({
      subscriptionId: result.data.subscriptionId,
      connectionId: connection.id,
      label: [...channelList, ...patternList].join(', ')
    });
    setSelectedId(result.data.subscriptionId);
    setChannels('');
    setPatterns('');
  }

  async function stop(subscription: RedisSubscriptionView): Promise<void> {
    if (subscription.endedReason === null) {
      const result = await window.steward.redis.unsubscribe({ subscriptionId: subscription.subscriptionId });
      if (!result.success) onError(result.error);
    }
    removeSubscription(subscription.subscriptionId);
  }

  async function publish(): Promise<void> {
    if (publishChannel.trim() === '') return;
    const result = await window.steward.redis.publish({ connectionId: connection.id, channel: publishChannel.trim(), message: publishMessage });
    if (result.success) setReceivers(result.data.receivers);
    else onError(result.error);
  }

  return (
    <div className="rdpubsub">
      <form
        className="rdpubsub__form"
        onSubmit={(event) => {
          event.preventDefault();
          void start();
        }}
      >
        <label className="field">
          <span className="field__label">Channels</span>
          <input className="field__input dpmono" value={channels} onChange={(event) => setChannels(event.target.value)} placeholder="orders alerts" spellCheck={false} />
        </label>
        <label className="field">
          <span className="field__label">Patterns</span>
          <input className="field__input dpmono" value={patterns} onChange={(event) => setPatterns(event.target.value)} placeholder="chat:*" spellCheck={false} />
        </label>
        <button type="submit" className="button button--primary" disabled={busy || words(channels).length + words(patterns).length === 0 || open >= REDIS_PUBSUB_MAX_SUBSCRIPTIONS}>
          {busy ? 'Subscribing…' : 'Subscribe'}
        </button>
        <span className="card__hint">
          Up to {REDIS_PUBSUB_MAX_SUBSCRIPTIONS} subscriptions; each keeps the last 1000 messages and ends when you leave this tab.
        </span>
      </form>

      {mine.length === 0 ? (
        <p className="card__hint">Subscribe to a channel or a pattern to see messages as they are published.</p>
      ) : (
        <>
          <div className="rdpubsub__chips">
            {mine.map((subscription) => (
              <span key={subscription.subscriptionId} className={`rdchip${selected?.subscriptionId === subscription.subscriptionId ? ' rdchip--active' : ''}`}>
                <button type="button" className="rdchip__label dpmono" onClick={() => setSelectedId(subscription.subscriptionId)}>
                  {subscription.label}
                  {subscription.unseen > 0 && selected?.subscriptionId !== subscription.subscriptionId && <span className="rdchip__badge">{subscription.unseen}</span>}
                </button>
                {subscription.endedReason !== null && <Pill tone="neutral">Ended</Pill>}
                <button type="button" className="iconbutton" aria-label={`Stop ${subscription.label}`} title="Stop" onClick={() => void stop(subscription)}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>

          {selected !== null && (
            <div className="rdpubsub__log" ref={log}>
              {selected.endedReason !== null && <p className="card__hint">This subscription ended: {selected.endedReason}.</p>}
              {messages.length === 0 && selected.endedReason === null && <p className="card__hint">Waiting for messages…</p>}
              {messages.map((message, index) => (
                <div key={`${message.at}:${index}`} className="rdmsg">
                  <button type="button" className="rdmsg__row" onClick={() => setExpanded(expanded === index ? null : index)}>
                    <span className="card__hint dpmono">{new Date(message.at).toLocaleTimeString()}</span>
                    <span className="rdmsg__channel dpmono">{message.channel}</span>
                    {message.pattern !== null && <span className="card__hint dpmono">via {message.pattern}</span>}
                    <span className="rdmsg__text dpmono">{previewValue(message.message, 160)}</span>
                  </button>
                  {expanded === index && <ValueView encoded={message.message} />}
                </div>
              ))}
            </div>
          )}
          {selected !== null && (
            <div className="rdsection__bar">
              <span className="card__hint">{messages.length} message{messages.length === 1 ? '' : 's'} kept</span>
              <span className="dpitem__spacer" />
              <button type="button" className="button button--small" onClick={() => clearMessages(selected.subscriptionId)}>
                Clear
              </button>
            </div>
          )}
        </>
      )}

      <form
        className="rdpubsub__publish"
        onSubmit={(event) => {
          event.preventDefault();
          void publish();
        }}
      >
        <h4 className="rdwork__side-title">Publish</h4>
        <div className="dprow">
          <label className="field">
            <span className="field__label">Channel</span>
            <input className="field__input dpmono" value={publishChannel} onChange={(event) => setPublishChannel(event.target.value)} disabled={!writable} spellCheck={false} />
          </label>
          <label className="field">
            <span className="field__label">Message</span>
            <input className="field__input dpmono" value={publishMessage} onChange={(event) => setPublishMessage(event.target.value)} disabled={!writable} spellCheck={false} />
          </label>
          <button type="submit" className="button" disabled={!writable || publishChannel.trim() === ''} title={writable ? undefined : 'Read-only connection'}>
            Publish
          </button>
        </div>
        {receivers !== null && <p className="card__hint">Delivered to {receivers} subscriber{receivers === 1 ? '' : 's'}.</p>}
      </form>
    </div>
  );
}

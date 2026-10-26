import { useCallback, useEffect, useState } from 'react';
import type { RedisConnection, RedisTestResult } from '@shared/schemas/redis';
import type { StewardError } from '@shared/types/result';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Icon } from '../../components/Icon';
import { Pill } from '../../components/Pill';
import { listenToRedisEvents, useRedisStore } from '../../stores/redis.store';
import { useAppStore } from '../../stores/app.store';
import '../mongodb/mongo.css';
import { ConnectionDialog } from './ConnectionDialog';
import { Insights } from './Insights';
import { KeyBrowser } from './KeyBrowser';
import { KeyDetail } from './KeyDetail';
import { NewKeyDialog } from './NewKeyDialog';
import { PatternDeleteDialog } from './PatternDeleteDialog';
import { PubSub } from './PubSub';
import { formatBytes, formatCount } from './redis-meta';
import { Workbench } from './Workbench';
import './redis.css';

type View = 'browser' | 'workbench' | 'pubsub' | 'insights';

const VIEW_LABEL: Record<View, string> = {
  browser: 'Browser',
  workbench: 'Workbench',
  pubsub: 'Pub/Sub',
  insights: 'Insights'
};

const MODE_LABEL = { standalone: 'Standalone', sentinel: 'Sentinel', cluster: 'Cluster' } as const;

type Dialog =
  | { kind: 'new' }
  | { kind: 'edit'; connection: RedisConnection }
  | { kind: 'newKey' }
  | { kind: 'deletePattern'; pattern: string }
  | null;

export function RedisPanel(): React.JSX.Element {
  const projectId = useAppStore((state) => state.selectedProjectId);
  const [connections, setConnections] = useState<RedisConnection[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>('browser');
  // Tagged with its connection, so a switch never shows the previous server's role or version.
  const [statusState, setStatusState] = useState<{ connectionId: string; data: RedisTestResult } | null>(null);
  const [statusKey, setStatusKey] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [removing, setRemoving] = useState<RedisConnection | null>(null);
  const [error, setError] = useState<StewardError | null>(null);

  useEffect(() => {
    listenToRedisEvents();
    // Leaving the tab ends its subscriptions: nothing may keep listening without a page to show it.
    return () => {
      const { subscriptions, removeSubscription } = useRedisStore.getState();
      for (const subscription of Object.values(subscriptions)) {
        if (subscription.endedReason === null) void window.steward.redis.unsubscribe({ subscriptionId: subscription.subscriptionId });
        removeSubscription(subscription.subscriptionId);
      }
    };
  }, []);

  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    void window.steward.redis.list({ projectId }).then((result) => {
      if (cancelled) return;
      if (result.success) setConnections(result.data);
      else {
        setConnections([]);
        setError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const connection = connections?.find((candidate) => candidate.id === selectedId) ?? connections?.[0] ?? null;
  const connectionId = connection?.id ?? null;
  const status = statusState !== null && statusState.connectionId === connectionId ? statusState.data : null;

  useEffect(() => {
    if (connectionId === null) return;
    let cancelled = false;
    void window.steward.redis.test({ id: connectionId }).then((result) => {
      if (cancelled) return;
      if (result.success) setStatusState({ connectionId, data: result.data });
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [connectionId, statusKey]);

  const onGone = useCallback(() => setSelectedKey(null), []);
  const onChanged = useCallback(() => setListVersion((value) => value + 1), []);

  if (projectId === null) return <div className="panel" />;

  // A replica refuses writes whatever the connection says; showing the buttons would only lead to errors.
  const replica = status !== null && status.role !== 'master' && status.mode !== 'cluster';
  const writable = connection !== null && !connection.readOnly && !replica;

  function upsert(saved: RedisConnection): void {
    setConnections((current) => {
      const list = current ?? [];
      const exists = list.some((candidate) => candidate.id === saved.id);
      const next = exists ? list.map((candidate) => (candidate.id === saved.id ? saved : candidate)) : [...list, saved];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
    setSelectedId(saved.id);
    setSelectedKey(null);
    setStatusKey((value) => value + 1);
    setDialog(null);
  }

  async function remove(target: RedisConnection): Promise<void> {
    setRemoving(null);
    const result = await window.steward.redis.remove({ id: target.id });
    if (!result.success) {
      setError(result.error);
      return;
    }
    setConnections((current) => (current ?? []).filter((candidate) => candidate.id !== target.id));
    if (selectedId === target.id) {
      setSelectedId(null);
      setSelectedKey(null);
    }
  }

  return (
    <div className="panel dppage mgpage rdpage">
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <header className="mghead">
        <h2 className="mghead__title">
          <Icon name="database" size={22} />
          Redis
        </h2>
        <div className="mghead__actions">
          {connections !== null && connections.length > 0 && connection !== null && (
            <select
              className="field__input mghead__select"
              value={connection.id}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setSelectedKey(null);
              }}
              aria-label="Redis connection"
            >
              {connections.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                  {candidate.environmentName === null ? '' : ` · ${candidate.environmentName}`}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="button button--primary" onClick={() => setDialog({ kind: 'new' })}>
            <Icon name="plus" size={14} /> New connection
          </button>
        </div>
      </header>

      {connections === null && <p className="card__hint">Loading connections…</p>}

      {connections !== null && connection === null && (
        <EmptyState title="No Redis connections yet" description="Add a standalone server, a Sentinel setup or a cluster, with a password, ACL user or TLS if it needs them.">
          <button type="button" className="button button--primary" onClick={() => setDialog({ kind: 'new' })}>
            New connection
          </button>
        </EmptyState>
      )}

      {connection !== null && (
        <>
          <div className="rdconn">
            <span
              className={`rdconn__dot${status !== null ? ' rdconn__dot--up' : ''}`}
              role="img"
              aria-label={status !== null ? 'Connected' : 'Connecting'}
              title={status !== null ? 'Connected' : 'Connecting…'}
            />
            <span className="rdconn__host dpmono" title={connection.hostDisplay}>
              {connection.hostDisplay}
            </span>
            {/* The one line that matters at a glance; the rest sits in its tooltip. */}
            <span
              className="rdconn__meta"
              title={
                status === null
                  ? undefined
                  : `Role ${status.role} · ${status.latencyMs} ms round trip · ${formatCount(status.dbSize)} keys · ${formatBytes(status.usedMemory)} used`
              }
            >
              {status === null
                ? 'Connecting…'
                : `Redis ${status.serverVersion} · ${MODE_LABEL[status.mode]}${status.mode === 'cluster' ? '' : ` · db${connection.options.database ?? 0}`}`}
            </span>
            {replica && (
              <Pill tone="warning" icon="alert" title="A replica refuses writes">
                Replica
              </Pill>
            )}
            {connection.environmentName !== null && (
              <Pill
                tone={connection.protectedEnvironment ? 'warning' : 'neutral'}
                icon={connection.protectedEnvironment ? 'shield' : 'tag'}
                title={connection.protectedEnvironment ? 'Protected environment' : undefined}
              >
                {connection.environmentName}
              </Pill>
            )}
            {!writable ? (
              <Pill tone="success" icon="lock" title={replica && !connection.readOnly ? 'This server is a replica' : 'Steward refuses every write on this connection'}>
                Read-only
              </Pill>
            ) : (
              <Pill tone="warning" icon="edit" title="This connection can change data">
                Can write
              </Pill>
            )}
            {connection.options.tls === true && (
              <Pill tone={connection.options.tlsAllowInvalidCertificates === true ? 'failure' : 'info'} icon={connection.options.tlsAllowInvalidCertificates === true ? 'alert' : 'lock'} title={connection.options.tlsAllowInvalidCertificates === true ? "The server's certificate is not verified" : undefined}>
                {connection.options.tlsAllowInvalidCertificates === true ? 'Certificates not verified' : 'TLS'}
              </Pill>
            )}
            <span className="dpitem__spacer" />
            <div className="rdconn__actions">
              <button type="button" className="iconbutton" title="Reconnect and read the server again" aria-label="Reconnect" onClick={() => setStatusKey((value) => value + 1)}>
                <Icon name="refresh" size={15} />
              </button>
              <button type="button" className="iconbutton" title="Edit the connection" aria-label="Edit connection" onClick={() => setDialog({ kind: 'edit', connection })}>
                <Icon name="edit" size={15} />
              </button>
              <button type="button" className="iconbutton iconbutton--danger" title="Remove the connection" aria-label="Remove connection" onClick={() => setRemoving(connection)}>
                <Icon name="trash" size={15} />
              </button>
            </div>
          </div>

          <nav className="subtabs" aria-label="Redis views">
            {(Object.keys(VIEW_LABEL) as View[]).map((value) => (
              <button key={value} type="button" className={`subtabs__tab${view === value ? ' subtabs__tab--active' : ''}`} onClick={() => setView(value)}>
                {VIEW_LABEL[value]}
              </button>
            ))}
          </nav>

          <div className="rdview">
            {view === 'browser' && (
              <div className="mglayout rdlayout">
                <aside className="mgside">
                  <KeyBrowser
                    key={connection.id}
                    connection={connection}
                    writable={writable}
                    selectedKey={selectedKey}
                    refreshToken={listVersion}
                    onSelect={setSelectedKey}
                    onNewKey={() => setDialog({ kind: 'newKey' })}
                    onDeletePattern={(pattern) => setDialog({ kind: 'deletePattern', pattern })}
                    onError={setError}
                  />
                </aside>
                <section className="mgmain">
                  {selectedKey !== null ? (
                    <KeyDetail
                      key={`${connection.id}:${selectedKey}`}
                      connection={connection}
                      keyName={selectedKey}
                      writable={writable}
                      hasJson={status?.hasJson === true}
                      onChanged={onChanged}
                      onRenamed={setSelectedKey}
                      onGone={onGone}
                      onError={setError}
                    />
                  ) : (
                    <EmptyState title="Pick a key" description="Choose a key on the left to see its value, expiry and size." />
                  )}
                </section>
              </div>
            )}
            {view === 'workbench' && <Workbench key={connection.id} connection={connection} onError={setError} />}
            {view === 'pubsub' && <PubSub key={connection.id} connection={connection} writable={writable} onError={setError} />}
            {view === 'insights' && <Insights key={connection.id} connection={connection} writable={writable} onError={setError} />}
          </div>
        </>
      )}

      {dialog?.kind === 'new' || dialog?.kind === 'edit' ? (
        <ConnectionDialog projectId={projectId} existing={dialog.kind === 'edit' ? dialog.connection : null} onClose={() => setDialog(null)} onSaved={upsert} />
      ) : null}

      {dialog?.kind === 'newKey' && connection !== null && (
        <NewKeyDialog
          connection={connection}
          hasJson={status?.hasJson === true}
          onCancel={() => setDialog(null)}
          onCreated={(key) => {
            setDialog(null);
            setSelectedKey(key);
            setListVersion((value) => value + 1);
          }}
        />
      )}

      {dialog?.kind === 'deletePattern' && connection !== null && (
        <PatternDeleteDialog
          connection={connection}
          pattern={dialog.pattern}
          onCancel={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setSelectedKey(null);
            setListVersion((value) => value + 1);
          }}
        />
      )}

      {removing !== null && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          confirmLabel="Remove connection"
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove(removing)}
        >
          <p>
            The connection and its stored password are deleted from Steward. Nothing changes on the Redis server, and your saved console
            commands for it are removed.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

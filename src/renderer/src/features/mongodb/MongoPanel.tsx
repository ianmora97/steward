import { useEffect, useState } from 'react';
import type { MongoConnection } from '@shared/schemas/mongodb';
import type { StewardError } from '@shared/types/result';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Icon } from '../../components/Icon';
import { Pill } from '../../components/Pill';
import { useAppStore } from '../../stores/app.store';
import { CollectionView } from './CollectionView';
import { ConnectionDialog } from './ConnectionDialog';
import { Explorer, type Namespace } from './Explorer';
import './mongo.css';

type Dialog = { kind: 'new' } | { kind: 'edit'; connection: MongoConnection } | null;

export function MongoPanel(): React.JSX.Element {
  const projectId = useAppStore((state) => state.selectedProjectId);
  const [connections, setConnections] = useState<MongoConnection[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [namespace, setNamespace] = useState<Namespace | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [removing, setRemoving] = useState<MongoConnection | null>(null);
  const [error, setError] = useState<StewardError | null>(null);

  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    void window.steward.mongo.list({ projectId }).then((result) => {
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

  if (projectId === null) return <div className="panel" />;

  const connection = connections?.find((candidate) => candidate.id === selectedId) ?? connections?.[0] ?? null;

  function upsert(saved: MongoConnection): void {
    setConnections((current) => {
      const list = current ?? [];
      const exists = list.some((candidate) => candidate.id === saved.id);
      const next = exists ? list.map((candidate) => (candidate.id === saved.id ? saved : candidate)) : [...list, saved];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
    setSelectedId(saved.id);
    setNamespace(null);
    setDialog(null);
  }

  async function remove(target: MongoConnection): Promise<void> {
    setRemoving(null);
    const result = await window.steward.mongo.remove({ id: target.id });
    if (!result.success) {
      setError(result.error);
      return;
    }
    setConnections((current) => (current ?? []).filter((candidate) => candidate.id !== target.id));
    if (selectedId === target.id) {
      setSelectedId(null);
      setNamespace(null);
    }
  }

  return (
    <div className="panel dppage mgpage">
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <header className="dppage__head">
        <div>
          <h2 className="dppage__title">MongoDB</h2>
          <p className="dppage__subtitle">
            Browse, query and edit databases: local, on your network, by IP, or on Atlas. Credentials are stored encrypted and never shown again.
          </p>
        </div>
        <div className="dktarget">
          {connections !== null && connections.length > 0 && connection !== null && (
            <label className="field">
              <span className="field__label">Connection</span>
              <select
                className="field__input"
                value={connection.id}
                onChange={(event) => {
                  setSelectedId(event.target.value);
                  setNamespace(null);
                }}
                aria-label="MongoDB connection"
              >
                {connections.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                    {candidate.environmentName === null ? '' : ` · ${candidate.environmentName}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="button button--primary" onClick={() => setDialog({ kind: 'new' })}>
            <Icon name="plus" size={14} /> New connection
          </button>
        </div>
      </header>

      {connections === null && <p className="card__hint">Loading connections…</p>}

      {connections !== null && connection === null && (
        <EmptyState title="No MongoDB connections yet" description="Add one with a connection string (mongodb:// or mongodb+srv://) or by filling in the fields.">
          <button type="button" className="button button--primary" onClick={() => setDialog({ kind: 'new' })}>
            New connection
          </button>
        </EmptyState>
      )}

      {connection !== null && (
        <>
          <div className="mgconnbar">
            <span className="dpmono mgconnbar__host" title={connection.hostDisplay}>
              {connection.hostDisplay}
            </span>
            {connection.isAtlas && (
              <Pill tone="info" icon="cloud">
                Atlas
              </Pill>
            )}
            {connection.environmentName !== null && (
              <Pill tone={connection.protectedEnvironment ? 'warning' : 'neutral'} icon={connection.protectedEnvironment ? 'shield' : 'tag'}>
                {connection.environmentName}
                {connection.protectedEnvironment ? ' (protected)' : ''}
              </Pill>
            )}
            {connection.readOnly ? (
              <Pill tone="success" icon="lock" title="Steward refuses every write on this connection">
                Read-only
              </Pill>
            ) : (
              <Pill tone="warning" icon="edit" title="This connection can change data">
                Can write
              </Pill>
            )}
            {connection.options.tlsAllowInvalidCertificates === true && (
              <Pill tone="failure" icon="alert" title="The server's certificate is not verified">
                Certificates not verified
              </Pill>
            )}
            <span className="dpitem__spacer" />
            <button type="button" className="button button--small" onClick={() => setDialog({ kind: 'edit', connection })}>
              <Icon name="edit" size={14} /> Edit
            </button>
            <button type="button" className="button button--small button--danger-text" onClick={() => setRemoving(connection)}>
              <Icon name="trash" size={14} /> Remove
            </button>
          </div>

          <div className="mglayout">
            <aside className="mgside">
              <Explorer key={connection.id} connection={connection} selected={namespace} onSelect={setNamespace} onError={setError} />
            </aside>
            <section className="mgmain">
              {namespace === null ? (
                <EmptyState title="Pick a collection" description="Open a database on the left and choose a collection to see its documents." />
              ) : (
                <CollectionView
                  key={`${connection.id}:${namespace.db}.${namespace.collection}`}
                  connection={connection}
                  db={namespace.db}
                  collection={namespace.collection}
                  onError={setError}
                />
              )}
            </section>
          </div>
        </>
      )}

      {dialog !== null && (
        <ConnectionDialog
          projectId={projectId}
          existing={dialog.kind === 'edit' ? dialog.connection : null}
          onClose={() => setDialog(null)}
          onSaved={upsert}
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
            The connection and its stored credentials are deleted from Steward. Nothing changes on the MongoDB server, and your saved queries for it
            are removed.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

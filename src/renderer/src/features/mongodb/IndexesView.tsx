import { useCallback, useEffect, useState } from 'react';
import type { MongoConnection, MongoIndex } from '@shared/schemas/mongodb';
import type { StewardError } from '@shared/types/result';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { Pill } from '../../components/Pill';

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function IndexesView({
  connection,
  db,
  collection,
  onError
}: {
  connection: MongoConnection;
  db: string;
  collection: string;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const [indexes, setIndexes] = useState<MongoIndex[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [keys, setKeys] = useState('{ field: 1 }');
  const [name, setName] = useState('');
  const [unique, setUnique] = useState(false);
  const [sparse, setSparse] = useState(false);
  const [ttl, setTtl] = useState('');
  const [partial, setPartial] = useState('');
  const [confirmBuild, setConfirmBuild] = useState(false);
  const [dropping, setDropping] = useState<MongoIndex | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchIndexes = useCallback(() => window.steward.mongo.listIndexes({ connectionId: connection.id, db, collection }), [connection.id, db, collection]);

  useEffect(() => {
    let cancelled = false;
    void fetchIndexes().then((result) => {
      if (cancelled) return;
      if (result.success) setIndexes(result.data);
      else onError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchIndexes, reloadKey, onError]);

  async function create(): Promise<void> {
    setBusy(true);
    const result = await window.steward.mongo.createIndex({
      connectionId: connection.id,
      db,
      collection,
      keys,
      ...(name.trim() === '' ? {} : { name: name.trim() }),
      ...(unique ? { unique: true } : {}),
      ...(sparse ? { sparse: true } : {}),
      ...(ttl.trim() === '' ? {} : { expireAfterSeconds: Number(ttl) }),
      ...(partial.trim() === '' ? {} : { partialFilterExpression: partial }),
      ...(connection.protectedEnvironment ? { confirmed: confirmBuild } : {})
    });
    setBusy(false);
    if (!result.success) {
      onError(result.error);
      return;
    }
    setCreating(false);
    setReloadKey((value) => value + 1);
  }

  return (
    <section className="mgindexes">
      <div className="mgtoolbar">
        <strong>Indexes</strong>
        <span className="dpitem__spacer" />
        <button type="button" className="button button--small" onClick={() => setReloadKey((value) => value + 1)}>
          <Icon name="refresh" size={14} /> Refresh
        </button>
        <button type="button" className="button button--small button--primary" disabled={connection.readOnly} title={connection.readOnly ? 'This connection is read-only' : undefined} onClick={() => setCreating((value) => !value)}>
          <Icon name="plus" size={14} /> Create index
        </button>
      </div>

      {creating && (
        <form
          className="mgindexes__form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label className="field">
            <span className="field__label">Keys</span>
            <input className="field__input dpmono" value={keys} onChange={(event) => setKeys(event.target.value)} placeholder='{ email: 1 }   or   { city: 1, createdAt: -1 }' spellCheck={false} />
          </label>
          <div className="dprow">
            <label className="field">
              <span className="field__label">Name (optional)</span>
              <input className="field__input" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Expire after (seconds, TTL)</span>
              <input className="field__input" type="number" min={0} value={ttl} onChange={(event) => setTtl(event.target.value)} />
            </label>
          </div>
          <label className="field">
            <span className="field__label">Partial filter (optional)</span>
            <input className="field__input dpmono" value={partial} onChange={(event) => setPartial(event.target.value)} placeholder='{ status: "active" }' spellCheck={false} />
          </label>
          <label className="dpcheck">
            <input type="checkbox" checked={unique} onChange={(event) => setUnique(event.target.checked)} />
            <span>Unique</span>
          </label>
          <label className="dpcheck">
            <input type="checkbox" checked={sparse} onChange={(event) => setSparse(event.target.checked)} />
            <span>Sparse</span>
          </label>
          {connection.protectedEnvironment && (
            <label className="dpcheck">
              <input type="checkbox" checked={confirmBuild} onChange={(event) => setConfirmBuild(event.target.checked)} />
              <span>
                <Icon name="alert" size={14} /> This connection is in a protected environment. Building an index can slow a busy database: I want to
                build it.
              </span>
            </label>
          )}
          <div className="dialog__actions">
            <button type="button" className="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" className="button button--primary" disabled={busy || keys.trim() === '' || (connection.protectedEnvironment && !confirmBuild)}>
              {busy ? 'Building…' : 'Create index'}
            </button>
          </div>
        </form>
      )}

      {indexes === null ? (
        <p className="card__hint">Loading…</p>
      ) : (
        <table className="mgtable">
          <thead>
            <tr>
              <th>Name</th>
              <th>Keys</th>
              <th>Properties</th>
              <th>Size</th>
              <th>Uses</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {indexes.map((index) => (
              <tr key={index.name}>
                <td className="dpmono">{index.name}</td>
                <td className="dpmono">{index.keys}</td>
                <td>
                  {index.unique && <Pill tone="info">unique</Pill>}{' '}
                  {index.sparse && <Pill tone="neutral">sparse</Pill>}{' '}
                  {index.partial && <Pill tone="neutral">partial</Pill>}{' '}
                  {index.expireAfterSeconds !== null && <Pill tone="warning">TTL {index.expireAfterSeconds}s</Pill>}
                </td>
                <td>{formatSize(index.sizeBytes)}</td>
                <td>{index.accesses === null ? '—' : index.accesses}</td>
                <td>
                  <button
                    type="button"
                    className="iconbutton"
                    aria-label={`Drop index ${index.name}`}
                    title={index.name === '_id_' ? 'The _id index cannot be dropped' : connection.readOnly ? 'This connection is read-only' : 'Drop'}
                    disabled={index.name === '_id_' || connection.readOnly}
                    onClick={() => setDropping(index)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="card__hint">Uses counts how often the server has used an index since it last started. Use Explain on a query to see which one it picks.</p>

      {dropping !== null && (
        <ConfirmDialog
          title={`Drop index ${dropping.name}?`}
          confirmLabel="Drop index"
          onCancel={() => setDropping(null)}
          onConfirm={() => {
            const target = dropping;
            setDropping(null);
            void window.steward.mongo.dropIndex({ connectionId: connection.id, db, collection, name: target.name, confirmed: true }).then((result) => {
              if (!result.success) onError(result.error);
              setReloadKey((value) => value + 1);
            });
          }}
        >
          <p>Queries that relied on <strong>{dropping.name}</strong> may become slow. It can be created again, but building it takes time.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

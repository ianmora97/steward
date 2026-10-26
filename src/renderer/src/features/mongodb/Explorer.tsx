import { useCallback, useEffect, useState } from 'react';
import type { MongoCollectionInfo, MongoConnection, MongoDatabaseInfo } from '@shared/schemas/mongodb';
import type { StewardError } from '@shared/types/result';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { DropDialog } from './DropDialog';

export interface Namespace {
  db: string;
  collection: string;
}

export function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

type Dropping = { kind: 'database'; db: string } | { kind: 'collection'; db: string; collection: string };

/** Databases and their collections, loaded as they are opened. */
export function Explorer({
  connection,
  selected,
  selectedDb,
  onSelect,
  onSelectDatabase,
  onCollectionsChanged,
  onError
}: {
  connection: MongoConnection;
  selected: Namespace | null;
  /** Database whose collections the main pane shows (also set while one of its collections is open). */
  selectedDb: string | null;
  onSelect: (namespace: Namespace | null) => void;
  onSelectDatabase: (db: string | null) => void;
  /** A collection was created or dropped here, so any list of them elsewhere is stale. */
  onCollectionsChanged: () => void;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const [databases, setDatabases] = useState<MongoDatabaseInfo[] | null>(null);
  const [collections, setCollections] = useState<Record<string, MongoCollectionInfo[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [dropping, setDropping] = useState<Dropping | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.steward.mongo.listDatabases({ id: connection.id }).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setDatabases(result.data);
        setFailed(false);
      } else {
        setFailed(true);
        onError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connection.id, refresh, onError]);

  const loadCollections = useCallback(
    async (db: string): Promise<void> => {
      const result = await window.steward.mongo.listCollections({ connectionId: connection.id, db });
      if (result.success) setCollections((current) => ({ ...current, [db]: result.data }));
      else onError(result.error);
    },
    [connection.id, onError]
  );

  /** A first click opens the database and shows its collections; clicking the one already shown folds it. */
  async function toggle(db: string): Promise<void> {
    const next = new Set(open);
    if (next.has(db) && selected === null && selectedDb === db) next.delete(db);
    else {
      next.add(db);
      onSelectDatabase(db);
      if (collections[db] === undefined) await loadCollections(db);
    }
    setOpen(next);
  }

  async function createCollection(db: string): Promise<void> {
    const result = await window.steward.mongo.createCollection({ connectionId: connection.id, db, collection: newName.trim() });
    if (!result.success) {
      onError(result.error);
      return;
    }
    setCreating(null);
    setNewName('');
    await loadCollections(db);
    onCollectionsChanged();
    setOpen((current) => new Set(current).add(db));
    onSelect({ db, collection: result.data.collection });
  }

  if (databases === null) {
    return failed ? (
      <EmptyState title="Could not connect" description="See the message above. Check the connection and try again.">
        <button type="button" className="button" onClick={() => setRefresh((value) => value + 1)}>
          Try again
        </button>
      </EmptyState>
    ) : (
      <p className="card__hint">Connecting…</p>
    );
  }

  const needle = filter.trim().toLowerCase();
  const visible = databases.filter(
    (database) =>
      needle === '' ||
      database.name.toLowerCase().includes(needle) ||
      (collections[database.name] ?? []).some((collection) => collection.name.toLowerCase().includes(needle))
  );

  return (
    <div className="mgexplorer">
      <div className="mgexplorer__bar">
        <label className="dksearch">
          <Icon name="search" size={14} />
          <input className="field__input" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter databases and collections" aria-label="Filter" />
        </label>
        <button type="button" className="iconbutton" title="Refresh" aria-label="Refresh databases" onClick={() => setRefresh((value) => value + 1)}>
          <Icon name="refresh" size={14} />
        </button>
      </div>

      {visible.length === 0 && <p className="card__hint">No databases match.</p>}

      <ul className="mgtree">
        {visible.map((database) => {
          const isOpen = open.has(database.name) || (needle !== '' && (collections[database.name] ?? []).length > 0);
          const list = (collections[database.name] ?? []).filter((collection) => needle === '' || database.name.toLowerCase().includes(needle) || collection.name.toLowerCase().includes(needle));
          return (
            <li key={database.name}>
              <div className={`mgtree__row mgtree__row--db${selected === null && selectedDb === database.name ? ' mgtree__row--active' : ''}`}>
                <button type="button" className="mgtree__label" onClick={() => void toggle(database.name)}>
                  <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={14} />
                  <span className="mgtree__name">{database.name}</span>
                  <span className="card__hint">{formatSize(database.sizeOnDisk)}</span>
                </button>
                <span className="mgtree__actions">
                  <button type="button" className="iconbutton" title={connection.readOnly ? 'Read-only connection' : 'New collection'} aria-label={`New collection in ${database.name}`} disabled={connection.readOnly} onClick={() => setCreating(database.name)}>
                    <Icon name="plus" size={14} />
                  </button>
                  <button type="button" className="iconbutton" title={connection.readOnly ? 'Read-only connection' : 'Drop database'} aria-label={`Drop database ${database.name}`} disabled={connection.readOnly} onClick={() => setDropping({ kind: 'database', db: database.name })}>
                    <Icon name="trash" size={14} />
                  </button>
                </span>
              </div>

              {isOpen && (
                <ul className="mgtree__children">
                  {creating === database.name && (
                    <li>
                      <form
                        className="mgtree__new"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (newName.trim() !== '') void createCollection(database.name);
                        }}
                      >
                        <input className="field__input" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="collection name" autoFocus spellCheck={false} />
                        <button type="submit" className="button button--small button--primary">Create</button>
                        <button type="button" className="button button--small" onClick={() => setCreating(null)}>Cancel</button>
                      </form>
                    </li>
                  )}
                  {collections[database.name] === undefined && <li className="card__hint">Loading…</li>}
                  {list.map((collection) => {
                    const active = selected?.db === database.name && selected.collection === collection.name;
                    return (
                      <li key={collection.name} className={`mgtree__row${active ? ' mgtree__row--active' : ''}`}>
                        <button type="button" className="mgtree__label" onClick={() => onSelect({ db: database.name, collection: collection.name })}>
                          <Icon name={collection.type === 'view' ? 'file' : 'folder'} size={14} />
                          <span className="mgtree__name">{collection.name}</span>
                          {collection.type !== 'collection' && <span className="card__hint">{collection.type}</span>}
                        </button>
                        <span className="mgtree__actions">
                          <button type="button" className="iconbutton" title={connection.readOnly ? 'Read-only connection' : 'Drop collection'} aria-label={`Drop collection ${collection.name}`} disabled={connection.readOnly} onClick={() => setDropping({ kind: 'collection', db: database.name, collection: collection.name })}>
                            <Icon name="trash" size={14} />
                          </button>
                        </span>
                      </li>
                    );
                  })}
                  {collections[database.name] !== undefined && list.length === 0 && creating !== database.name && <li className="card__hint">No collections.</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {dropping !== null && (
        <DropDialog
          title={dropping.kind === 'database' ? `Drop database ${dropping.db}?` : `Drop collection ${dropping.collection}?`}
          what={dropping.kind === 'database' ? 'The database' : 'The collection'}
          name={dropping.kind === 'database' ? dropping.db : dropping.collection}
          protectedConnection={connection.protectedEnvironment}
          connectionName={connection.name}
          onConfirm={(confirmName, confirmConnection) =>
            dropping.kind === 'database'
              ? window.steward.mongo.dropDatabase({
                  connectionId: connection.id,
                  db: dropping.db,
                  confirmed: true,
                  confirmName,
                  ...(confirmConnection === undefined ? {} : { confirmConnection })
                })
              : window.steward.mongo.dropCollection({
                  connectionId: connection.id,
                  db: dropping.db,
                  collection: dropping.collection,
                  confirmed: true,
                  confirmName,
                  ...(confirmConnection === undefined ? {} : { confirmConnection })
                })
          }
          onDone={() => {
            const dropped = dropping;
            setDropping(null);
            if (selected !== null && selected.db === dropped.db && (dropped.kind === 'database' || selected.collection === dropped.collection)) onSelect(null);
            if (dropped.kind === 'database' && selectedDb === dropped.db) onSelectDatabase(null);
            if (dropped.kind === 'database') setRefresh((value) => value + 1);
            else void loadCollections(dropped.db).then(onCollectionsChanged);
          }}
          onCancel={() => setDropping(null)}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { MongoCollectionInfo, MongoCollectionStats, MongoConnection } from '@shared/schemas/mongodb';
import type { StewardError } from '@shared/types/result';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { formatSize } from './Explorer';
import { Loading } from '../../components/Loading';
import { Badge } from '../../components/Badge';

/** Every collection of one database as cards; statistics fill in one by one so a large database does not block the list. */
export function DatabaseView({
  connection,
  db,
  onOpen,
  onError
}: {
  connection: MongoConnection;
  db: string;
  onOpen: (collection: string) => void;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const [collections, setCollections] = useState<MongoCollectionInfo[] | null>(null);
  const [stats, setStats] = useState<Record<string, MongoCollectionStats>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const listed = await window.steward.mongo.listCollections({ connectionId: connection.id, db });
      if (cancelled) return;
      if (!listed.success) {
        setCollections([]);
        onError(listed.error);
        return;
      }
      setCollections(listed.data);
      for (const info of listed.data) {
        if (info.type === 'view') continue;
        const result = await window.steward.mongo.collectionStats({ connectionId: connection.id, db, collection: info.name });
        if (cancelled) return;
        if (result.success) setStats((current) => ({ ...current, [info.name]: result.data }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection.id, db, onError]);

  if (collections === null) return <Loading lines={4} label="Loading collections…" />;

  return (
    <div className="mgdb">
      <header className="mgdb__head">
        <h3 className="mgcollection__title">
          <Icon name="database" size={18} />
          {db}
        </h3>
        <p className="card__hint">{collections.length === 1 ? '1 collection' : `${collections.length} collections`}</p>
      </header>

      {collections.length === 0 ? (
        <EmptyState title="No collections" description="This database has no collections yet. Use + next to it on the left to create one." />
      ) : (
        <ul className="mgdb__grid">
          {collections.map((info) => {
            const own = stats[info.name];
            return (
              <li key={info.name}>
                <button type="button" className="mgdb__card" onClick={() => onOpen(info.name)}>
                  <span className="mgdb__name">
                    <Icon name={info.type === 'view' ? 'file' : 'folder'} size={16} />
                    <span className="mgtree__name">{info.name}</span>
                  </span>
                  <span className="mgdb__meta">
                    {info.type !== 'collection' && <Badge tone="neutral" size="sm">
                        {info.type}
                      </Badge>}
                    {own === undefined ? (
                      info.type === 'view' ? null : <span className="card__hint">…</span>
                    ) : (
                      <span className="card__hint">
                        {own.documentCount ?? '—'} docs · {formatSize(own.size) || '—'}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

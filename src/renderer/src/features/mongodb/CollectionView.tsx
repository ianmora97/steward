import { useCallback, useEffect, useState } from 'react';
import type { MongoCollectionStats, MongoConnection } from '@shared/schemas/mongodb';
import type { StewardError } from '@shared/types/result';
import { AggregationView } from './AggregationView';
import { DocumentsView } from './DocumentsView';
import { IndexesView } from './IndexesView';
import { SchemaView } from './SchemaView';
import { ValidationView } from './ValidationView';

type Tab = 'documents' | 'aggregations' | 'schema' | 'indexes' | 'validation';

const TAB_LABEL: Record<Tab, string> = {
  documents: 'Documents',
  aggregations: 'Aggregations',
  schema: 'Schema',
  indexes: 'Indexes',
  validation: 'Validation'
};

function size(bytes: number | null): string {
  if (bytes === null) return '—';
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

export function CollectionView({
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
  const [tab, setTab] = useState<Tab>('documents');
  const [stats, setStats] = useState<MongoCollectionStats | null>(null);
  const [statsKey, setStatsKey] = useState(0);

  const fetchStats = useCallback(
    () => window.steward.mongo.collectionStats({ connectionId: connection.id, db, collection }),
    [connection.id, db, collection]
  );

  useEffect(() => {
    let cancelled = false;
    void fetchStats().then((result) => {
      if (!cancelled && result.success) setStats(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchStats, statsKey]);

  return (
    <div className="mgcollection">
      <header className="mgcollection__head">
        <div>
          <h3 className="mgcollection__title">
            <span className="card__hint">{db}.</span>
            {collection}
          </h3>
          <p className="card__hint">
            {stats === null
              ? 'Reading statistics…'
              : `${stats.documentCount ?? '—'} documents · ${size(stats.size)} · avg ${size(stats.avgObjSize)} · storage ${size(stats.storageSize)} · ${stats.indexCount ?? '—'} indexes (${size(stats.totalIndexSize)})`}
          </p>
        </div>
      </header>

      <nav className="subtabs mgcollection__tabs" aria-label="Collection views">
        {(Object.keys(TAB_LABEL) as Tab[]).map((value) => (
          <button key={value} type="button" className={`subtabs__tab${tab === value ? ' subtabs__tab--active' : ''}`} onClick={() => setTab(value)}>
            {TAB_LABEL[value]}
          </button>
        ))}
      </nav>

      <div className="mgcollection__body">
        {tab === 'documents' && (
          <DocumentsView connection={connection} db={db} collection={collection} onError={onError} onChanged={() => setStatsKey((value) => value + 1)} />
        )}
        {tab === 'aggregations' && <AggregationView connection={connection} db={db} collection={collection} onError={onError} />}
        {tab === 'schema' && <SchemaView connection={connection} db={db} collection={collection} onError={onError} />}
        {tab === 'indexes' && <IndexesView connection={connection} db={db} collection={collection} onError={onError} />}
        {tab === 'validation' && <ValidationView connection={connection} db={db} collection={collection} onError={onError} />}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { MongoConnection } from '@shared/schemas/mongodb';
import type { StewardError } from '@shared/types/result';
import { Modal } from '../../components/Modal';

/**
 * Deletes or updates every document that matches the current filter. The number shown here is counted for real, and
 * main counts again before it writes: if the data moved in between, nothing happens.
 */
export function BulkDialog({
  kind,
  connection,
  db,
  collection,
  filter,
  onClose,
  onDone
}: {
  kind: 'delete' | 'update';
  connection: MongoConnection;
  db: string;
  collection: string;
  filter: string;
  onClose: () => void;
  onDone: (changed: number) => void;
}): React.JSX.Element {
  const [count, setCount] = useState<number | null>(null);
  const [update, setUpdate] = useState('{ $set: {  } }');
  const [typedCollection, setTypedCollection] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<StewardError | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.steward.mongo.count({ connectionId: connection.id, db, collection, filter, exact: true }).then((result) => {
      if (cancelled) return;
      if (result.success) setCount(result.data.count);
      else setProblem(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [connection.id, db, collection, filter]);

  const everything = filter.trim() === '' || filter.trim() === '{}';
  const needsName = everything && typedCollection !== collection;
  const ready = count !== null && !needsName && (kind === 'delete' || update.trim() !== '') && !busy;

  async function confirm(): Promise<void> {
    if (count === null) return;
    setBusy(true);
    setProblem(null);
    const base = {
      connectionId: connection.id,
      db,
      collection,
      filter,
      expectedCount: count,
      confirmed: true as const,
      ...(everything ? { confirmCollection: typedCollection } : {})
    };
    const result = kind === 'delete' ? await window.steward.mongo.deleteMany(base) : await window.steward.mongo.updateMany({ ...base, update });
    setBusy(false);
    if (result.success) onDone(result.data.count);
    else setProblem(result.error);
  }

  return (
    <Modal title={kind === 'delete' ? 'Delete matching documents' : 'Update matching documents'} onClose={onClose} className="mgeditor">
      <div className="mgeditor__body">
        <p>
          {count === null && problem === null ? 'Counting…' : count === null ? 'Could not count.' : (
            <>
              <strong>{count}</strong> document{count === 1 ? '' : 's'} in <code className="dpmono">{db}.{collection}</code> match{count === 1 ? 'es' : ''}{' '}
              <code className="dpmono">{everything ? '{} (every document)' : filter}</code>.
            </>
          )}
        </p>
        {kind === 'update' && (
          <label className="field">
            <span className="field__label">Update (operators or a pipeline)</span>
            <textarea className="field__input mgeditor__text dpmono" value={update} onChange={(event) => setUpdate(event.target.value)} spellCheck={false} style={{ minHeight: 100 }} />
          </label>
        )}
        {everything && (
          <label className="field">
            <span className="field__label">An empty filter touches every document: type the collection name ({collection}) to confirm</span>
            <input className="field__input" value={typedCollection} onChange={(event) => setTypedCollection(event.target.value)} spellCheck={false} />
          </label>
        )}
        {problem !== null && (
          <div className="banner banner--error" role="alert">
            <span className="banner__message">{problem.message}</span>
            {problem.details !== undefined && <span className="banner__details">{problem.details}</span>}
          </div>
        )}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button button--danger" disabled={!ready} onClick={() => void confirm()}>
            {busy ? 'Working…' : kind === 'delete' ? `Delete ${count ?? ''} documents` : `Update ${count ?? ''} documents`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

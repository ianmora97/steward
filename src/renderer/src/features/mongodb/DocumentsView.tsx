import { useEffect, useState } from 'react';
import {
  documentIdEjson,
  documentToShellText,
  formatNode,
  parseDocumentJson,
  toDisplayNode
} from '@shared/mongo/shell-format';
import {
  MONGO_FIND_LIMIT_DEFAULT,
  type MongoConnection,
  type MongoCountResult,
  type MongoDocument,
  type MongoExplainSummary,
  type MongoExportFormat,
  type MongoFindResult,
  type MongoSavedQuery
} from '@shared/schemas/mongodb';
import type { StewardError } from '@shared/types/result';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { BulkDialog } from './BulkDialog';
import { DocumentEditor } from './DocumentEditor';
import { DocumentResults, ViewSwitch, type DocumentActions, type DocumentViewMode } from './DocumentViews';
import { ExplainPanel } from './ExplainPanel';

const VIEW_KEY = 'steward.mongo.view';
const LIMITS = [20, 50, 100, 500] as const;

function readView(): DocumentViewMode {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    if (stored === 'list' || stored === 'json' || stored === 'table') return stored;
  } catch {
    // The preference just won't persist.
  }
  return 'list';
}

interface Applied {
  /** Changes on every fetch of the page. */
  nonce: number;
  /** Changes only when the total has to be counted again (a new query, a refresh, a write). */
  countNonce: number;
  filter: string;
  project: string;
  sort: string;
  skip: number;
  limit: number;
  maxTimeMS: number;
}

type Editing = { kind: 'edit' | 'clone'; document: MongoDocument } | { kind: 'insert' } | null;

/** A document as editable text; a clone drops the `_id` so the server makes a new one. */
function editableText(document: MongoDocument, dropId: boolean): string {
  if (!dropId) return documentToShellText(document.json);
  const value = parseDocumentJson(document.json) as Record<string, unknown>;
  const { _id: removed, ...rest } = value;
  void removed;
  return formatNode(toDisplayNode(rest));
}

export function DocumentsView({
  connection,
  db,
  collection,
  onError,
  onChanged
}: {
  connection: MongoConnection;
  db: string;
  collection: string;
  onError: (error: StewardError) => void;
  /** A write happened: the collection list and the stats above may have changed. */
  onChanged: () => void;
}): React.JSX.Element {
  const [filter, setFilter] = useState('');
  const [project, setProject] = useState('');
  const [sort, setSort] = useState('');
  const [limit, setLimit] = useState<number>(MONGO_FIND_LIMIT_DEFAULT);
  const [maxTimeSeconds, setMaxTimeSeconds] = useState(30);
  const [showOptions, setShowOptions] = useState(false);
  const [mode, setMode] = useState<DocumentViewMode>(readView);
  const [applied, setApplied] = useState<Applied>({
    nonce: 0,
    countNonce: 0,
    filter: '',
    project: '',
    sort: '',
    skip: 0,
    limit: MONGO_FIND_LIMIT_DEFAULT,
    maxTimeMS: 30_000
  });
  const [page, setPage] = useState<{ nonce: number; data: MongoFindResult | null } | null>(null);
  const [total, setTotal] = useState<{ nonce: number; data: MongoCountResult | null } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<MongoDocument | null>(null);
  const [bulk, setBulk] = useState<'delete' | 'update' | null>(null);
  const [explain, setExplain] = useState<MongoExplainSummary | null>(null);
  const [exportFormat, setExportFormat] = useState<MongoExportFormat>('json');
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<MongoSavedQuery[]>([]);
  const [savedReload, setSavedReload] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);

  const readOnly = connection.readOnly;

  useEffect(() => {
    let cancelled = false;
    void window.steward.mongo
      .find({
        connectionId: connection.id,
        db,
        collection,
        filter: applied.filter,
        project: applied.project,
        sort: applied.sort,
        skip: applied.skip,
        limit: applied.limit,
        maxTimeMS: applied.maxTimeMS
      })
      .then((result) => {
        if (cancelled) return;
        setPage({ nonce: applied.nonce, data: result.success ? result.data : null });
        if (!result.success) onError(result.error);
      });
    return () => {
      cancelled = true;
    };
  }, [connection.id, db, collection, applied, onError]);

  useEffect(() => {
    let cancelled = false;
    void window.steward.mongo
      .count({ connectionId: connection.id, db, collection, filter: applied.filter, maxTimeMS: applied.maxTimeMS })
      .then((result) => {
        if (cancelled) return;
        setTotal({ nonce: applied.countNonce, data: result.success ? result.data : null });
      });
    return () => {
      cancelled = true;
    };
    // The total follows the query, not the page: moving to the next page must not count again.
  }, [connection.id, db, collection, applied.countNonce, applied.filter, applied.maxTimeMS]);

  useEffect(() => {
    let cancelled = false;
    void window.steward.mongo.listSavedQueries({ connectionId: connection.id, db, collection }).then((result) => {
      if (!cancelled && result.success) setSaved(result.data.filter((query) => query.kind === 'find'));
    });
    return () => {
      cancelled = true;
    };
  }, [connection.id, db, collection, savedReload]);

  const loading = page === null || page.nonce !== applied.nonce;
  const documents = page?.data?.documents ?? [];
  const totalCount = total !== null && total.nonce === applied.countNonce ? total.data : null;

  function find(next: Partial<Applied> = {}): void {
    setApplied((current) => ({
      ...current,
      filter,
      project,
      sort,
      limit,
      maxTimeMS: maxTimeSeconds * 1000,
      skip: 0,
      nonce: current.nonce + 1,
      countNonce: current.countNonce + 1,
      ...next
    }));
  }

  /** After a write: same query, fresh page, fresh total. */
  function reload(): void {
    setApplied((current) => ({ ...current, nonce: current.nonce + 1, countNonce: current.countNonce + 1 }));
    onChanged();
  }

  function goTo(skip: number): void {
    setApplied((current) => ({ ...current, skip: Math.max(0, skip), nonce: current.nonce + 1 }));
  }

  function chooseMode(value: DocumentViewMode): void {
    setMode(value);
    try {
      localStorage.setItem(VIEW_KEY, value);
    } catch {
      // Not saved; the choice still applies to this session.
    }
  }

  async function runExplain(): Promise<void> {
    const result = await window.steward.mongo.explain({ connectionId: connection.id, db, collection, filter, sort });
    if (result.success) setExplain(result.data);
    else onError(result.error);
  }

  async function exportNow(): Promise<void> {
    setNotice(null);
    const result = await window.steward.mongo.exportQuery({
      connectionId: connection.id,
      db,
      collection,
      filter: applied.filter,
      project: applied.project,
      sort: applied.sort,
      format: exportFormat
    });
    if (!result.success) onError(result.error);
    else if (!result.data.cancelled) setNotice(`Exported ${result.data.count} documents to ${result.data.path ?? ''}.`);
  }

  async function importNow(): Promise<void> {
    setNotice(null);
    const picked = await window.steward.mongo.pickFile({ purpose: 'import' });
    if (!picked.success) {
      onError(picked.error);
      return;
    }
    if (picked.data.cancelled || picked.data.value === null) return;
    const name = (picked.data.fileName ?? '').toLowerCase();
    const format: MongoExportFormat = name.endsWith('.csv') ? 'csv' : name.endsWith('.ndjson') || name.endsWith('.jsonl') ? 'ndjson' : 'json';
    const result = await window.steward.mongo.importFile({ connectionId: connection.id, db, collection, fileToken: picked.data.value, format });
    if (!result.success) {
      onError(result.error);
      return;
    }
    setNotice(
      `Imported ${result.data.insertedCount} documents${result.data.failedCount > 0 ? `; ${result.data.failedCount} failed${result.data.firstError === null ? '' : ` (first: ${result.data.firstError})`}` : ''}.`
    );
    reload();
  }

  async function saveCurrent(name: string): Promise<void> {
    const result = await window.steward.mongo.saveQuery({
      connectionId: connection.id,
      db,
      collection,
      name,
      kind: 'find',
      body: { filter, project, sort }
    });
    if (!result.success) onError(result.error);
    else {
      setSaving(null);
      setSavedReload((value) => value + 1);
    }
  }

  const actions: DocumentActions = {
    onEdit: (document) => setEditing({ kind: 'edit', document }),
    onClone: (document) => setEditing({ kind: 'clone', document }),
    onDelete: setDeleting
  };

  const first = applied.skip + 1;
  const last = applied.skip + documents.length;

  return (
    <section className="mgdocsview">
      <form
        className="mgquery"
        onSubmit={(event) => {
          event.preventDefault();
          find();
        }}
      >
        <div className="mgquery__row">
          <label className="mgquery__filter">
            <span className="field__label">Filter</span>
            <input
              className="field__input dpmono"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder='{ "status": "active", age: { $gt: 30 } }   — shell syntax: ObjectId("…"), ISODate("…")'
              spellCheck={false}
              aria-label="Filter"
            />
          </label>
          <button type="submit" className="button button--primary">
            Find
          </button>
          <button
            type="button"
            className="button"
            onClick={() => {
              setFilter('');
              setProject('');
              setSort('');
              find({ filter: '', project: '', sort: '' });
            }}
          >
            Reset
          </button>
          <button type="button" className="button" onClick={() => void runExplain()}>
            Explain
          </button>
          <button type="button" className="button button--small" onClick={() => setShowOptions((value) => !value)} aria-expanded={showOptions}>
            Options {showOptions ? '▴' : '▾'}
          </button>
        </div>

        {showOptions && (
          <div className="mgquery__options">
            <label className="field">
              <span className="field__label">Project</span>
              <input className="field__input dpmono" value={project} onChange={(event) => setProject(event.target.value)} placeholder="{ name: 1, _id: 0 }" spellCheck={false} />
            </label>
            <label className="field">
              <span className="field__label">Sort</span>
              <input className="field__input dpmono" value={sort} onChange={(event) => setSort(event.target.value)} placeholder="{ createdAt: -1 }" spellCheck={false} />
            </label>
            <label className="field">
              <span className="field__label">Per page</span>
              <select className="field__input" value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
                {LIMITS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Time limit (s)</span>
              <input className="field__input" type="number" min={1} max={120} value={maxTimeSeconds} onChange={(event) => setMaxTimeSeconds(Math.min(120, Math.max(1, Number(event.target.value) || 30)))} />
            </label>
          </div>
        )}
      </form>

      <div className="mgtoolbar">
        <ViewSwitch mode={mode} onChange={chooseMode} />
        <span className="card__hint mgtoolbar__count">
          {loading
            ? 'Loading…'
            : documents.length === 0
              ? '0 documents'
              : `${first}–${last}${totalCount === null ? '' : ` of ${totalCount.estimated ? '≈ ' : ''}${totalCount.count}`}`}
          {page?.data !== null && page?.data !== undefined && !loading ? ` · ${page.data.elapsedMs} ms` : ''}
        </span>
        <span className="dpitem__spacer" />
        <button type="button" className="iconbutton mgtoolbar__prev" aria-label="Previous page" disabled={applied.skip === 0 || loading} onClick={() => goTo(applied.skip - applied.limit)}>
          <Icon name="chevronRight" size={14} />
        </button>
        <button type="button" className="iconbutton mgtoolbar__next" aria-label="Next page" disabled={!(page?.data?.hasMore ?? false) || loading} onClick={() => goTo(applied.skip + applied.limit)}>
          <Icon name="chevronRight" size={14} />
        </button>
        <button type="button" className="button button--small" disabled={readOnly} title={readOnly ? 'This connection is read-only' : undefined} onClick={() => setEditing({ kind: 'insert' })}>
          <Icon name="plus" size={14} /> Insert document
        </button>
        <button type="button" className="button button--small" disabled={readOnly} title={readOnly ? 'This connection is read-only' : undefined} onClick={() => void importNow()}>
          Import…
        </button>
        <select className="field__input mgtoolbar__format" value={exportFormat} onChange={(event) => setExportFormat(event.target.value as MongoExportFormat)} aria-label="Export format">
          <option value="json">JSON</option>
          <option value="ndjson">JSON Lines</option>
          <option value="csv">CSV</option>
        </select>
        <button type="button" className="button button--small" onClick={() => void exportNow()}>
          Export…
        </button>
        <button type="button" className="button button--small button--danger-text" disabled={readOnly} onClick={() => setBulk('delete')}>
          Delete matching…
        </button>
        <button type="button" className="button button--small button--danger-text" disabled={readOnly} onClick={() => setBulk('update')}>
          Update matching…
        </button>
      </div>

      <div className="mgsaved">
        <select
          className="field__input"
          value=""
          onChange={(event) => {
            const query = saved.find((candidate) => candidate.id === event.target.value);
            if (query === undefined) return;
            setFilter(query.body.filter ?? '');
            setProject(query.body.project ?? '');
            setSort(query.body.sort ?? '');
            find({ filter: query.body.filter ?? '', project: query.body.project ?? '', sort: query.body.sort ?? '' });
          }}
          aria-label="Saved queries"
        >
          <option value="">Saved queries ({saved.length})</option>
          {saved.map((query) => (
            <option key={query.id} value={query.id}>
              {query.name}
            </option>
          ))}
        </select>
        {saving === null ? (
          <button type="button" className="button button--small" onClick={() => setSaving('')}>
            Save this query
          </button>
        ) : (
          <form
            className="mgsaved__form"
            onSubmit={(event) => {
              event.preventDefault();
              if (saving.trim() !== '') void saveCurrent(saving.trim());
            }}
          >
            <input className="field__input" value={saving} onChange={(event) => setSaving(event.target.value)} placeholder="Name" autoFocus />
            <button type="submit" className="button button--small button--primary">Save</button>
            <button type="button" className="button button--small" onClick={() => setSaving(null)}>Cancel</button>
          </form>
        )}
        {saved.length > 0 && (
          <details className="mgsaved__manage">
            <summary>Manage</summary>
            <ul>
              {saved.map((query) => (
                <li key={query.id}>
                  {query.name}
                  <button
                    type="button"
                    className="iconbutton"
                    aria-label={`Delete saved query ${query.name}`}
                    onClick={() =>
                      void window.steward.mongo.deleteSavedQuery({ id: query.id }).then((result) => {
                        if (result.success) setSavedReload((value) => value + 1);
                        else onError(result.error);
                      })
                    }
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {notice !== null && <p className="card__hint">{notice}</p>}
      {explain !== null && <ExplainPanel summary={explain} onClose={() => setExplain(null)} />}
      {page?.data?.truncated === true && <p className="card__hint">The response was cut to stay under 4 MB. Use a narrower filter or fewer fields.</p>}

      {loading && page === null ? (
        <p className="card__hint">Loading…</p>
      ) : (
        <DocumentResults documents={documents} mode={mode} actions={actions} readOnly={readOnly} />
      )}

      {editing !== null && (
        <DocumentEditor
          title={editing.kind === 'insert' ? 'Insert document' : editing.kind === 'clone' ? 'Clone document' : 'Edit document'}
          hint={
            editing.kind === 'edit'
              ? 'Shell syntax. Types are kept: ObjectId("…"), ISODate("…"), NumberLong("…"), Decimal128("…"), Double(3).'
              : 'One document { … } or several [ { … }, { … } ]. A missing _id is created by the server.'
          }
          initialText={editing.kind === 'insert' ? '{\n  \n}' : editableText(editing.document, editing.kind === 'clone')}
          submitLabel={editing.kind === 'edit' ? 'Save' : 'Insert'}
          onSubmit={(text, force) => {
            if (editing.kind === 'edit') {
              const id = documentIdEjson(editing.document.json);
              if (id === null) {
                return Promise.resolve({ success: false as const, error: { code: 'VALIDATION_FAILED' as const, message: 'That document has no _id' } });
              }
              return window.steward.mongo.replace({ connectionId: connection.id, db, collection, id, document: text, expected: editing.document.json, force });
            }
            return window.steward.mongo.insert({ connectionId: connection.id, db, collection, documents: text });
          }}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting !== null && (
        <ConfirmDialog
          title="Delete this document?"
          confirmLabel="Delete document"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const target = deleting;
            setDeleting(null);
            const id = documentIdEjson(target.json);
            if (id === null) return;
            void window.steward.mongo.deleteOne({ connectionId: connection.id, db, collection, id, confirmed: true }).then((result) => {
              if (!result.success) onError(result.error);
              reload();
            });
          }}
        >
          <p>The document is removed from <strong>{db}.{collection}</strong>. This cannot be undone.</p>
        </ConfirmDialog>
      )}

      {bulk !== null && (
        <BulkDialog
          kind={bulk}
          connection={connection}
          db={db}
          collection={collection}
          filter={applied.filter}
          onClose={() => setBulk(null)}
          onDone={(changed) => {
            setBulk(null);
            setNotice(`${bulk === 'delete' ? 'Deleted' : 'Updated'} ${changed} documents.`);
            reload();
          }}
        />
      )}
    </section>
  );
}

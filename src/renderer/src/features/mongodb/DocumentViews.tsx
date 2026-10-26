import { useMemo } from 'react';
import {
  columnsOf,
  documentIdText,
  formatCompact,
  formatNode,
  parseDocumentJson,
  toDisplayNode,
  type DisplayNode
} from '@shared/mongo/shell-format';
import type { MongoDocument } from '@shared/schemas/mongodb';
import { IconButton } from '../../components/IconButton';
import { Button } from '../../components/Button';

export type DocumentViewMode = 'list' | 'json' | 'table';

export interface DocumentActions {
  onEdit: (document: MongoDocument) => void;
  onClone: (document: MongoDocument) => void;
  onDelete: (document: MongoDocument) => void;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function Scalar({ node }: { node: Extract<DisplayNode, { kind: 'scalar' }> }): React.JSX.Element {
  return <span className={`mgv mgv--${node.type}`}>{node.text}</span>;
}

/** One field of a document, with nested objects and arrays that fold open. */
function Tree({ name, node, depth }: { name: string | null; node: DisplayNode; depth: number }): React.JSX.Element {
  const label = name === null ? null : <span className="mgkey">{name}</span>;
  if (node.kind === 'scalar') {
    return (
      <div className="mgfield">
        {label}
        {label !== null && <span className="mgsep">: </span>}
        <Scalar node={node} />
      </div>
    );
  }
  const count = node.kind === 'array' ? node.items.length : node.entries.length;
  const open = depth < 1;
  return (
    <details className="mgfold" open={open}>
      <summary>
        {label}
        {label !== null && <span className="mgsep">: </span>}
        <span className="mgsummary">{node.kind === 'array' ? `Array (${count})` : `Object (${count})`}</span>
      </summary>
      <div className="mgchildren">
        {node.kind === 'array'
          ? node.items.map((item, index) => <Tree key={index} name={String(index)} node={item} depth={depth + 1} />)
          : node.entries.map(([key, inner]) => <Tree key={key} name={key} node={inner} depth={depth + 1} />)}
      </div>
    </details>
  );
}

function ActionButtons({
  document,
  actions,
  readOnly
}: {
  document: MongoDocument;
  actions: DocumentActions;
  readOnly: boolean;
}): React.JSX.Element {
  const locked = readOnly || document.tooLarge;
  const reason = readOnly ? 'This connection is read-only' : document.tooLarge ? 'Too large to edit here' : undefined;
  return (
    <span className="mgdocactions">
      <IconButton icon="edit" label={reason ?? 'Edit'} disabled={locked} size={14} onClick={() => actions.onEdit(document)} />
      <IconButton icon="plus" label={reason ?? 'Clone'} disabled={locked} size={14} onClick={() => actions.onClone(document)} />
      <IconButton icon="trash" label={reason ?? 'Delete'} disabled={locked} size={14} onClick={() => actions.onDelete(document)} />
    </span>
  );
}

function ListView({ documents, actions, readOnly }: { documents: MongoDocument[]; actions: DocumentActions | null; readOnly: boolean }): React.JSX.Element {
  return (
    <ul className="mgdocs">
      {documents.map((document, index) => (
        <li key={`${index}:${document.json.length}`} className="mgdoc">
          <header className="mgdoc__head">
            <span className="mgdoc__id dpmono">{documentIdText(document.json)}</span>
            {document.tooLarge && <span className="card__hint">Too large to display ({megabytes(document.sizeBytes)})</span>}
            {actions !== null && <ActionButtons document={document} actions={actions} readOnly={readOnly} />}
          </header>
          {!document.tooLarge && <Tree name={null} node={toDisplayNode(parseDocumentJson(document.json))} depth={0} />}
        </li>
      ))}
    </ul>
  );
}

function JsonView({ documents, actions, readOnly }: { documents: MongoDocument[]; actions: DocumentActions | null; readOnly: boolean }): React.JSX.Element {
  return (
    <ul className="mgdocs">
      {documents.map((document, index) => (
        <li key={`${index}:${document.json.length}`} className="mgdoc">
          <header className="mgdoc__head">
            <span className="mgdoc__id dpmono">{documentIdText(document.json)}</span>
            <Button size="sm" onClick={() => void navigator.clipboard.writeText(formatNode(toDisplayNode(parseDocumentJson(document.json))))}>
              Copy
            </Button>
            {actions !== null && <ActionButtons document={document} actions={actions} readOnly={readOnly} />}
          </header>
          <pre className="mgjson dpmono">
            {document.tooLarge ? `Too large to display (${megabytes(document.sizeBytes)})` : formatNode(toDisplayNode(parseDocumentJson(document.json)))}
          </pre>
        </li>
      ))}
    </ul>
  );
}

function TableView({ documents, actions, readOnly }: { documents: MongoDocument[]; actions: DocumentActions | null; readOnly: boolean }): React.JSX.Element {
  const columns = useMemo(() => columnsOf(documents.filter((document) => !document.tooLarge).map((document) => document.json)), [documents]);
  return (
    <div className="mgtable__wrap">
      <table className="mgtable">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
            {actions !== null && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {documents.map((document, index) => {
            const parsed = document.tooLarge ? null : (parseDocumentJson(document.json) as Record<string, unknown>);
            return (
              <tr key={`${index}:${document.json.length}`}>
                {columns.map((column) => {
                  if (parsed === null) return <td key={column} className="card__hint">{column === '_id' ? documentIdText(document.json) : '—'}</td>;
                  if (!(column in parsed)) return <td key={column} className="card__hint">—</td>;
                  const node = toDisplayNode(parsed[column]);
                  return (
                    <td key={column} title={formatNode(node)} className={node.kind === 'scalar' ? `mgv mgv--${node.type}` : 'mgv'}>
                      {formatCompact(node, 60)}
                    </td>
                  );
                })}
                {actions !== null && (
                  <td>
                    <ActionButtons document={document} actions={actions} readOnly={readOnly} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The same documents three ways: a tree, formatted text, or a table of the top-level fields. */
export function DocumentResults({
  documents,
  mode,
  actions,
  readOnly
}: {
  documents: MongoDocument[];
  mode: DocumentViewMode;
  /** Null for results that are not documents of a collection (an aggregation): nothing to edit. */
  actions: DocumentActions | null;
  readOnly: boolean;
}): React.JSX.Element {
  if (documents.length === 0) return <p className="card__hint">No documents match.</p>;
  if (mode === 'json') return <JsonView documents={documents} actions={actions} readOnly={readOnly} />;
  if (mode === 'table') return <TableView documents={documents} actions={actions} readOnly={readOnly} />;
  return <ListView documents={documents} actions={actions} readOnly={readOnly} />;
}

const VIEW_LABELS: Record<DocumentViewMode, string> = { list: 'List', json: 'JSON', table: 'Table' };

export function ViewSwitch({ mode, onChange }: { mode: DocumentViewMode; onChange: (mode: DocumentViewMode) => void }): React.JSX.Element {
  const labels = VIEW_LABELS;
  return (
    <div className="segmented" role="group" aria-label="Document view">
      {(Object.keys(labels) as DocumentViewMode[]).map((value) => (
        <button
          key={value}
          type="button"
          className={`segmented__option${mode === value ? ' segmented__option--active' : ''}`}
          onClick={() => onChange(value)}
        >
          {labels[value]}
        </button>
      ))}
    </div>
  );
}

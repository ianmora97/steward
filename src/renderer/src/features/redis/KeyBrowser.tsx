import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RedisConnection, RedisKeyEntry } from '@shared/schemas/redis';
import type { StewardError } from '@shared/types/result';
import { Icon } from '../../components/Icon';
import { Badge } from '../../components/Badge';
import { formatCount, formatTtl, KEY_TYPES, typeLabel, typeTone } from './redis-meta';
import { IconButton } from '../../components/IconButton';
import { Button } from '../../components/Button';

const ROW_LIMIT = 2000;

type View = 'list' | 'tree';

interface TreeRow {
  kind: 'folder' | 'key';
  id: string;
  depth: number;
  label: string;
  count?: number;
  entry?: RedisKeyEntry;
}

interface Folder {
  children: Map<string, Folder>;
  keys: RedisKeyEntry[];
  total: number;
}

function buildTree(keys: RedisKeyEntry[], delimiter: string): Folder {
  const root: Folder = { children: new Map(), keys: [], total: 0 };
  for (const entry of keys) {
    const parts = entry.key.split(delimiter);
    let folder = root;
    folder.total += 1;
    for (const part of parts.slice(0, -1)) {
      let child = folder.children.get(part);
      if (child === undefined) {
        child = { children: new Map(), keys: [], total: 0 };
        folder.children.set(part, child);
      }
      child.total += 1;
      folder = child;
    }
    folder.keys.push(entry);
  }
  return root;
}

function flatten(folder: Folder, path: string, depth: number, delimiter: string, open: Set<string>, rows: TreeRow[]): void {
  const names = [...folder.children.keys()].sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    const child = folder.children.get(name);
    if (child === undefined) continue;
    const id = `${path}${name}${delimiter}`;
    rows.push({ kind: 'folder', id, depth, label: name, count: child.total });
    if (open.has(id)) flatten(child, id, depth + 1, delimiter, open, rows);
  }
  for (const entry of [...folder.keys].sort((a, b) => a.key.localeCompare(b.key))) {
    rows.push({ kind: 'key', id: entry.key, depth, label: entry.key.slice(path.length), entry });
  }
}

export function KeyBrowser({
  connection,
  writable,
  selectedKey,
  refreshToken,
  onSelect,
  onNewKey,
  onDeletePattern,
  onError
}: {
  connection: RedisConnection;
  writable: boolean;
  selectedKey: string | null;
  /** Bumped by the page when something changed a key, so the list is read again. */
  refreshToken: number;
  onSelect: (key: string | null) => void;
  onNewKey: () => void;
  /** Opens the bulk-delete dialog for the pattern in the box. */
  onDeletePattern: (pattern: string) => void;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const delimiter = connection.options.keyDelimiter ?? ':';
  const [view, setView] = useState<View>('tree');
  const [patternInput, setPatternInput] = useState('');
  const [pattern, setPattern] = useState('');
  const [type, setType] = useState<string>('');
  const [keys, setKeys] = useState<RedisKeyEntry[]>([]);
  const [cursor, setCursor] = useState('0');
  const [dbSize, setDbSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [reload, setReload] = useState(0);
  // Pages come back out of order if the pattern changes mid-scan; only the newest scan may write.
  const generation = useRef(0);

  const scanPage = useCallback(
    (from: string) =>
      window.steward.redis.scan({
        connectionId: connection.id,
        cursor: from,
        ...(pattern === '' ? {} : { pattern }),
        ...(type === '' ? {} : { type: type as (typeof KEY_TYPES)[number] })
      }),
    [connection.id, pattern, type]
  );

  const applyPage = useCallback(
    (result: Awaited<ReturnType<typeof scanPage>>, replace: boolean): void => {
      setLoading(false);
      setStarted(true);
      if (!result.success) {
        onError(result.error);
        return;
      }
      setKeys((current) => {
        if (replace) return result.data.keys;
        const seen = new Set(current.map((entry) => entry.key));
        return [...current, ...result.data.keys.filter((entry) => !seen.has(entry.key))];
      });
      setCursor(result.data.cursor);
      setDbSize(result.data.dbSize);
    },
    [onError]
  );

  useEffect(() => {
    // The list on screen stays until the first page of the new scan replaces it.
    const mine = ++generation.current;
    void scanPage('0').then((result) => {
      if (mine === generation.current) applyPage(result, true);
    });
  }, [scanPage, applyPage, reload, refreshToken]);

  async function loadMore(): Promise<void> {
    const mine = generation.current;
    setLoading(true);
    const result = await scanPage(cursor);
    if (mine === generation.current) applyPage(result, false);
  }

  const rows = useMemo<TreeRow[]>(() => {
    if (view === 'list') {
      return [...keys]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((entry) => ({ kind: 'key', id: entry.key, depth: 0, label: entry.key, entry }));
    }
    const result: TreeRow[] = [];
    flatten(buildTree(keys, delimiter), '', 0, delimiter, openFolders, result);
    return result;
  }, [keys, view, delimiter, openFolders]);

  const shown = rows.slice(0, ROW_LIMIT);
  const finished = cursor === '0' && started;

  function toggleFolder(id: string): void {
    setOpenFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="rdbrowser">
      <form
        className="rdbrowser__bar"
        onSubmit={(event) => {
          event.preventDefault();
          const next = patternInput.trim();
          if (next === pattern) setReload((value) => value + 1);
          else setPattern(next);
        }}
      >
        <label className="dksearch">
          <Icon name="search" size={14} />
          <input
            className="field__input"
            value={patternInput}
            onChange={(event) => setPatternInput(event.target.value)}
            placeholder="Pattern, e.g. session:*"
            aria-label="Key pattern"
            spellCheck={false}
          />
        </label>
        <select className="field__input rdbrowser__type" value={type} onChange={(event) => setType(event.target.value)} aria-label="Key type">
          <option value="">All types</option>
          {KEY_TYPES.map((value) => (
            <option key={value} value={value}>
              {typeLabel(value)}
            </option>
          ))}
        </select>
        <IconButton icon="refresh" label="Scan again" size={14} onClick={() => setReload((value) => value + 1)} />
      </form>

      <div className="rdbrowser__tools">
        <div className="segmented" role="group" aria-label="View">
          {(['tree', 'list'] as const).map((value) => (
            <button key={value} type="button" className={`segmented__option${view === value ? ' segmented__option--active' : ''}`} onClick={() => setView(value)}>
              {value === 'tree' ? 'Tree' : 'List'}
            </button>
          ))}
        </div>
        <span className="dpitem__spacer" />
        <IconButton icon="trash" label={writable ? (patternInput.trim() === '' ? 'Type a pattern to delete the keys that match it' : `Delete every key matching ${patternInput.trim()}`) : 'Read-only connection'} tone="danger" disabled={!writable || patternInput.trim() === ''} onClick={() => onDeletePattern(patternInput.trim())} />
        <Button variant="primary" size="sm" disabled={!writable} title={writable ? 'Create a key' : 'Read-only connection'} onClick={onNewKey}>
          <Icon name="plus" size={14} /> New key
        </Button>
      </div>

      <p
        className="card__hint rdbrowser__count"
        title={view === 'tree' ? 'Folder counts only include the keys loaded so far.' : undefined}
      >
        {started && dbSize === 0 && pattern === '' && type === ''
          ? 'This database is empty.'
          : `${formatCount(keys.length)}${dbSize === null ? '' : ` of ≈ ${formatCount(dbSize)}`} keys loaded${pattern !== '' || type !== '' ? ' · filtered' : ''}`}
      </p>

      <ul className="rdkeys" role="listbox" aria-label="Keys">
        {shown.map((row) =>
          row.kind === 'folder' ? (
            <li key={`f:${row.id}`}>
              <button type="button" className="rdkeys__row rdkeys__row--folder" style={{ paddingLeft: 8 + row.depth * 14 }} onClick={() => toggleFolder(row.id)}>
                <Icon name={openFolders.has(row.id) ? 'chevronDown' : 'chevronRight'} size={14} />
                <Icon name="folder" size={14} />
                <span className="rdkeys__name">{row.label}</span>
                <span className="card__hint">{formatCount(row.count ?? 0)}</span>
              </button>
            </li>
          ) : (
            <li key={`k:${row.id}`}>
              <button
                type="button"
                role="option"
                aria-selected={selectedKey === row.id}
                className={`rdkeys__row${selectedKey === row.id ? ' rdkeys__row--active' : ''}`}
                style={{ paddingLeft: 8 + row.depth * 14 }}
                onClick={() => onSelect(row.id)}
                title={row.entry?.key}
              >
                <Badge tone={typeTone(row.entry?.type ?? '')}>{typeLabel(row.entry?.type ?? '')}</Badge>
                <span className="rdkeys__name">{row.label}</span>
                {row.entry?.ttlMs !== null && row.entry?.ttlMs !== undefined && <span className="card__hint">{formatTtl(row.entry.ttlMs)}</span>}
              </button>
            </li>
          )
        )}
      </ul>

      {rows.length > ROW_LIMIT && (
        <p className="card__hint">Showing the first {formatCount(ROW_LIMIT)} rows. Narrow the pattern to see the rest.</p>
      )}
      {started && keys.length === 0 && !loading && (
        <p className="card__hint">{dbSize === 0 && pattern === '' && type === '' ? 'Create a key to see it here.' : 'No keys match.'}</p>
      )}

      <div className="rdbrowser__more">
        {loading ? (
          <span className="card__hint">Scanning…</span>
        ) : finished ? (
          keys.length > 0 && <span className="card__hint">Scan complete.</span>
        ) : (
          <Button size="sm" onClick={() => void loadMore()}>
            Load more
          </Button>
        )}
      </div>
    </div>
  );
}

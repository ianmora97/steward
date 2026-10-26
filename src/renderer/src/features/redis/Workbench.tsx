import { useEffect, useMemo, useRef, useState } from 'react';
import { tokenizeCommand } from '@shared/redis/tokenize';
import type { RedisConnection, RedisSavedCommand } from '@shared/schemas/redis';
import type { StewardError } from '@shared/types/result';
import { Icon } from '../../components/Icon';
import { useRedisStore } from '../../stores/redis.store';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { toast } from '../../stores/toast.store';

interface Entry {
  id: number;
  line: string;
  output: string;
  failed: boolean;
  elapsedMs: number | null;
}

interface PendingConfirmation {
  line: string;
  args: string[];
  message: string;
  details: string | undefined;
}

const NO_HISTORY: string[] = [];

export function Workbench({
  connection,
  onError
}: {
  connection: RedisConnection;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const history = useRedisStore((state) => state.history[connection.id]) ?? NO_HISTORY;
  const pushHistory = useRedisStore((state) => state.pushHistory);
  const [line, setLine] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);
  const [commands, setCommands] = useState<string[]>([]);
  const [saved, setSaved] = useState<RedisSavedCommand[]>([]);
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [typedName, setTypedName] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const counter = useRef(0);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void window.steward.redis.listCommands({ id: connection.id }).then((result) => {
      if (!cancelled && result.success) setCommands(result.data.names);
    });
    void window.steward.redis.listSavedCommands({ connectionId: connection.id }).then((result) => {
      if (!cancelled && result.success) setSaved(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [connection.id]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [entries]);

  const suggestions = useMemo(() => {
    const first = line.trimStart();
    if (first === '' || /\s/.test(first)) return [];
    const upper = first.toUpperCase();
    return commands.filter((name) => name.startsWith(upper)).slice(0, 8);
  }, [line, commands]);

  function append(entry: Omit<Entry, 'id'>): void {
    counter.current += 1;
    setEntries((current) => [...current.slice(-199), { ...entry, id: counter.current }]);
  }

  async function run(text: string, args: string[], confirmation?: { confirmName?: string }): Promise<void> {
    setBusy(true);
    const result = await window.steward.redis.execute({
      connectionId: connection.id,
      args,
      ...(confirmation === undefined ? {} : { confirmed: true, ...(confirmation.confirmName === undefined ? {} : { confirmName: confirmation.confirmName }) })
    });
    setBusy(false);
    if (result.success) {
      setPending(null);
      setTypedName('');
      append({ line: text, output: result.data.output, failed: result.data.output.startsWith('(error)'), elapsedMs: result.data.elapsedMs });
      return;
    }
    if (result.error.code === 'CONFIRMATION_REQUIRED' && confirmation === undefined) {
      setPending({ line: text, args, message: result.error.message, details: result.error.details });
      return;
    }
    if (result.error.code === 'CONFIRMATION_REQUIRED') {
      // Confirmed but still refused: the name typed was wrong. Keep the panel open.
      onError(result.error);
      return;
    }
    setPending(null);
    append({ line: text, output: `(error) ${result.error.message}${result.error.details === undefined ? '' : `\n${result.error.details}`}`, failed: true, elapsedMs: null });
  }

  function submit(): void {
    const text = line.trim();
    if (text === '' || busy) return;
    const tokens = tokenizeCommand(text);
    setLine('');
    setCursor(null);
    if (!tokens.ok) {
      append({ line: text, output: `(error) ${tokens.error}`, failed: true, elapsedMs: null });
      return;
    }
    if (tokens.args.length === 0) return;
    pushHistory(connection.id, text);
    void run(text, tokens.args);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'ArrowUp' && history.length > 0) {
      event.preventDefault();
      const next = cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
      setCursor(next);
      setLine(history[next] ?? '');
    } else if (event.key === 'ArrowDown' && cursor !== null) {
      event.preventDefault();
      const next = cursor + 1;
      if (next >= history.length) {
        setCursor(null);
        setLine('');
      } else {
        setCursor(next);
        setLine(history[next] ?? '');
      }
    } else if (event.key === 'Tab' && suggestions.length > 0) {
      event.preventDefault();
      setLine(`${suggestions[0] ?? ''} `);
    }
  }

  async function saveCurrent(name: string): Promise<void> {
    const text = line.trim() === '' ? (history[history.length - 1] ?? '') : line.trim();
    if (text === '') return;
    const result = await window.steward.redis.saveCommand({ connectionId: connection.id, name, commandText: text });
    if (result.success) {
      toast.success('Command saved');
      setSaved((current) => [...current, result.data].sort((a, b) => a.name.localeCompare(b.name)));
    } else onError(result.error);
    setSaving(null);
  }

  async function removeSaved(id: string): Promise<void> {
    const result = await window.steward.redis.deleteSavedCommand({ id });
    if (result.success) {
      toast.success('Saved command deleted');
      setSaved((current) => current.filter((candidate) => candidate.id !== id));
    } else onError(result.error);
  }

  return (
    <div className="rdwork">
      <div className="rdwork__main">
        <div className="rdwork__log dpmono" ref={log} aria-live="polite">
          {entries.length === 0 && (
            <p className="card__hint">
              Type a Redis command and press Enter. Up and down walk through earlier commands; Tab completes a command name. Commands that
              would stop the server or hold this connection are refused.
            </p>
          )}
          {entries.map((entry) => (
            <div key={entry.id} className="rdwork__entry">
              <div className="rdwork__cmd">
                <span className="rdwork__prompt">&gt;</span> {entry.line}
                {entry.elapsedMs !== null && <span className="card__hint"> · {entry.elapsedMs} ms</span>}
              </div>
              <pre className={`rdwork__out${entry.failed ? ' rdwork__out--error' : ''}`}>{entry.output}</pre>
            </div>
          ))}
        </div>

        {pending !== null && (
          <div className="rdwork__confirm" role="alertdialog">
            <p>
              <Icon name="alert" size={14} /> <strong>{pending.message}.</strong> {pending.details}
            </p>
            {connection.protectedEnvironment && (
              <label className="field">
                <span className="field__label">This connection is in a protected environment: type its name ({connection.name})</span>
                <input className="field__input" value={typedName} onChange={(event) => setTypedName(event.target.value)} spellCheck={false} />
              </label>
            )}
            <div className="rdwork__confirm-actions">
              <Button size="sm" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" disabled={busy || (connection.protectedEnvironment && typedName !== connection.name)} onClick={() => void run(pending.line, pending.args, connection.protectedEnvironment ? { confirmName: typedName } : {})}>
                Run <code>{pending.line}</code>
              </Button>
            </div>
          </div>
        )}

        <div className="rdwork__input">
          {suggestions.length > 0 && (
            <ul className="rdwork__suggest" role="listbox" aria-label="Commands">
              {suggestions.map((name) => (
                <li key={name}>
                  <button type="button" className="rdwork__suggestion dpmono" onClick={() => setLine(`${name} `)}>
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <span className="rdwork__prompt dpmono">&gt;</span>
          <input
            className="field__input dpmono"
            value={line}
            onChange={(event) => {
              setLine(event.target.value);
              setCursor(null);
            }}
            onKeyDown={onKeyDown}
            placeholder={connection.readOnly ? 'Read-only connection: commands that write are refused' : 'GET key'}
            aria-label="Redis command"
            spellCheck={false}
            autoFocus
            autoComplete="off"
          />
          <Button variant="primary" disabled={busy || line.trim() === ''} onClick={submit}>
            Run
          </Button>
          <Button disabled={line.trim() === '' && history.length === 0} onClick={() => setSaving('')} title="Save this command">
            <Icon name="save" size={14} /> Save
          </Button>
          <Button disabled={entries.length === 0} onClick={() => setEntries([])}>
            Clear
          </Button>
        </div>
        {saving !== null && (
          <form
            className="rdwork__save"
            onSubmit={(event) => {
              event.preventDefault();
              if (saving.trim() !== '') void saveCurrent(saving.trim());
            }}
          >
            <input className="field__input" value={saving} onChange={(event) => setSaving(event.target.value)} placeholder="Name for this command" autoFocus />
            <Button variant="primary" size="sm" disabled={saving.trim() === ''} type="submit">
              Save
            </Button>
            <Button size="sm" onClick={() => setSaving(null)}>
              Cancel
            </Button>
          </form>
        )}
      </div>

      <aside className="rdwork__side">
        <h4 className="rdwork__side-title">Saved commands</h4>
        {saved.length === 0 && <p className="card__hint">Nothing saved yet.</p>}
        <ul className="rdwork__saved">
          {saved.map((command) => (
            <li key={command.id}>
              <button type="button" className="rdwork__saved-load" onClick={() => setLine(command.commandText)} title={command.commandText}>
                <span>{command.name}</span>
                <span className="card__hint dpmono">{command.commandText}</span>
              </button>
              <IconButton icon="trash" label="Delete" size={14} onClick={() => void removeSaved(command.id)} />
            </li>
          ))}
        </ul>
        <h4 className="rdwork__side-title">History</h4>
        <p className="card__hint">Kept only while this tab is open.</p>
        <ul className="rdwork__saved">
          {[...history].reverse().slice(0, 30).map((item, index) => (
            <li key={`${index}:${item}`}>
              <button type="button" className="rdwork__saved-load" onClick={() => setLine(item)} title={item}>
                <span className="dpmono">{item}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

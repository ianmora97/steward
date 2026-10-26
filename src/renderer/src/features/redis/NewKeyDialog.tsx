import { useState } from 'react';
import { encodeTextBase64 } from '@shared/redis/value-format';
import type { RedisConnection, RedisWriteOp } from '@shared/schemas/redis';
import type { StewardError } from '@shared/types/result';
import { Modal } from '../../components/Modal';
import { ExpiryField, secondsUntil } from './ExpiryField';
import { typeLabel } from './redis-meta';

type NewType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'json';

const LABELS: Record<NewType, string> = {
  string: typeLabel('string'),
  hash: typeLabel('hash'),
  list: typeLabel('list'),
  set: typeLabel('set'),
  zset: typeLabel('zset'),
  stream: typeLabel('stream'),
  json: 'JSON (RedisJSON)'
};

function streamFields(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .flatMap((line) => {
      const space = line.search(/\s/);
      return space < 0 ? [line, ''] : [line.slice(0, space), line.slice(space).trim()];
    })
    .map(encodeTextBase64);
}

/** The first element of a new key; Redis creates the key with it, so there is no empty key to make. */
export function NewKeyDialog({
  connection,
  hasJson,
  onCreated,
  onCancel
}: {
  connection: RedisConnection;
  hasJson: boolean;
  onCreated: (key: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [type, setType] = useState<NewType>('string');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [field, setField] = useState('');
  const [score, setScore] = useState('0');
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<StewardError | null>(null);

  function build(): RedisWriteOp | string {
    switch (type) {
      case 'string':
        return { kind: 'string.set', value: encodeTextBase64(value) };
      case 'hash':
        return field === '' ? 'A hash needs a field name.' : { kind: 'hash.set', field: encodeTextBase64(field), value: encodeTextBase64(value) };
      case 'list':
        return { kind: 'list.push', side: 'right', value: encodeTextBase64(value) };
      case 'set':
        return { kind: 'set.add', member: encodeTextBase64(value) };
      case 'zset':
        return !Number.isFinite(Number(score)) ? 'The score must be a number.' : { kind: 'zset.add', member: encodeTextBase64(value), score: Number(score) };
      case 'stream': {
        const fields = streamFields(value);
        return fields.length < 2 ? 'Add at least one "field value" line.' : { kind: 'stream.add', fields };
      }
      case 'json':
        return { kind: 'json.set', value };
    }
  }

  async function create(): Promise<void> {
    const trimmed = key.trim();
    const op = build();
    if (typeof op === 'string') {
      setProblem({ code: 'VALIDATION_FAILED', message: op });
      return;
    }
    if (expiresAt !== null && expiresAt.getTime() <= Date.now()) {
      setProblem({ code: 'VALIDATION_FAILED', message: 'Pick an expiry in the future, or clear it.' });
      return;
    }
    setBusy(true);
    setProblem(null);
    // Writing to a key that exists would quietly change it; a "new" key must not already be there.
    const existing = await window.steward.redis.getKey({ connectionId: connection.id, key: trimmed, count: 1 });
    if (existing.success) {
      setBusy(false);
      setProblem({ code: 'CONFLICT', message: 'A key with that name already exists.', details: 'Open it from the list to change it.' });
      return;
    }
    if (existing.error.code !== 'NOT_FOUND') {
      setBusy(false);
      setProblem(existing.error);
      return;
    }
    const written = await window.steward.redis.writeKey({ connectionId: connection.id, key: trimmed, op });
    if (!written.success) {
      setBusy(false);
      setProblem(written.error);
      return;
    }
    if (expiresAt !== null) {
      const expiry = await window.steward.redis.writeKey({ connectionId: connection.id, key: trimmed, op: { kind: 'ttl.set', seconds: secondsUntil(expiresAt) } });
      if (!expiry.success) {
        setBusy(false);
        setProblem(expiry.error);
        return;
      }
    }
    setBusy(false);
    onCreated(trimmed);
  }

  const valueLabel = type === 'stream' ? 'Fields' : type === 'json' ? 'JSON' : type === 'set' || type === 'zset' ? 'Member' : 'Value';

  return (
    <Modal title="New key" onClose={onCancel} className="rdedit">
      <form
        className="mgconn__body"
        onSubmit={(event) => {
          event.preventDefault();
          if (key.trim() !== '' && !busy) void create();
        }}
      >
        <div className="dprow">
          <label className="field">
            <span className="field__label">Key name</span>
            <input className="field__input dpmono" value={key} onChange={(event) => setKey(event.target.value)} placeholder="session:42" autoFocus spellCheck={false} />
          </label>
          <label className="field">
            <span className="field__label">Type</span>
            <select className="field__input" value={type} onChange={(event) => setType(event.target.value as NewType)}>
              {(Object.keys(LABELS) as NewType[])
                .filter((value) => value !== 'json' || hasJson)
                .map((value) => (
                  <option key={value} value={value}>
                    {LABELS[value]}
                  </option>
                ))}
            </select>
          </label>
        </div>

        {type === 'hash' && (
          <label className="field">
            <span className="field__label">Field</span>
            <input className="field__input dpmono" value={field} onChange={(event) => setField(event.target.value)} spellCheck={false} />
          </label>
        )}
        <label className="field">
          <span className="field__label">{valueLabel}</span>
          <textarea
            className="field__input dpmono rdedit__text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            rows={type === 'stream' || type === 'json' || type === 'string' ? 8 : 3}
            spellCheck={false}
            placeholder={type === 'stream' ? 'name Ada\nrole admin' : ''}
          />
          {type === 'stream' && <span className="card__hint">One "field value" pair per line; the first space separates them.</span>}
        </label>
        {type === 'zset' && (
          <label className="field">
            <span className="field__label">Score</span>
            <input className="field__input dpmono" value={score} onChange={(event) => setScore(event.target.value)} inputMode="decimal" />
          </label>
        )}
        <div className="field">
          <span className="field__label">Expires on (optional)</span>
          <ExpiryField value={expiresAt} onChange={setExpiresAt} />
        </div>

        {problem !== null && (
          <div className="banner banner--error" role="alert">
            <span className="banner__message">{problem.message}</span>
            {problem.details !== undefined && <span className="banner__details">{problem.details}</span>}
          </div>
        )}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="button button--primary" disabled={busy || key.trim() === ''}>
            {busy ? 'Creating…' : 'Create key'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

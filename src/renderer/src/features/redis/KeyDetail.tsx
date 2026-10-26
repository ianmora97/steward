import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeBase64, decodeUtf8, encodeTextBase64, previewValue } from '@shared/redis/value-format';
import type {
  RedisConnection,
  RedisKeyMeta,
  RedisStreamInfo,
  RedisValuePage,
  RedisWriteOp
} from '@shared/schemas/redis';
import type { StewardError, StewardResult } from '@shared/types/result';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/Badge';
import { EditDialog, type FieldSpec } from './EditDialog';
import { secondsUntil } from './ExpiryField';
import { formatBytes, formatCount, formatDuration, formatTtl, typeLabel, typeTone } from './redis-meta';
import { ValueView } from './ValueView';
import { IconButton } from '../../components/IconButton';
import { Button } from '../../components/Button';
import { toast } from '../../stores/toast.store';
import { Loading } from '../../components/Loading';

/** What is open over the key: a form for one change, a confirmation, or a value shown in full. */
type Dialog =
  | {
      kind: 'edit';
      title: string;
      fields: FieldSpec[];
      submitLabel?: string;
      extra?: React.ReactNode;
      build: (values: Record<string, string>) => RedisWriteOp;
      /** The change moves or removes the key (or its expiry), so the list beside it has to be read again. */
      reshapes?: boolean;
    }
  | { kind: 'rename' }
  | { kind: 'delete' }
  | { kind: 'view'; title: string; encoded: string };

function textOf(encoded: string): string | null {
  return decodeUtf8(decodeBase64(encoded));
}

function merge(previous: RedisValuePage, next: RedisValuePage): RedisValuePage {
  if (previous.type === 'hash' && next.type === 'hash') return { ...next, entries: [...previous.entries, ...next.entries] };
  if (previous.type === 'list' && next.type === 'list') return { ...next, offset: previous.offset, items: [...previous.items, ...next.items] };
  if (previous.type === 'set' && next.type === 'set') {
    const seen = new Set(previous.members);
    return { ...next, members: [...previous.members, ...next.members.filter((member) => !seen.has(member))] };
  }
  if (previous.type === 'zset' && next.type === 'zset') return { ...next, offset: previous.offset, members: [...previous.members, ...next.members] };
  if (previous.type === 'stream' && next.type === 'stream') return { ...next, entries: [...previous.entries, ...next.entries] };
  return next;
}

function Cell({ encoded, onOpen }: { encoded: string; onOpen: () => void }): React.JSX.Element {
  return (
    <button type="button" className="rdcell dpmono" onClick={onOpen} title="Open the full value">
      {previewValue(encoded)}
    </button>
  );
}

function RowActions({ editable, onEdit, onDelete }: { editable: boolean; onEdit?: () => void; onDelete: () => void }): React.JSX.Element {
  return (
    <span className="rdrow__actions">
      {onEdit !== undefined && (
        <IconButton icon="edit" label={editable ? 'Edit' : 'Read-only, or not text'} disabled={!editable} size={14} onClick={onEdit} />
      )}
      <IconButton icon="trash" label="Remove" disabled={!editable && onEdit === undefined} size={14} onClick={onDelete} />
    </span>
  );
}

export function KeyDetail({
  connection,
  keyName,
  writable,
  hasJson,
  onChanged,
  onRenamed,
  onGone,
  onError
}: {
  connection: RedisConnection;
  keyName: string;
  writable: boolean;
  /** The server has RedisJSON, so a JSON key can be edited. */
  hasJson: boolean;
  /** The key's name, expiry or existence changed: the list should be read again. */
  onChanged: () => void;
  onRenamed: (newKey: string) => void;
  onGone: () => void;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const [meta, setMeta] = useState<RedisKeyMeta | null>(null);
  const [page, setPage] = useState<RedisValuePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [memory, setMemory] = useState<number | null | undefined>(undefined);
  const [stream, setStream] = useState<RedisStreamInfo | null>(null);
  const renamedTo = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.steward.redis.getKey({ connectionId: connection.id, key: keyName }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.success) {
        setMeta(result.data.meta);
        setPage(result.data.page);
      } else if (result.error.code === 'NOT_FOUND') {
        onGone();
      } else {
        onError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connection.id, keyName, version, onError, onGone]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  async function loadMore(): Promise<void> {
    if (page === null || !('next' in page) || page.next === null) return;
    setLoadingMore(true);
    const result = await window.steward.redis.getKey({ connectionId: connection.id, key: keyName, cursor: page.next });
    setLoadingMore(false);
    if (result.success) setPage((current) => (current === null ? result.data.page : merge(current, result.data.page)));
    else onError(result.error);
  }

  function write(op: RedisWriteOp): Promise<StewardResult<unknown>> {
    return window.steward.redis.writeKey({ connectionId: connection.id, key: keyName, op }).then((result) => {
      if (result.success) toast.success('Key updated');
      return result;
    });
  }

  function edit(spec: Omit<Extract<Dialog, { kind: 'edit' }>, 'kind'>): void {
    setDialog({ kind: 'edit', ...spec });
  }

  async function measure(): Promise<void> {
    const result = await window.steward.redis.keyMemory({ connectionId: connection.id, key: keyName });
    if (result.success) setMemory(result.data.bytes);
    else onError(result.error);
  }

  async function loadStream(): Promise<void> {
    const result = await window.steward.redis.streamInfo({ connectionId: connection.id, key: keyName });
    if (result.success) setStream(result.data);
    else onError(result.error);
  }

  const view = (title: string, encoded: string): void => setDialog({ kind: 'view', title, encoded });

  // ── per-type changes ────────────────────────────────────────────────────

  const editString = (current: string): void =>
    edit({
      title: 'Edit string',
      fields: [{ id: 'value', label: 'Value', initial: current, multiline: true, hint: 'The expiry is kept.' }],
      build: (values) => ({ kind: 'string.set', value: encodeTextBase64(values['value'] ?? ''), keepTtl: true })
    });

  const hashField = (field: string | null, value: string): void =>
    edit({
      title: field === null ? 'Add a field' : 'Edit field',
      fields: [
        { id: 'field', label: 'Field', initial: field ?? '', readOnly: field !== null },
        { id: 'value', label: 'Value', initial: value, multiline: true }
      ],
      build: (values) => ({ kind: 'hash.set', field: encodeTextBase64(values['field'] ?? ''), value: encodeTextBase64(values['value'] ?? '') })
    });

  const listSet = (index: number, value: string): void =>
    edit({
      title: `Edit item ${index}`,
      fields: [{ id: 'value', label: 'Value', initial: value, multiline: true }],
      build: (values) => ({ kind: 'list.set', index, value: encodeTextBase64(values['value'] ?? '') })
    });

  const listPush = (side: 'left' | 'right'): void =>
    edit({
      title: side === 'left' ? 'Push to the head' : 'Push to the tail',
      fields: [{ id: 'value', label: 'Value', multiline: true }],
      submitLabel: 'Push',
      build: (values) => ({ kind: 'list.push', side, value: encodeTextBase64(values['value'] ?? '') })
    });

  const setAdd = (): void =>
    edit({
      title: 'Add a member',
      fields: [{ id: 'member', label: 'Member', multiline: true }],
      submitLabel: 'Add',
      build: (values) => ({ kind: 'set.add', member: encodeTextBase64(values['member'] ?? '') })
    });

  const zsetEdit = (member: string | null, score: number | null): void =>
    edit({
      title: member === null ? 'Add a member' : 'Edit score',
      fields: [
        { id: 'member', label: 'Member', initial: member ?? '', readOnly: member !== null },
        { id: 'score', label: 'Score', initial: score === null ? '' : String(score), numeric: true, hint: 'A number; inf and -inf are not accepted here.' }
      ],
      build: (values) => ({ kind: 'zset.add', member: encodeTextBase64(values['member'] ?? ''), score: Number(values['score'] ?? '0') })
    });

  const streamAdd = (): void =>
    edit({
      title: 'Add an entry',
      fields: [
        { id: 'id', label: 'ID (leave empty for automatic)', placeholder: '*' },
        { id: 'fields', label: 'Fields', multiline: true, hint: 'One "field value" pair per line; the first space separates them.' }
      ],
      submitLabel: 'Add',
      build: (values) => {
        const pairs = (values['fields'] ?? '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== '')
          .flatMap((line) => {
            const space = line.search(/\s/);
            return space < 0 ? [line, ''] : [line.slice(0, space), line.slice(space).trim()];
          })
          .map(encodeTextBase64);
        const id = (values['id'] ?? '').trim();
        return { kind: 'stream.add', ...(id === '' ? {} : { id }), fields: pairs };
      }
    });

  const jsonEdit = (current: string): void =>
    edit({
      title: 'Edit JSON',
      fields: [{ id: 'value', label: 'JSON', initial: current, multiline: true }],
      build: (values) => ({ kind: 'json.set', value: values['value'] ?? '' })
    });

  const ttlEdit = (): void =>
    edit({
      title: 'Set the expiry',
      fields: [
        {
          id: 'expiresAt',
          kind: 'expiry',
          label: 'Expires on',
          initial: meta === null || meta.ttlMs === null ? '' : new Date(Date.now() + meta.ttlMs).toISOString()
        }
      ],
      submitLabel: 'Set expiry',
      reshapes: true,
      build: (values) => {
        const picked = values['expiresAt'] ?? '';
        // Clearing the date is how "never expires" is asked for.
        if (picked === '') return { kind: 'ttl.persist' };
        const date = new Date(picked);
        if (date.getTime() <= Date.now()) throw new Error('Pick a moment in the future.');
        return { kind: 'ttl.set', seconds: secondsUntil(date) };
      }
    });

  async function persist(): Promise<void> {
    const result = await write({ kind: 'ttl.persist' });
    if (result.success) {
      reload();
      onChanged();
    } else onError(result.error);
  }

  async function removeItem(op: RedisWriteOp): Promise<void> {
    const result = await write(op);
    if (result.success) reload();
    else onError(result.error);
  }

  // ── rendering ───────────────────────────────────────────────────────────

  function body(current: RedisValuePage): React.JSX.Element {
    switch (current.type) {
      case 'string': {
        const text = textOf(current.value);
        const editable = writable && !current.truncated && text !== null;
        return (
          <>
            <div className="rdbody__tools">
              <Button size="sm" disabled={!editable} title={editable ? undefined : current.truncated ? 'Too large to edit here' : text === null ? 'Binary value' : 'Read-only connection'} onClick={() => editString(text ?? '')}>
                <Icon name="edit" size={14} /> Edit
              </Button>
              <span className="card__hint">{formatBytes(current.length)}</span>
            </div>
            <ValueView encoded={current.value} {...(current.truncated ? { notice: `Showing the first ${formatBytes(current.value.length)} of ${formatBytes(current.length)}` } : {})} />
          </>
        );
      }
      case 'hash':
        return (
          <>
            <div className="rdbody__tools">
              <Button size="sm" disabled={!writable} onClick={() => hashField(null, '')}>
                <Icon name="plus" size={14} /> Add field
              </Button>
              <span className="card__hint">{formatCount(current.entries.length)} of {formatCount(current.total)} fields</span>
            </div>
            <table className="rdtable">
              <thead><tr><th>Field</th><th>Value</th><th /></tr></thead>
              <tbody>
                {current.entries.map((entry) => {
                  const field = textOf(entry.field);
                  const value = textOf(entry.value);
                  return (
                    <tr key={entry.field}>
                      <td><Cell encoded={entry.field} onOpen={() => view('Field', entry.field)} /></td>
                      <td><Cell encoded={entry.value} onOpen={() => view('Value', entry.value)} /></td>
                      <td>
                        {writable && (
                          <RowActions
                            editable={field !== null && value !== null}
                            onEdit={() => hashField(field, value ?? '')}
                            onDelete={() => void removeItem({ kind: 'hash.del', field: entry.field })}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        );
      case 'list':
        return (
          <>
            <div className="rdbody__tools">
              <Button size="sm" disabled={!writable} onClick={() => listPush('left')}>
                <Icon name="plus" size={14} /> Push to head
              </Button>
              <Button size="sm" disabled={!writable} onClick={() => listPush('right')}>
                <Icon name="plus" size={14} /> Push to tail
              </Button>
              <span className="card__hint">{formatCount(current.items.length)} of {formatCount(current.total)} items</span>
            </div>
            <table className="rdtable">
              <thead><tr><th>Index</th><th>Value</th><th /></tr></thead>
              <tbody>
                {current.items.map((item, position) => {
                  const text = textOf(item);
                  const index = current.offset + position;
                  return (
                    <tr key={index}>
                      <td className="dpmono">{index}</td>
                      <td><Cell encoded={item} onOpen={() => view(`Item ${index}`, item)} /></td>
                      <td>
                        {writable && (
                          <RowActions
                            editable={text !== null}
                            onEdit={() => listSet(index, text ?? '')}
                            onDelete={() => void removeItem({ kind: 'list.remove', value: item, count: 1 })}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="card__hint">Removing an item removes the first element with that value, which is the only way a list allows it.</p>
          </>
        );
      case 'set':
        return (
          <>
            <div className="rdbody__tools">
              <Button size="sm" disabled={!writable} onClick={setAdd}>
                <Icon name="plus" size={14} /> Add member
              </Button>
              <span className="card__hint">{formatCount(current.members.length)} of {formatCount(current.total)} members</span>
            </div>
            <table className="rdtable">
              <thead><tr><th>Member</th><th /></tr></thead>
              <tbody>
                {current.members.map((member) => (
                  <tr key={member}>
                    <td><Cell encoded={member} onOpen={() => view('Member', member)} /></td>
                    <td>{writable && <RowActions editable onDelete={() => void removeItem({ kind: 'set.remove', member })} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        );
      case 'zset':
        return (
          <>
            <div className="rdbody__tools">
              <Button size="sm" disabled={!writable} onClick={() => zsetEdit(null, null)}>
                <Icon name="plus" size={14} /> Add member
              </Button>
              <span className="card__hint">{formatCount(current.members.length)} of {formatCount(current.total)} members, lowest score first</span>
            </div>
            <table className="rdtable">
              <thead><tr><th>Score</th><th>Member</th><th /></tr></thead>
              <tbody>
                {current.members.map((entry) => {
                  const text = textOf(entry.member);
                  return (
                    <tr key={entry.member}>
                      <td className="dpmono">{entry.score}</td>
                      <td><Cell encoded={entry.member} onOpen={() => view('Member', entry.member)} /></td>
                      <td>
                        {writable && (
                          <RowActions
                            editable={text !== null}
                            onEdit={() => zsetEdit(text, entry.score)}
                            onDelete={() => void removeItem({ kind: 'zset.remove', member: entry.member })}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        );
      case 'stream':
        return (
          <>
            <div className="rdbody__tools">
              <Button size="sm" disabled={!writable} onClick={streamAdd}>
                <Icon name="plus" size={14} /> Add entry
              </Button>
              <Button size="sm" onClick={() => void loadStream()}>
                Groups and consumers
              </Button>
              <span className="card__hint">{formatCount(current.entries.length)} of {formatCount(current.total)} entries, newest first</span>
            </div>
            {stream !== null && (
              <div className="rdstream">
                <p className="card__hint">Last generated ID {stream.lastGeneratedId} · {stream.groups.length} group{stream.groups.length === 1 ? '' : 's'}</p>
                {stream.groups.length > 0 && (
                  <table className="rdtable">
                    <thead><tr><th>Group</th><th>Consumers</th><th>Pending</th><th>Last delivered</th></tr></thead>
                    <tbody>
                      {stream.groups.map((group) => (
                        <tr key={group.name}>
                          <td className="dpmono">{group.name}</td>
                          <td>
                            {group.consumers}
                            {group.members.length > 0 && (
                              <span className="card__hint"> · {group.members.map((member) => `${member.name} (${member.pending} pending, idle ${formatDuration(Math.round(member.idleMs / 1000))})`).join(', ')}</span>
                            )}
                          </td>
                          <td>{group.pending}</td>
                          <td className="dpmono">{group.lastDeliveredId}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            <table className="rdtable">
              <thead><tr><th>ID</th><th>Fields</th><th /></tr></thead>
              <tbody>
                {current.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="dpmono">{entry.id}</td>
                    <td>
                      {entry.fields.reduce<React.ReactNode[]>((cells, field, index) => {
                        if (index % 2 === 0) {
                          const valueField = entry.fields[index + 1];
                          cells.push(
                            <span key={index} className="rdpair">
                              <span className="rdpair__name dpmono">{previewValue(field, 60)}</span>
                              <Cell encoded={valueField ?? ''} onOpen={() => view(previewValue(field, 60), valueField ?? '')} />
                            </span>
                          );
                        }
                        return cells;
                      }, [])}
                    </td>
                    <td>{writable && <RowActions editable onDelete={() => void removeItem({ kind: 'stream.del', id: entry.id })} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        );
      case 'json':
        return (
          <>
            <div className="rdbody__tools">
              <Button size="sm" disabled={!writable || !hasJson || current.truncated} title={!hasJson ? 'RedisJSON is not loaded on this server' : current.truncated ? 'Too large to edit here' : undefined} onClick={() => jsonEdit(current.value)}>
                <Icon name="edit" size={14} /> Edit
              </Button>
            </div>
            <ValueView encoded={encodeTextBase64(current.value)} {...(current.truncated ? { notice: 'Truncated at 1 MB' } : {})} />
          </>
        );
      case 'unsupported':
        return <p className="card__hint">Steward cannot show keys of type "{current.name}" yet. The Workbench can still read and change it.</p>;
    }
  }

  if (loading && meta === null) return <Loading variant="line" lines={6} label="Reading the key…" />;
  if (meta === null || page === null) return <p className="card__hint">That key could not be read.</p>;

  const next = 'next' in page ? page.next : null;

  return (
    <div className="rddetail">
      <header className="rddetail__head">
        <div className="rddetail__title">
          <Badge tone={typeTone(meta.type)}>{typeLabel(meta.type)}</Badge>
          <h3 className="rddetail__name dpmono" title={meta.key}>{meta.key}</h3>
          <IconButton icon="file" label="Copy the key name" size={14} onClick={() => void navigator.clipboard.writeText(meta.key)} />
        </div>
        <div className="rddetail__meta">
          <span title="Time to live">
            <Icon name="clock" size={14} /> {formatTtl(meta.ttlMs)}
          </span>
          {writable && (
            <>
              <Button size="sm" onClick={ttlEdit}>Set expiry</Button>
              {meta.ttlMs !== null && <Button size="sm" onClick={() => void persist()}>Persist</Button>}
            </>
          )}
          {meta.encoding !== null && <span className="card__hint">encoding {meta.encoding}</span>}
          {memory === undefined ? (
            <Button size="sm" onClick={() => void measure()} title="MEMORY USAGE can be slow on a huge key, so it runs only when asked">
              Measure memory
            </Button>
          ) : (
            <span className="card__hint">{memory === null ? 'memory unknown' : formatBytes(memory)}</span>
          )}
          <span className="dpitem__spacer" />
          <IconButton icon="refresh" label="Read the key again" size={14} onClick={reload} />
          {writable && (
            <>
              <Button size="sm" onClick={() => setDialog({ kind: 'rename' })}>Rename</Button>
              <Button size="sm" dangerText onClick={() => setDialog({ kind: 'delete' })}>
                <Icon name="trash" size={14} /> Delete
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="rddetail__body">
        {body(page)}
        {next !== null && (
          <div className="rdbrowser__more">
            <Button size="sm" loading={loadingMore} loadingLabel="Loading…" onClick={() => void loadMore()}>Load more</Button>
          </div>
        )}
      </div>

      {dialog?.kind === 'edit' && (
        <EditDialog
          title={dialog.title}
          fields={dialog.fields}
          {...(dialog.submitLabel === undefined ? {} : { submitLabel: dialog.submitLabel })}
          {...(dialog.extra === undefined ? {} : { extra: dialog.extra })}
          onSubmit={(values) => {
            try {
              return write(dialog.build(values));
            } catch (problem) {
              // A form that cannot be turned into a change (a date in the past) is reported inside the dialog.
              return Promise.resolve({
                success: false as const,
                error: { code: 'VALIDATION_FAILED' as const, message: problem instanceof Error ? problem.message : 'That value is not valid.' }
              });
            }
          }}
          onDone={() => {
            const reshapes = dialog.reshapes === true;
            setDialog(null);
            reload();
            if (reshapes) onChanged();
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'rename' && (
        <EditDialog
          title="Rename the key"
          fields={[{ id: 'newKey', label: 'New name', initial: meta.key }]}
          submitLabel="Rename"
          onSubmit={async (values) => {
            const newKey = (values['newKey'] ?? '').trim();
            if (newKey === '' || newKey === meta.key) return { success: false, error: { code: 'VALIDATION_FAILED', message: 'Enter a different name.' } };
            const result = await write({ kind: 'rename', newKey });
            if (result.success) renamedTo.current = newKey;
            return result;
          }}
          onDone={() => {
            // The key now lives under its new name; the page follows it.
            setDialog(null);
            onChanged();
            if (renamedTo.current !== null) onRenamed(renamedTo.current);
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete ${meta.key}?`}
          confirmLabel="Delete key"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            void window.steward.redis.deleteKey({ connectionId: connection.id, key: meta.key, confirmed: true }).then((result) => {
              if (result.success) {
                toast.success('Key deleted');
                onChanged();
                onGone();
              } else onError(result.error);
            });
          }}
        >
          <p>The key and everything in it are deleted from the server. This cannot be undone.</p>
        </ConfirmDialog>
      )}

      {dialog?.kind === 'view' && dialog.encoded !== '' && (
        <Modal title={dialog.title} onClose={() => setDialog(null)} className="rdedit">
          <div className="mgconn__body">
            <ValueView encoded={dialog.encoded} />
          </div>
        </Modal>
      )}
    </div>
  );
}

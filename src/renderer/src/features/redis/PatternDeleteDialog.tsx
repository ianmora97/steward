import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import type { RedisConnection, RedisCountResult } from '@shared/schemas/redis';
import type { StewardError } from '@shared/types/result';
import { useExitAnimation } from '../../components/useExitAnimation';
import { formatCount } from './redis-meta';
import { Button } from '../../components/Button';
import { toast } from '../../stores/toast.store';

/**
 * Deleting by pattern shows how many keys match first, and deletes only if that number is still true when
 * confirmed. The pattern `*` (or any pattern, on a protected connection) also asks for the connection's name.
 */
export function PatternDeleteDialog({
  connection,
  pattern,
  onDone,
  onCancel
}: {
  connection: RedisConnection;
  pattern: string;
  onDone: (deleted: number) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [count, setCount] = useState<RedisCountResult | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<StewardError | null>(null);
  const { closing, requestClose } = useExitAnimation();

  const needsName = pattern === '*' || connection.protectedEnvironment;

  useEffect(() => {
    let cancelled = false;
    void window.steward.redis.countPattern({ connectionId: connection.id, pattern }).then((result) => {
      if (cancelled) return;
      if (result.success) setCount(result.data);
      else setProblem(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [connection.id, pattern]);

  async function confirm(): Promise<void> {
    if (count === null) return;
    setBusy(true);
    setProblem(null);
    const result = await window.steward.redis.deletePattern({
      connectionId: connection.id,
      pattern,
      expectedCount: count.count,
      confirmed: true,
      ...(needsName ? { confirmName: typed } : {})
    });
    setBusy(false);
    if (result.success) {
      toast.success(`${formatCount(result.data.deleted)} keys deleted`);
      onDone(result.data.deleted);
    }
    else setProblem(result.error);
  }

  const ready = count !== null && count.count > 0 && (!needsName || typed === connection.name);

  return createPortal(
    <div className={`dialog__backdrop${closing ? ' is-closing' : ''}`} onClick={() => requestClose(onCancel)}>
      <div className="dialog" role="alertdialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h3 className="dialog__title">Delete keys matching {pattern}?</h3>
        <div className="dialog__body">
          {count === null && problem === null && <p>Counting the matching keys…</p>}
          {count !== null && (
            <p>
              <strong>
                {count.atLeast ? 'At least ' : ''}
                {formatCount(count.count)}
              </strong>{' '}
              key{count.count === 1 ? '' : 's'} match. They are deleted from the server and this cannot be undone.
              {count.atLeast ? ' The count stopped at its limit; every match is deleted all the same.' : ''}
            </p>
          )}
          {needsName && count !== null && count.count > 0 && (
            <label className="field">
              <span className="field__label">Type the connection's name to confirm ({connection.name})</span>
              <input className="field__input" value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus spellCheck={false} />
            </label>
          )}
          {problem !== null && (
            <p className="dprequired">
              {problem.message}
              {problem.details !== undefined ? ` ${problem.details}` : ''}
            </p>
          )}
        </div>
        <div className="dialog__actions">
          <Button onClick={() => requestClose(onCancel)}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} loadingLabel="Deleting…" disabled={!ready || busy} onClick={() => void confirm()}>Delete keys</Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

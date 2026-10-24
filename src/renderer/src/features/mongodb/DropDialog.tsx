import { useState } from 'react';
import type { StewardError, StewardResult } from '@shared/types/result';
import { useExitAnimation } from '../../components/useExitAnimation';

/**
 * Dropping a collection or a database cannot be undone, so the exact name has to be typed; on a connection in a
 * protected environment the connection's own name too. Main checks both again.
 */
export function DropDialog({
  title,
  what,
  name,
  protectedConnection,
  connectionName,
  onConfirm,
  onDone,
  onCancel
}: {
  title: string;
  what: string;
  name: string;
  protectedConnection: boolean;
  connectionName: string;
  onConfirm: (confirmName: string, confirmConnection: string | undefined) => Promise<StewardResult<unknown>>;
  onDone: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [typedName, setTypedName] = useState('');
  const [typedConnection, setTypedConnection] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<StewardError | null>(null);
  const { closing, requestClose } = useExitAnimation();

  const ready = typedName === name && (!protectedConnection || typedConnection === connectionName);

  async function confirm(): Promise<void> {
    setBusy(true);
    setProblem(null);
    const result = await onConfirm(typedName, protectedConnection ? typedConnection : undefined);
    setBusy(false);
    if (result.success) onDone();
    else setProblem(result.error);
  }

  return (
    <div className={`dialog__backdrop${closing ? ' is-closing' : ''}`} onClick={() => requestClose(onCancel)}>
      <div className="dialog" role="alertdialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h3 className="dialog__title">{title}</h3>
        <div className="dialog__body">
          <p>
            {what} <strong>{name}</strong> and everything in it will be deleted. This cannot be undone.
          </p>
          <label className="field">
            <span className="field__label">Type the name to confirm</span>
            <input className="field__input" value={typedName} onChange={(event) => setTypedName(event.target.value)} autoFocus spellCheck={false} />
          </label>
          {protectedConnection && (
            <label className="field">
              <span className="field__label">
                This connection is in a protected environment: also type its name ({connectionName})
              </span>
              <input className="field__input" value={typedConnection} onChange={(event) => setTypedConnection(event.target.value)} spellCheck={false} />
            </label>
          )}
          {problem !== null && <p className="dprequired">{problem.message}</p>}
        </div>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={() => requestClose(onCancel)}>
            Cancel
          </button>
          <button type="button" className="button button--danger" disabled={!ready || busy} onClick={() => void confirm()}>
            {busy ? 'Dropping…' : 'Drop'}
          </button>
        </div>
      </div>
    </div>
  );
}

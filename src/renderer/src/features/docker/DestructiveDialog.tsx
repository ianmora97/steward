import { createPortal } from 'react-dom';
import { useState } from 'react';
import type { StewardError, StewardResult } from '@shared/types/result';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useExitAnimation } from '../../components/useExitAnimation';
import { Button } from '../../components/Button';
import { toast } from '../../stores/toast.store';

export interface DestructiveRequest {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  /** "container", "image", "volume"… used in the typed-name step. */
  thing: string;
  /** The exact name main will compare against, shown as a hint in the typed-name step. */
  expectedName: string;
  /** What the toast says once it went through: "Container removed". */
  doneMessage?: string;
  /** Called with the typed name only after main asked for one. */
  run: (confirmation?: { name: string }) => Promise<StewardResult<unknown>>;
}

/**
 * Confirms a destructive Docker action. Main decides whether the server needs the
 * name typed in (it is in a protected environment): the first attempt goes without
 * it, and only if main answers `CONFIRMATION_REQUIRED` does this ask for the name.
 */
export function DestructiveDialog({
  request,
  onDone,
  onError,
  onCancel
}: {
  request: DestructiveRequest;
  onDone: () => void;
  onError: (error: StewardError) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [stage, setStage] = useState<'confirm' | 'type'>('confirm');
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { closing, requestClose } = useExitAnimation();

  async function attempt(confirmation?: { name: string }): Promise<void> {
    setBusy(true);
    const result = await request.run(confirmation);
    setBusy(false);
    if (result.success) {
      toast.success(request.doneMessage ?? 'Done');
      onDone();
      return;
    }
    if (result.error.code === 'CONFIRMATION_REQUIRED') {
      setStage('type');
      return;
    }
    if (result.error.code === 'CONFIRMATION_MISMATCH') {
      setProblem(result.error.message);
      return;
    }
    onError(result.error);
    onCancel();
  }

  if (stage === 'confirm') {
    return (
      <ConfirmDialog
        title={request.title}
        confirmLabel={request.confirmLabel}
        onConfirm={() => void attempt()}
        onCancel={onCancel}
      >
        {request.body}
      </ConfirmDialog>
    );
  }

  return createPortal(
    <div className={`dialog__backdrop${closing ? ' is-closing' : ''}`} onClick={() => requestClose(onCancel)}>
      <div className="dialog" role="alertdialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h3 className="dialog__title">This server is protected</h3>
        <div className="dialog__body">
          <p>
            It belongs to a protected environment. Type the name of the {request.thing} to confirm:{' '}
            <strong>{request.expectedName}</strong>
          </p>
          <input
            className="field__input"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setProblem(null);
            }}
            autoFocus
            spellCheck={false}
            aria-label={`Name of the ${request.thing}`}
          />
          {problem !== null && <p className="dprequired">{problem}</p>}
        </div>
        <div className="dialog__actions">
          <Button onClick={() => requestClose(onCancel)}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} loadingLabel="Working…" disabled={typed === ''} onClick={() => void attempt({ name: typed })}>
            {request.confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

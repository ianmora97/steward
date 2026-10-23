import { useEffect } from 'react';
import { useExitAnimation } from './useExitAnimation';

/**
 * Confirmation for actions that cannot be undone. The caller states exactly what
 * will be lost; nothing proceeds on an Enter keypress by accident, because
 * focus starts on Cancel.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { closing, requestClose } = useExitAnimation();
  const cancel = (): void => requestClose(onCancel);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') requestClose(onCancel);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, requestClose]);

  return (
    <div className={`dialog__backdrop${closing ? ' is-closing' : ''}`} onClick={cancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="dialog-title" className="dialog__title">
          {title}
        </h3>
        <div className="dialog__body">{children}</div>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={cancel} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => requestClose(onConfirm)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import { Icon } from './Icon';
import { useExitAnimation } from './useExitAnimation';

/** A centred dialog that fades in, slides up, and plays the reverse on close. */
export function Modal({
  title,
  children,
  onClose,
  className = ''
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
  onClose: () => void;
}): React.JSX.Element {
  const { closing, requestClose } = useExitAnimation();
  const close = (): void => requestClose(onClose);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') requestClose(onClose);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, requestClose]);

  return (
    <div className={`dialog__backdrop${closing ? ' is-closing' : ''}`} onClick={close}>
      <div
        className={`dialog dialog--wide ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dialog__header">
          <h3 id="modal-title" className="dialog__title">
            {title}
          </h3>
          <button type="button" className="iconbutton" onClick={close} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

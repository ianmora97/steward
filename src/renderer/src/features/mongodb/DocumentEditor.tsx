import { useState } from 'react';
import type { StewardError, StewardResult } from '@shared/types/result';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';

/**
 * Edits one document (or inserts new ones) as shell-syntax text. What is saved is parsed in the main
 * process, so `ObjectId("…")`, `ISODate("…")` and `NumberLong("…")` come back as the types they name.
 */
export function DocumentEditor({
  title,
  hint,
  initialText,
  submitLabel,
  onSubmit,
  onSaved,
  onClose
}: {
  title: string;
  hint: string;
  initialText: string;
  submitLabel: string;
  /** `force` is set when the user chose to overwrite a document that changed on the server. */
  onSubmit: (text: string, force: boolean) => Promise<StewardResult<unknown>>;
  onSaved: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<StewardError | null>(null);

  async function submit(force: boolean): Promise<void> {
    setBusy(true);
    setProblem(null);
    const result = await onSubmit(text, force);
    setBusy(false);
    if (result.success) onSaved();
    else setProblem(result.error);
  }

  return (
    <Modal title={title} onClose={onClose} className="mgeditor">
      <div className="mgeditor__body">
        <p className="card__hint">{hint}</p>
        <textarea
          className="field__input mgeditor__text dpmono"
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          aria-label="Document"
          autoFocus
        />
        {problem !== null && (
          <div className="banner banner--error" role="alert">
            <span className="banner__message">{problem.message}</span>
            {problem.details !== undefined && <span className="banner__details">{problem.details}</span>}
          </div>
        )}
        <div className="dialog__actions">
          <Button onClick={onClose}>
            Cancel
          </Button>
          {problem?.code === 'MONGO_DOC_CHANGED' && (
            <Button variant="danger" disabled={busy} onClick={() => void submit(true)}>
              Save anyway
            </Button>
          )}
          <Button variant="primary" loading={busy} loadingLabel="Saving…" disabled={text.trim() === ''} onClick={() => void submit(false)}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

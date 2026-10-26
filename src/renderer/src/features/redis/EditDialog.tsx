import { useState } from 'react';
import type { StewardError, StewardResult } from '@shared/types/result';
import { Modal } from '../../components/Modal';
import { ExpiryField } from './ExpiryField';
import { Button } from '../../components/Button';

export interface FieldSpec {
  id: string;
  label: string;
  initial?: string;
  multiline?: boolean;
  /** Numbers are checked before the dialog submits. */
  numeric?: boolean;
  /** A moment on a calendar. `initial` and the submitted value are ISO text, empty for "never". */
  kind?: 'expiry';
  readOnly?: boolean;
  placeholder?: string;
  hint?: string;
}

/** A small form for one change to a key. It stays open on an error, so nothing typed is lost. */
export function EditDialog({
  title,
  fields,
  submitLabel = 'Save',
  extra,
  onSubmit,
  onDone,
  onCancel
}: {
  title: string;
  fields: FieldSpec[];
  submitLabel?: string;
  /** Anything that goes below the fields (a checkbox, a note). */
  extra?: React.ReactNode;
  onSubmit: (values: Record<string, string>) => Promise<StewardResult<unknown>>;
  onDone: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.id, field.initial ?? ''])));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<StewardError | null>(null);

  const numberProblem = fields.find((field) => field.numeric === true && (values[field.id] ?? '').trim() !== '' && !Number.isFinite(Number(values[field.id])));

  async function submit(): Promise<void> {
    if (numberProblem !== undefined) return;
    setBusy(true);
    setProblem(null);
    const result = await onSubmit(values);
    setBusy(false);
    if (result.success) onDone();
    else setProblem(result.error);
  }

  return (
    <Modal title={title} onClose={onCancel} className="rdedit">
      <form
        className="mgconn__body"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {fields.map((field, index) =>
          field.kind === 'expiry' ? (
            <div key={field.id} className="field">
              <span className="field__label">{field.label}</span>
              <ExpiryField
                value={(values[field.id] ?? '') === '' ? null : new Date(values[field.id] ?? '')}
                onChange={(next) => setValues((current) => ({ ...current, [field.id]: next === null ? '' : next.toISOString() }))}
              />
              {field.hint !== undefined && <span className="card__hint">{field.hint}</span>}
            </div>
          ) : (
          <label key={field.id} className="field">
            <span className="field__label">{field.label}</span>
            {field.multiline === true ? (
              <textarea
                className="field__input dpmono rdedit__text"
                value={values[field.id] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                readOnly={field.readOnly}
                placeholder={field.placeholder}
                spellCheck={false}
                autoFocus={index === 0}
                rows={10}
              />
            ) : (
              <input
                className="field__input dpmono"
                value={values[field.id] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                readOnly={field.readOnly}
                placeholder={field.placeholder}
                spellCheck={false}
                autoFocus={index === 0}
                inputMode={field.numeric === true ? 'decimal' : undefined}
              />
            )}
            {field.hint !== undefined && <span className="card__hint">{field.hint}</span>}
          </label>
          )
        )}
        {numberProblem !== undefined && <p className="dprequired">{numberProblem.label} must be a number.</p>}
        {extra}
        {problem !== null && (
          <div className="banner banner--error" role="alert">
            <span className="banner__message">{problem.message}</span>
            {problem.details !== undefined && <span className="banner__details">{problem.details}</span>}
          </div>
        )}
        <div className="dialog__actions">
          <Button onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} loadingLabel="Saving…" disabled={numberProblem !== undefined} type="submit">
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

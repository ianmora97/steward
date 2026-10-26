import { useEffect, useState } from 'react';
import { documentToShellText } from '@shared/mongo/shell-format';
import type { MongoConnection, MongoValidation } from '@shared/schemas/mongodb';
import type { StewardError } from '@shared/types/result';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Button } from '../../components/Button';
import { toast } from '../../stores/toast.store';
import { Loading } from '../../components/Loading';

/** The rules the server applies to documents on write ($jsonSchema or any expression). */
export function ValidationView({
  connection,
  db,
  collection,
  onError
}: {
  connection: MongoConnection;
  db: string;
  collection: string;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<MongoValidation | null>(null);
  const [validator, setValidator] = useState('');
  const [level, setLevel] = useState<MongoValidation['validationLevel']>('strict');
  const [action, setAction] = useState<MongoValidation['validationAction']>('error');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.steward.mongo.getValidation({ connectionId: connection.id, db, collection }).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        onError(result.error);
        return;
      }
      setLoaded(result.data);
      setValidator(result.data.validator === '' ? '' : documentToShellText(result.data.validator));
      setLevel(result.data.validationLevel);
      setAction(result.data.validationAction);
    });
    return () => {
      cancelled = true;
    };
  }, [connection.id, db, collection, onError]);

  async function save(): Promise<void> {
    const result = await window.steward.mongo.setValidation({
      connectionId: connection.id,
      db,
      collection,
      validator,
      validationLevel: level,
      validationAction: action,
      confirmed: true
    });
    if (!result.success) {
      onError(result.error);
      return;
    }
    toast.success('Validation rules saved');
    setLoaded(result.data);
  }

  if (loaded === null) return <Loading variant="line" lines={5} label="Loading validation rules…" />;

  return (
    <section className="mgvalidation">
      <p className="card__hint">
        Rules the server checks on every insert and update. Leave the validator empty to remove them. Existing documents are not
        rewritten.
      </p>
      <label className="field">
        <span className="field__label">Validator</span>
        <textarea
          className="field__input mgeditor__text dpmono"
          value={validator}
          onChange={(event) => setValidator(event.target.value)}
          placeholder='{ $jsonSchema: { bsonType: "object", required: ["name"], properties: { name: { bsonType: "string" } } } }'
          spellCheck={false}
          disabled={connection.readOnly}
        />
      </label>
      <div className="dprow">
        <label className="field">
          <span className="field__label">Applies to</span>
          <select className="field__input" value={level} onChange={(event) => setLevel(event.target.value as MongoValidation['validationLevel'])} disabled={connection.readOnly}>
            <option value="strict">All inserts and updates (strict)</option>
            <option value="moderate">Only documents that already satisfy it (moderate)</option>
            <option value="off">Nothing (off)</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">When a document fails</span>
          <select className="field__input" value={action} onChange={(event) => setAction(event.target.value as MongoValidation['validationAction'])} disabled={connection.readOnly}>
            <option value="error">Reject the write (error)</option>
            <option value="warn">Allow it and log a warning (warn)</option>
          </select>
        </label>
      </div>
      <div className="dialog__actions">
        <Button variant="primary" disabled={connection.readOnly} title={connection.readOnly ? 'This connection is read-only' : undefined} onClick={() => setConfirming(true)}>
          Save validation
        </Button>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Change the validation rules?"
          confirmLabel="Save rules"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void save();
          }}
        >
          <p>From now on the server applies these rules to <strong>{db}.{collection}</strong>. Writes the application makes today may start to fail.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

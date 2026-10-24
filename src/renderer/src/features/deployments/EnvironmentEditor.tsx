import { useState } from 'react';
import { ENVIRONMENT_KINDS, type Environment, type EnvironmentKind } from '@shared/schemas/environments';
import type { StewardError } from '@shared/types/result';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Modal } from '../../components/Modal';
import { KIND_LABEL } from './deployment-meta';

/** Create or edit an environment. Also used from the SSH editor, which is why it saves by itself. */
export function EnvironmentEditor({
  projectId,
  environment,
  onSaved,
  onClose
}: {
  projectId: string;
  /** null = a new environment. */
  environment: Environment | null;
  onSaved: (saved: Environment) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(environment?.name ?? '');
  const [kind, setKind] = useState<EnvironmentKind>(environment?.kind ?? 'custom');
  const [isProtected, setIsProtected] = useState(environment?.isProtected ?? false);
  // Choosing "production" protects a new environment, until the user decides about the box themselves.
  const [protectionTouched, setProtectionTouched] = useState(false);
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<StewardError | null>(null);

  const loweringProtection = environment !== null && environment.isProtected && !isProtected;

  function chooseKind(next: EnvironmentKind): void {
    setKind(next);
    if (environment === null && !protectionTouched) setIsProtected(next === 'production');
  }

  async function save(confirmed: boolean): Promise<void> {
    setAsking(false);
    setSaving(true);
    setError(null);
    const result =
      environment === null
        ? await window.steward.environments.create({ projectId, name, kind, isProtected })
        : await window.steward.environments.update({ id: environment.id, name, kind, isProtected, confirmed });
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onSaved(result.data);
    onClose();
  }

  return (
    <Modal title={environment === null ? 'New environment' : `Edit ${environment.name}`} onClose={onClose}>
      <div className="dialog__body dpform">
        {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="field__input"
            value={name}
            maxLength={120}
            placeholder="Production, Staging…"
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Kind</span>
          <select
            className="field__input"
            value={kind}
            onChange={(event) => chooseKind(event.target.value as EnvironmentKind)}
          >
            {ENVIRONMENT_KINDS.map((value) => (
              <option key={value} value={value}>
                {KIND_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="dpcheck">
          <input
            type="checkbox"
            checked={isProtected}
            onChange={(event) => {
              setIsProtected(event.target.checked);
              setProtectionTouched(true);
            }}
          />
          <span>
            <strong>Protected</strong> — every deploy here asks you to type the environment&apos;s name first.
          </span>
        </label>
      </div>
      <div className="dialog__actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={saving || name.trim() === ''}
          onClick={() => (loweringProtection ? setAsking(true) : void save(false))}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {asking && environment !== null && (
        <ConfirmDialog
          title={`Remove protection from ${environment.name}?`}
          confirmLabel="Remove protection"
          onConfirm={() => void save(true)}
          onCancel={() => setAsking(false)}
        >
          <p>
            Deploys to {environment.name} will stop asking you to type its name. Anyone with access to this app could
            deploy there with a single click.
          </p>
        </ConfirmDialog>
      )}
    </Modal>
  );
}

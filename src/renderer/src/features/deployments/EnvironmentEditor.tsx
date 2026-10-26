import { useState } from 'react';
import { ENVIRONMENT_KINDS, type Environment, type EnvironmentKind } from '@shared/schemas/environments';
import type { StewardError } from '@shared/types/result';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Modal } from '../../components/Modal';
import { KIND_LABEL } from './deployment-meta';
import { Button } from '../../components/Button';
import { toast } from '../../stores/toast.store';
import { Icon } from '../../components/Icon';
import { ENVIRONMENT_ICONS, environmentIcon, environmentTone } from '../../components/environment-meta';

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
  const [icon, setIcon] = useState<string | null>(environment?.icon ?? null);
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
        ? await window.steward.environments.create({ projectId, name, kind, icon, isProtected })
        : await window.steward.environments.update({ id: environment.id, name, kind, icon, isProtected, confirmed });
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success(environment === null ? 'Environment created' : 'Environment saved');
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
        <div className="field">
          <span className="field__label">Icon</span>
          <div className="envicons" role="radiogroup" aria-label="Environment icon" style={{ ['--env' as string]: environmentTone(name) }}>
            <span className="envicons__preview" aria-hidden="true">
              <Icon name={environmentIcon(name, icon)} size={20} />
            </span>
            <div className="envicons__grid">
              {ENVIRONMENT_ICONS.map((choice) => {
                const on = icon === choice;
                return (
                  <button
                    key={choice}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={choice}
                    title={choice}
                    className={`envicon${on ? ' envicon--on' : ''}`}
                    onClick={() => setIcon(on ? null : choice)}
                  >
                    <Icon name={choice} size={16} />
                  </button>
                );
              })}
            </div>
          </div>
          <span className="field__hint">{icon === null ? 'Automatic: follows the name (Production, Staging, Local…). Pick one to override it.' : 'Click the selected icon again to go back to automatic.'}</span>
        </div>
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
        <Button onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" loading={saving} loadingLabel="Saving…" disabled={name.trim() === ''} onClick={() => (loweringProtection ? setAsking(true) : void save(false))}>Save</Button>
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

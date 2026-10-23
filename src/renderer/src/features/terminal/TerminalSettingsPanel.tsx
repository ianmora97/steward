import { useState } from 'react';
import type { TerminalProfile } from '@shared/schemas/terminal';
import type { StewardError } from '@shared/types/result';
import { ErrorBanner } from '../../components/ErrorBanner';

/**
 * Shell profiles. Detected shells are read-only; custom ones are global (shared
 * by every project) and the default is chosen per project. Changes apply to
 * terminals opened afterwards, not to running ones.
 */
export function TerminalSettingsPanel({
  projectId,
  profiles,
  defaultProfileId,
  onChanged
}: {
  projectId: string;
  profiles: TerminalProfile[];
  defaultProfileId: string | null;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const [name, setName] = useState('');
  const [shellPath, setShellPath] = useState('');
  const [shellArgs, setShellArgs] = useState('');
  const [error, setError] = useState<StewardError | null>(null);

  const custom = profiles.filter((profile) => profile.kind === 'custom');
  // A stale default (deleted profile) shows as the first shell, which is what main falls back to.
  const effectiveDefault = profiles.some((profile) => profile.id === defaultProfileId)
    ? defaultProfileId
    : (profiles[0]?.id ?? null);

  async function setDefault(profileId: string): Promise<void> {
    const result = await window.steward.terminal.setSettings({ projectId, defaultProfileId: profileId });
    if (!result.success) {
      setError(result.error);
      return;
    }
    setError(null);
    await onChanged();
  }

  async function addProfile(): Promise<void> {
    const result = await window.steward.terminal.saveProfile({
      name,
      shellPath: shellPath.trim(),
      shellArgs: shellArgs
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
    });
    if (!result.success) {
      setError(result.error);
      return;
    }
    setError(null);
    setName('');
    setShellPath('');
    setShellArgs('');
    await onChanged();
  }

  async function removeProfile(profileId: string): Promise<void> {
    const result = await window.steward.terminal.deleteProfile({ profileId });
    if (!result.success) {
      setError(result.error);
      return;
    }
    setError(null);
    await onChanged();
  }

  return (
    <section className="termsettings">
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <label className="field">
        <span className="field__label">Default shell for this project</span>
        <select
          className="field__input"
          value={effectiveDefault ?? ''}
          onChange={(event) => void setDefault(event.target.value)}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
              {profile.kind === 'custom' ? ' (custom)' : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="termsettings__list">
        <span className="field__label">Custom shells (available in every project)</span>
        {custom.length === 0 && <p className="card__hint">None yet.</p>}
        {custom.map((profile) => (
          <div key={profile.id} className="termsettings__row">
            <span>
              <strong>{profile.name}</strong>
              <span className="card__hint"> {[profile.file, ...profile.args].join(' ')}</span>
            </span>
            <button type="button" className="button button--small" onClick={() => void removeProfile(profile.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="termsettings__form">
        <span className="field__label">Add a custom shell</span>
        <input
          className="field__input"
          value={name}
          placeholder="Name (e.g. Nushell)"
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="field__input"
          value={shellPath}
          placeholder="Executable, absolute path (e.g. C:\Program Files\Git\bin\bash.exe)"
          onChange={(event) => setShellPath(event.target.value)}
        />
        <textarea
          className="field__input"
          rows={2}
          value={shellArgs}
          placeholder="Arguments, one per line (optional)"
          onChange={(event) => setShellArgs(event.target.value)}
        />
        <div className="termsettings__actions">
          <button
            type="button"
            className="button button--primary"
            disabled={name.trim() === '' || shellPath.trim() === ''}
            onClick={() => void addProfile()}
          >
            Add shell
          </button>
        </div>
      </div>
    </section>
  );
}

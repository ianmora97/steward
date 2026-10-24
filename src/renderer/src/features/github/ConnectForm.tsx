import { useState } from 'react';
import { Icon } from '../../components/Icon';

/**
 * The token is held only in this input until it is sent, then cleared. It is
 * a password field so it is never shown on screen or picked up by screenshots.
 */
export function ConnectForm({
  busy,
  onConnect,
  onImport
}: {
  busy: boolean;
  onConnect: (token: string) => Promise<boolean>;
  onImport: () => Promise<boolean>;
}): React.JSX.Element {
  const [token, setToken] = useState('');

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const value = token;
    setToken('');
    const connected = await onConnect(value);
    if (!connected) setToken(value);
  }

  return (
    <form className="card ghconnect" onSubmit={(event) => void submit(event)}>
      <h3 className="card__title">Connect GitHub</h3>
      <p className="card__hint">
        Paste a personal access token with the <code>repo</code> scope. Steward encrypts it with your OS keyring and
        keeps it in the main process; it is never shown again or stored in the database.
      </p>
      <label className="field">
        <span className="field__label">Personal access token</span>
        <input
          className="field__input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="ghp_… or github_pat_…"
        />
      </label>
      <div className="ghconnect__actions">
        <button type="submit" className="button button--primary" disabled={busy || token.trim().length === 0}>
          Connect
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => void onImport()}>
          <Icon name="terminal" size={14} /> Import from gh CLI
        </button>
      </div>
      <p className="card__hint">
        “Import from gh CLI” runs <code>gh auth token</code> once and stores that token in Steward. It only happens when
        you click it.
      </p>
    </form>
  );
}

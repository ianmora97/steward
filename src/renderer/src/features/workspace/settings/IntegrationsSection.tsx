import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { ErrorBanner } from '../../../components/ErrorBanner';
import { Icon } from '../../../components/Icon';
import { Pill, type PillTone } from '../../../components/Pill';
import { useGithubStore } from '../../../stores/github.store';
import { ConnectForm } from '../../github/ConnectForm';

const STATUS_PILL: Record<string, { tone: PillTone; label: string }> = {
  connected: { tone: 'success', label: 'Connected' },
  auth_error: { tone: 'failure', label: 'Token rejected' },
  unreachable: { tone: 'warning', label: 'Unreachable' },
  unconfigured: { tone: 'neutral', label: 'Not connected' }
};

/** The services this project talks to on its own account. GitHub today; the token is stored encrypted, per project. */
export function IntegrationsSection({ projectId }: { projectId: string }): React.JSX.Element {
  const integration = useGithubStore((state) => state.integrationByProject[projectId]);
  const busy = useGithubStore((state) => state.busy);
  const error = useGithubStore((state) => state.error);
  const loadStatus = useGithubStore((state) => state.loadStatus);
  const connect = useGithubStore((state) => state.connect);
  const importFromGh = useGithubStore((state) => state.importFromGh);
  const disconnect = useGithubStore((state) => state.disconnect);
  const dismissError = useGithubStore((state) => state.dismissError);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void loadStatus(projectId);
  }, [projectId, loadStatus]);

  const status = integration?.status ?? 'unconfigured';
  const pill = STATUS_PILL[status] ?? STATUS_PILL['unconfigured'];
  const connected = status === 'connected';

  return (
    <div className="pset__stack">
      {error !== null && <ErrorBanner error={error} onDismiss={dismissError} />}

      <section className="card">
        <div className="pset__integration-head">
          <h2 className="card__title">
            <Icon name="github" size={18} /> GitHub
          </h2>
          {pill !== undefined && <Pill tone={pill.tone}>{pill.label}</Pill>}
        </div>
        <p className="card__hint">
          Pull requests and Actions in the Git tab, and workflow deploys. Steward uses a personal access token, kept encrypted with your system's keyring;
          each project has its own.
        </p>

        {connected && integration !== undefined && (
          <>
            <dl className="probe__facts">
              <div>
                <dt>Signed in as</dt>
                <dd>{integration.login ?? 'unknown'}</dd>
              </div>
              <div>
                <dt>Token scopes</dt>
                <dd>{integration.scopes.length > 0 ? integration.scopes.join(', ') : 'fine-grained token'}</dd>
              </div>
            </dl>
            <div className="pset__actions">
              <button type="button" className="button" disabled={busy} onClick={() => void loadStatus(projectId)}>
                <Icon name="refresh" size={14} /> Check again
              </button>
              <button type="button" className="button button--danger" disabled={busy} onClick={() => setConfirming(true)}>
                Disconnect
              </button>
            </div>
          </>
        )}

        {status === 'auth_error' && <p className="dprequired">GitHub rejected the stored token. {integration?.lastError ?? 'It may have expired or been revoked.'}</p>}
        {status === 'unreachable' && (
          <p className="dprequired">
            Steward could not reach GitHub. {integration?.lastError ?? 'Check your connection.'}{' '}
            <button type="button" className="button button--small" onClick={() => void loadStatus(projectId)}>
              Retry
            </button>
          </p>
        )}
      </section>

      {(status === 'unconfigured' || status === 'auth_error') && (
        <ConnectForm busy={busy} onConnect={(token) => connect(projectId, token)} onImport={() => importFromGh(projectId)} />
      )}

      {confirming && (
        <ConfirmDialog
          title="Disconnect GitHub?"
          confirmLabel="Disconnect"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void disconnect(projectId);
          }}
        >
          <p>The stored token is deleted from this computer. Nothing changes on GitHub; the token itself stays valid until you revoke it there.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Card } from '../../../components/Card';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { ErrorBanner } from '../../../components/ErrorBanner';
import { Icon } from '../../../components/Icon';
import { Badge, type BadgeTone } from '../../../components/Badge';
import { useGithubStore } from '../../../stores/github.store';
import { ConnectForm } from '../../github/ConnectForm';
import { Button } from '../../../components/Button';

const STATUS_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
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
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE['unconfigured'];
  const connected = status === 'connected';

  return (
    <div className="pset__stack">
      {error !== null && <ErrorBanner error={error} onDismiss={dismissError} />}

      <Card>
        <Card.Header
          title={
            <>
              <Icon name="github" size={18} /> GitHub
            </>
          }
        >
          {badge !== undefined && <Badge tone={badge.tone}>{badge.label}</Badge>}
        </Card.Header>
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
              <Button disabled={busy} onClick={() => void loadStatus(projectId)}>
                <Icon name="refresh" size={14} /> Check again
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            </div>
          </>
        )}

        {status === 'auth_error' && <p className="dprequired">GitHub rejected the stored token. {integration?.lastError ?? 'It may have expired or been revoked.'}</p>}
        {status === 'unreachable' && (
          <p className="dprequired">
            Steward could not reach GitHub. {integration?.lastError ?? 'Check your connection.'}{' '}
            <Button size="sm" onClick={() => void loadStatus(projectId)}>
              Retry
            </Button>
          </p>
        )}
      </Card>

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

import { useEffect, useMemo, useState } from 'react';
import type { GithubPullState } from '@shared/schemas/github';
import { parseGithubRemote } from '@shared/github-remote';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Icon } from '../../components/Icon';
import { useAppStore } from '../../stores/app.store';
import { useGithubStore } from '../../stores/github.store';
import { ConnectForm } from './ConnectForm';
import { CreatePullModal } from './CreatePullModal';
import { PullList } from './PullList';
import './github.css';

const STATE_FILTERS: readonly GithubPullState[] = ['open', 'closed', 'all'];

export function GithubPanel(): React.JSX.Element {
  const projectId = useAppStore((state) => state.selectedProjectId);
  const repositories = useAppStore((state) => state.repositories);
  const integration = useGithubStore((state) =>
    projectId === null ? undefined : state.integrationByProject[projectId]
  );
  const busy = useGithubStore((state) => state.busy);
  const error = useGithubStore((state) => state.error);
  const repositoryId = useGithubStore((state) => state.repositoryId);
  const pullsState = useGithubStore((state) => state.pullsState);
  const pulls = useGithubStore((state) => state.pulls);
  const hasNext = useGithubStore((state) => state.hasNext);
  const loadingPulls = useGithubStore((state) => state.loadingPulls);
  const loadStatus = useGithubStore((state) => state.loadStatus);
  const connect = useGithubStore((state) => state.connect);
  const importFromGh = useGithubStore((state) => state.importFromGh);
  const disconnect = useGithubStore((state) => state.disconnect);
  const dismissError = useGithubStore((state) => state.dismissError);
  const selectRepository = useGithubStore((state) => state.selectRepository);
  const setPullsState = useGithubStore((state) => state.setPullsState);
  const reloadPulls = useGithubStore((state) => state.reloadPulls);
  const loadMore = useGithubStore((state) => state.loadMore);
  const openUrl = useGithubStore((state) => state.openUrl);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (projectId !== null) void loadStatus(projectId);
  }, [projectId, loadStatus]);

  const githubRepositories = useMemo(
    () => repositories.filter((repository) => parseGithubRemote(repository.remoteUrl) !== null),
    [repositories]
  );

  const status = integration?.status ?? 'unconfigured';
  const connected = status === 'connected';

  // Pick a repository once the connection is known: keep the previous choice if it still applies.
  useEffect(() => {
    if (projectId === null || !connected) return;
    const stillValid = githubRepositories.some((repository) => repository.id === repositoryId);
    if (stillValid) return;
    void selectRepository(projectId, githubRepositories[0]?.id ?? null);
  }, [projectId, connected, githubRepositories, repositoryId, selectRepository]);

  if (projectId === null) {
    return <EmptyState title="No project selected" description="Pick a project to connect GitHub." />;
  }

  const needsToken = status === 'unconfigured' || status === 'auth_error';
  const selected = githubRepositories.find((repository) => repository.id === repositoryId) ?? null;

  return (
    <section className="panel ghpage">
      <header className="ghpage__head">
        <h2 className="ghpage__title">
          <Icon name="pullRequest" size={22} /> GitHub
        </h2>
        {connected && (
          <button type="button" className="button button--ghost" onClick={() => setConfirmingDisconnect(true)}>
            Disconnect
          </button>
        )}
      </header>

      {error !== null && <ErrorBanner error={error} onDismiss={dismissError} />}

      {status === 'auth_error' && (
        <div className="banner banner--error" role="alert">
          <div className="banner__body">
            <p className="banner__message">GitHub rejected the stored token.</p>
            <p className="banner__details">
              {integration?.lastError ?? 'It may have expired or been revoked.'} Connect again with a new token.
            </p>
          </div>
        </div>
      )}

      {status === 'unreachable' && (
        <div className="banner banner--error" role="alert">
          <div className="banner__body">
            <p className="banner__message">Steward could not reach GitHub.</p>
            <p className="banner__details">{integration?.lastError ?? 'Check your connection.'}</p>
          </div>
          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            onClick={() => void loadStatus(projectId)}
          >
            Retry
          </button>
        </div>
      )}

      {needsToken && (
        <ConnectForm
          busy={busy}
          onConnect={(token) => connect(projectId, token)}
          onImport={() => importFromGh(projectId)}
        />
      )}

      {connected && integration !== undefined && (
        <div className="card ghaccount">
          <h3 className="card__title">Connected as {integration.login ?? 'unknown'}</h3>
          <p className="card__hint">
            Scopes:{' '}
            {integration.scopes.length > 0 ? integration.scopes.join(', ') : 'none reported (fine-grained token)'}
          </p>
        </div>
      )}

      {connected && (
        <div className="card ghpulls-card">
          <div className="ghpulls-card__head">
            <h3 className="card__title">Pull requests</h3>
            <div className="ghpulls-card__controls">
              <select
                className="field__input"
                aria-label="Repository"
                value={repositoryId ?? ''}
                disabled={githubRepositories.length === 0}
                onChange={(event) => void selectRepository(projectId, event.target.value || null)}
              >
                {repositories.map((repository) => {
                  const onGithub = parseGithubRemote(repository.remoteUrl) !== null;
                  return (
                    <option key={repository.id} value={repository.id} disabled={!onGithub}>
                      {repository.name}
                      {onGithub ? '' : ' (not on GitHub)'}
                    </option>
                  );
                })}
              </select>
              <select
                className="field__input"
                aria-label="Pull request state"
                value={pullsState}
                onChange={(event) => void setPullsState(projectId, event.target.value as GithubPullState)}
              >
                {STATE_FILTERS.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button button--primary"
                disabled={selected === null}
                onClick={() => setCreating(true)}
              >
                New pull request
              </button>
            </div>
          </div>

          {selected === null ? (
            <p className="card__hint">
              {repositories.length === 0
                ? 'This project has no repositories yet.'
                : 'None of this project’s repositories has a github.com remote.'}
            </p>
          ) : (
            <PullList
              pulls={pulls}
              hasNext={hasNext}
              loading={loadingPulls}
              onLoadMore={() => void loadMore(projectId)}
              onOpen={(url) => void openUrl(url)}
            />
          )}
        </div>
      )}

      {creating && selected !== null && (
        <CreatePullModal
          projectId={projectId}
          repositoryId={selected.id}
          repositoryName={selected.name}
          onClose={() => setCreating(false)}
          onCreated={() => void reloadPulls(projectId)}
        />
      )}

      {confirmingDisconnect && (
        <ConfirmDialog
          title="Disconnect GitHub?"
          confirmLabel="Disconnect"
          onCancel={() => setConfirmingDisconnect(false)}
          onConfirm={() => {
            setConfirmingDisconnect(false);
            void disconnect(projectId);
          }}
        >
          <p>
            The stored token is deleted from this computer and the GitHub tab is hidden. Nothing changes on GitHub; the
            token itself stays valid until you revoke it there.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

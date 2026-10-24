import { useEffect, useMemo, useState } from 'react';
import type { GithubPullState } from '@shared/schemas/github';
import { parseGithubRemote } from '@shared/github-remote';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Icon } from '../../components/Icon';
import { Pill } from '../../components/Pill';
import { useAppStore } from '../../stores/app.store';
import { useGithubStore } from '../../stores/github.store';
import { ConnectForm } from './ConnectForm';
import { ActionsView } from './ActionsView';
import { CreatePullModal } from './CreatePullModal';
import { PullList } from './PullList';
import { healthPill } from './run-format';
import './github.css';

const STATE_FILTERS: readonly GithubPullState[] = ['open', 'closed', 'all'];

const STATE_LABELS: Record<GithubPullState, string> = { open: 'Open', closed: 'Closed', all: 'All' };

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
  const view = useGithubStore((state) => state.view);
  const workflows = useGithubStore((state) => state.workflows);
  const workflowId = useGithubStore((state) => state.workflowId);
  const health = useGithubStore((state) => state.health);
  const loadingRuns = useGithubStore((state) => state.loadingRuns);
  const setView = useGithubStore((state) => state.setView);
  const setWorkflow = useGithubStore((state) => state.setWorkflow);
  const loadActions = useGithubStore((state) => state.loadActions);
  const refreshActions = useGithubStore((state) => state.refreshActions);
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

  // Actions are read when the view opens and whenever the repository changes while it is open.
  useEffect(() => {
    if (projectId === null || !connected || view !== 'actions' || repositoryId === null) return;
    void loadActions(projectId);
  }, [projectId, connected, view, repositoryId, loadActions]);

  if (projectId === null) {
    return <EmptyState title="No project selected" description="Pick a project to connect GitHub." />;
  }

  const needsToken = status === 'unconfigured' || status === 'auth_error';
  const selected = githubRepositories.find((repository) => repository.id === repositoryId) ?? null;
  const actionsHealth = healthPill(health?.status ?? 'unknown');
  const showPullCount = pullsState === 'open' && selected !== null && (pulls.length > 0 || !loadingPulls);

  return (
    <section className="panel ghpage">
      <header className="ghpage__head">
        <h2 className="ghpage__title">
          <Icon name="github" size={22} /> GitHub
        </h2>
        {connected && integration !== undefined && (
          <div className="ghaccount">
            <Pill tone="success" icon="checkCircle">
              Connected as {integration.login ?? 'unknown'}
            </Pill>
            {integration.scopes.length > 0 ? (
              <span className="ghscopes" title="Token scopes">
                {integration.scopes.map((scope) => (
                  <code key={scope} className="ghref">
                    {scope}
                  </code>
                ))}
              </span>
            ) : (
              <span className="ghmeta__item">fine-grained token</span>
            )}
          </div>
        )}
        {connected && (
          <button
            type="button"
            className="button button--ghost ghpage__disconnect"
            onClick={() => setConfirmingDisconnect(true)}
          >
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

      {connected && (
        <div className="card ghmain">
          <div className="ghnav" role="tablist" aria-label="GitHub view">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'pulls'}
              className={`ghnav__button${view === 'pulls' ? ' is-active' : ''}`}
              onClick={() => setView('pulls')}
            >
              <Icon name="pullRequest" size={15} />
              Pull requests
              {showPullCount && (
                <Pill tone={pulls.length > 0 ? 'success' : 'neutral'}>
                  {pulls.length}
                  {hasNext ? '+' : ''} open
                </Pill>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'actions'}
              className={`ghnav__button${view === 'actions' ? ' is-active' : ''}`}
              onClick={() => setView('actions')}
            >
              <Icon name="actions" size={15} />
              Actions
              <Pill tone={actionsHealth.tone} icon={actionsHealth.icon}>
                {actionsHealth.label}
              </Pill>
            </button>
          </div>

          <div className="ghtoolbar">
            <div className="ghtoolbar__filters">
              <label className="ghselect">
                <Icon name="repo" size={14} />
                <select
                  className="ghselect__input"
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
              </label>

              {view === 'pulls' ? (
                <div className="segmented" role="group" aria-label="Pull request state">
                  {STATE_FILTERS.map((state) => (
                    <button
                      key={state}
                      type="button"
                      className={`segmented__option${pullsState === state ? ' segmented__option--active' : ''}`}
                      onClick={() => void setPullsState(projectId, state)}
                    >
                      {STATE_LABELS[state]}
                    </button>
                  ))}
                </div>
              ) : (
                <label className="ghselect">
                  <Icon name="filter" size={14} />
                  <select
                    className="ghselect__input"
                    aria-label="Workflow"
                    value={workflowId ?? ''}
                    onChange={(event) =>
                      void setWorkflow(projectId, event.target.value === '' ? null : Number(event.target.value))
                    }
                  >
                    <option value="">All workflows</option>
                    {workflows.map((workflow) => (
                      <option key={workflow.id} value={workflow.id}>
                        {workflow.name}
                        {workflow.state === 'active' ? '' : ' (disabled)'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="ghtoolbar__actions">
              {view === 'actions' ? (
                <button
                  type="button"
                  className="button button--small ghbutton"
                  disabled={loadingRuns || selected === null}
                  onClick={() => void refreshActions(projectId)}
                >
                  <Icon name="refresh" size={13} /> Refresh
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="button button--small ghbutton"
                    disabled={loadingPulls || selected === null}
                    onClick={() => void reloadPulls(projectId)}
                  >
                    <Icon name="refresh" size={13} /> Refresh
                  </button>
                  <button
                    type="button"
                    className="button button--primary button--small ghbutton"
                    disabled={selected === null}
                    onClick={() => setCreating(true)}
                  >
                    <Icon name="plus" size={13} /> New pull request
                  </button>
                </>
              )}
            </div>
          </div>

          {selected === null ? (
            <p className="card__hint">
              {repositories.length === 0
                ? 'This project has no repositories yet.'
                : 'None of this project’s repositories has a github.com remote.'}
            </p>
          ) : view === 'actions' ? (
            <ActionsView projectId={projectId} />
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

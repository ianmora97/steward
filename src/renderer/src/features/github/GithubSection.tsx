import { useEffect, useMemo, useState } from 'react';
import type { GithubPullState } from '@shared/schemas/github';
import { parseGithubRemote } from '@shared/github-remote';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Icon } from '../../components/Icon';
import { Pill } from '../../components/Pill';
import { useAppStore } from '../../stores/app.store';
import { useGithubStore } from '../../stores/github.store';
import { useGitStore } from '../../stores/git.store';
import { ConnectForm } from './ConnectForm';
import { ActionsView } from './ActionsView';
import { CreatePullModal } from './CreatePullModal';
import { PullList } from './PullList';
import './github.css';

const STATE_FILTERS: readonly GithubPullState[] = ['open', 'closed', 'all'];

const STATE_LABELS: Record<GithubPullState, string> = { open: 'Open', closed: 'Closed', all: 'All' };

/**
 * GitHub's pull requests and Actions, as sections of the Git tab. The repository is the one picked in the Git
 * toolbar; connecting, the account and disconnecting live here and in Settings → Integrations.
 */
export function GithubSection({ view }: { view: 'pulls' | 'actions' }): React.JSX.Element {
  const projectId = useAppStore((state) => state.selectedProjectId);
  const repositories = useAppStore((state) => state.repositories);
  const gitRepositoryId = useGitStore((state) => state.repositoryId);
  const integration = useGithubStore((state) => (projectId === null ? undefined : state.integrationByProject[projectId]));
  const busy = useGithubStore((state) => state.busy);
  const error = useGithubStore((state) => state.error);
  const githubRepositoryId = useGithubStore((state) => state.repositoryId);
  const pullsState = useGithubStore((state) => state.pullsState);
  const pulls = useGithubStore((state) => state.pulls);
  const hasNext = useGithubStore((state) => state.hasNext);
  const loadingPulls = useGithubStore((state) => state.loadingPulls);
  const workflows = useGithubStore((state) => state.workflows);
  const workflowId = useGithubStore((state) => state.workflowId);
  const loadingRuns = useGithubStore((state) => state.loadingRuns);
  const setView = useGithubStore((state) => state.setView);
  const setWorkflow = useGithubStore((state) => state.setWorkflow);
  const loadActions = useGithubStore((state) => state.loadActions);
  const refreshActions = useGithubStore((state) => state.refreshActions);
  const loadStatus = useGithubStore((state) => state.loadStatus);
  const connect = useGithubStore((state) => state.connect);
  const importFromGh = useGithubStore((state) => state.importFromGh);
  const dismissError = useGithubStore((state) => state.dismissError);
  const selectRepository = useGithubStore((state) => state.selectRepository);
  const setPullsState = useGithubStore((state) => state.setPullsState);
  const reloadPulls = useGithubStore((state) => state.reloadPulls);
  const loadMore = useGithubStore((state) => state.loadMore);
  const openUrl = useGithubStore((state) => state.openUrl);
  const [creating, setCreating] = useState(false);

  const status = integration?.status ?? 'unconfigured';
  const connected = status === 'connected';

  // The Git tab owns the repository choice; this section follows it when that repository is on GitHub.
  const selected = useMemo(
    () => repositories.find((repository) => repository.id === gitRepositoryId && parseGithubRemote(repository.remoteUrl) !== null) ?? null,
    [repositories, gitRepositoryId]
  );
  const selectedId = selected?.id ?? null;

  useEffect(() => {
    setView(view);
  }, [view, setView]);

  useEffect(() => {
    if (projectId !== null) void loadStatus(projectId);
  }, [projectId, loadStatus]);

  useEffect(() => {
    if (projectId === null || !connected || selectedId === null || githubRepositoryId === selectedId) return;
    void selectRepository(projectId, selectedId);
  }, [projectId, connected, selectedId, githubRepositoryId, selectRepository]);

  // Actions are read when the section opens and whenever the repository changes while it is open.
  useEffect(() => {
    if (projectId === null || !connected || view !== 'actions' || githubRepositoryId === null || githubRepositoryId !== selectedId) return;
    void loadActions(projectId);
  }, [projectId, connected, view, githubRepositoryId, selectedId, loadActions]);

  if (projectId === null) return <div className="ghsection" />;

  const needsToken = status === 'unconfigured' || status === 'auth_error';
  const ready = connected && selected !== null && githubRepositoryId === selected.id;

  return (
    <section className="ghsection">
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
          <button type="button" className="button button--ghost" disabled={busy} onClick={() => void loadStatus(projectId)}>
            Retry
          </button>
        </div>
      )}

      {needsToken && <ConnectForm busy={busy} onConnect={(token) => connect(projectId, token)} onImport={() => importFromGh(projectId)} />}

      {connected && (
        <div className="card ghmain">
          <div className="ghtoolbar">
            <div className="ghtoolbar__filters">
              <Pill tone="success" icon="checkCircle" title="The account this project uses to talk to GitHub">
                {integration?.login ?? 'Connected'}
              </Pill>

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
                    onChange={(event) => void setWorkflow(projectId, event.target.value === '' ? null : Number(event.target.value))}
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
                <button type="button" className="button button--small ghbutton" disabled={loadingRuns || !ready} onClick={() => void refreshActions(projectId)}>
                  <Icon name="refresh" size={13} /> Refresh
                </button>
              ) : (
                <>
                  <button type="button" className="button button--small ghbutton" disabled={loadingPulls || !ready} onClick={() => void reloadPulls(projectId)}>
                    <Icon name="refresh" size={13} /> Refresh
                  </button>
                  <button type="button" className="button button--primary button--small ghbutton" disabled={!ready} onClick={() => setCreating(true)}>
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
                : 'The repository picked above has no github.com remote. Pick another one to see its pull requests and Actions.'}
            </p>
          ) : view === 'actions' ? (
            ready && <ActionsView projectId={projectId} />
          ) : (
            ready && (
              <PullList pulls={pulls} hasNext={hasNext} loading={loadingPulls} onLoadMore={() => void loadMore(projectId)} onOpen={(url) => void openUrl(url)} />
            )
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
    </section>
  );
}

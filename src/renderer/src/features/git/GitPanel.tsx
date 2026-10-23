import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useAppStore } from '../../stores/app.store';
import { useGitStore } from '../../stores/git.store';
import { RepositoryPanel } from '../repositories/RepositoryPanel';
import { ActivityView } from './ActivityView';
import { GitWorkbench } from './GitWorkbench';

type SubTab = 'changes' | 'activity' | 'repositories';

const SUB_TABS: Array<{ key: SubTab; label: string }> = [
  { key: 'changes', label: 'Changes' },
  { key: 'activity', label: 'Activity' },
  { key: 'repositories', label: 'Repositories' }
];

/**
 * The Git tab: everyday operations against one repository of the project at a
 * time, with the repository list one click away.
 */
export function GitPanel(): React.JSX.Element {
  const repositories = useAppStore((state) => state.repositories);
  const repositoryId = useGitStore((state) => state.repositoryId);
  const selectRepository = useGitStore((state) => state.selectRepository);

  const [subTab, setSubTab] = useState<SubTab>('changes');

  // Keep the selection valid as repositories are added, removed, or the project changes.
  useEffect(() => {
    const stillExists = repositories.some((repository) => repository.id === repositoryId);
    if (!stillExists) void selectRepository(repositories[0]?.id ?? null);
  }, [repositories, repositoryId, selectRepository]);

  if (repositories.length === 0) return <RepositoryPanel />;

  return (
    <div className="gitpanel">
      <GitToolbar />
      <nav className="subtabs" aria-label="Git sections">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`subtabs__tab${subTab === tab.key ? ' subtabs__tab--active' : ''}`}
            onClick={() => setSubTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <GitMessages />
      <div className={`gitpanel__body${subTab === 'changes' ? ' gitpanel__body--fill' : ''}`}>
        {subTab === 'changes' && <GitWorkbench />}
        {subTab === 'activity' && <ActivityView />}
        {subTab === 'repositories' && <RepositoryPanel />}
      </div>
    </div>
  );
}

function GitToolbar(): React.JSX.Element {
  const repositories = useAppStore((state) => state.repositories);
  const { repositoryId, status, busy } = useGitStore();
  const selectRepository = useGitStore((state) => state.selectRepository);
  const refresh = useGitStore((state) => state.refresh);
  const fetchRemote = useGitStore((state) => state.fetch);
  const pull = useGitStore((state) => state.pull);
  const push = useGitStore((state) => state.push);
  const abortMerge = useGitStore((state) => state.abortMerge);

  const [confirmAbort, setConfirmAbort] = useState(false);

  const hasUpstream = status?.upstream !== undefined && status.upstream !== null;

  return (
    <header className="gitbar">
      <div className="gitbar__identity">
        {repositories.length > 1 ? (
          <select
            className="field__input"
            value={repositoryId ?? ''}
            onChange={(event) => void selectRepository(event.target.value)}
            aria-label="Repository"
          >
            {repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.name}
              </option>
            ))}
          </select>
        ) : (
          <strong>{repositories[0]?.name}</strong>
        )}

        {status !== null && (
          <>
            <span className="chip chip--primary">
              {status.detached ? `detached @ ${status.head?.slice(0, 7) ?? '?'}` : (status.branch ?? 'no branch')}
            </span>
            {status.upstream !== null && (
              <span className="gitbar__upstream" title={`Upstream ${status.upstream}`}>
                {status.upstream} · ↑{status.ahead} ↓{status.behind}
              </span>
            )}
            {status.upstream === null && !status.detached && (
              <span className="gitbar__upstream">no upstream — the first push will set one</span>
            )}
          </>
        )}
      </div>

      <div className="gitbar__actions">
        <button type="button" className="button" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => void fetchRemote()}>
          Fetch
        </button>
        <button
          type="button"
          className="button"
          disabled={busy || !hasUpstream || status?.detached === true}
          title={hasUpstream ? 'Fast-forward only' : 'This branch has no upstream yet'}
          onClick={() => void pull('ff-only')}
        >
          Pull{status !== null && status.behind > 0 ? ` ↓${status.behind}` : ''}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={busy || status === null || status.detached || !status.hasCommits}
          onClick={() => void push()}
        >
          Push{status !== null && status.ahead > 0 ? ` ↑${status.ahead}` : ''}
        </button>
      </div>

      {status?.mergeInProgress === true && (
        <div className="gitbar__merge" role="status">
          <span>A merge is in progress.</span>
          <button type="button" className="button button--small" disabled={busy} onClick={() => setConfirmAbort(true)}>
            Abort merge
          </button>
        </div>
      )}

      {confirmAbort && (
        <ConfirmDialog
          title="Abort the merge?"
          confirmLabel="Abort merge"
          onCancel={() => setConfirmAbort(false)}
          onConfirm={() => {
            setConfirmAbort(false);
            void abortMerge();
          }}
        >
          <p>
            Steward will run <code>git merge --abort</code>. Any conflict resolutions you have made in this merge
            are lost, and the branch returns to how it was before the merge started.
          </p>
        </ConfirmDialog>
      )}
    </header>
  );
}

function GitMessages(): React.JSX.Element | null {
  const error = useGitStore((state) => state.error);
  const notice = useGitStore((state) => state.notice);
  const dismiss = useGitStore((state) => state.dismiss);
  const pull = useGitStore((state) => state.pull);
  const busy = useGitStore((state) => state.busy);

  if (error !== null) {
    return (
      <div className="gitmsg gitmsg--error" role="alert">
        <div>
          <p className="gitmsg__title">{error.message}</p>
          {error.details !== undefined && <pre className="gitmsg__details">{error.details}</pre>}
          <span className="banner__code">{error.code}</span>
        </div>
        <div className="gitmsg__actions">
          {error.code === 'GIT_DIVERGED' && (
            <button type="button" className="button button--small" disabled={busy} onClick={() => void pull('merge')}>
              Pull with merge
            </button>
          )}
          <button type="button" className="button button--ghost button--small" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (notice !== null) {
    return (
      <div className="gitmsg gitmsg--ok" role="status">
        <pre className="gitmsg__details">{notice}</pre>
        <button type="button" className="button button--ghost button--small" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}

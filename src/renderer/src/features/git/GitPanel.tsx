import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { Pill } from '../../components/Pill';
import { useAppStore, type GitSection } from '../../stores/app.store';
import { useGithubStore } from '../../stores/github.store';
import { useGitStore } from '../../stores/git.store';
import { GithubSection } from '../github/GithubSection';
import { healthPill } from '../github/run-format';
import { RepositoryPanel } from '../repositories/RepositoryPanel';
import { ActivityView } from './ActivityView';
import { BranchesModal } from './BranchesModal';
import { GitWorkbench } from './GitWorkbench';

const LOCAL_SECTIONS: Array<{ key: GitSection; label: string }> = [
  { key: 'changes', label: 'Changes' },
  { key: 'activity', label: 'Activity' }
];

/**
 * The Git tab: everyday operations against one repository of the project at a time, and what GitHub says about
 * that same repository. Sections are grouped by where the information comes from.
 */
export function GitPanel(): React.JSX.Element {
  const projectId = useAppStore((state) => state.selectedProjectId);
  const repositories = useAppStore((state) => state.repositories);
  const requested = useAppStore((state) => state.requestedGitSection);
  const clearRequest = useAppStore((state) => state.clearGitSectionRequest);
  const repositoryId = useGitStore((state) => state.repositoryId);
  const selectRepository = useGitStore((state) => state.selectRepository);
  const loadGithubStatus = useGithubStore((state) => state.loadStatus);

  const [section, setSection] = useState<GitSection>('changes');
  const [branchesOpen, setBranchesOpen] = useState(false);

  // Keep the selection valid as repositories are added, removed, or the project changes.
  useEffect(() => {
    const stillExists = repositories.some((repository) => repository.id === repositoryId);
    if (!stillExists) void selectRepository(repositories[0]?.id ?? null);
  }, [repositories, repositoryId, selectRepository]);

  // Somebody asked for a section ("go to GitHub"): take it now, and clear the request so it is used once.
  if (requested !== null && requested !== section) setSection(requested);
  useEffect(() => {
    if (requested !== null) clearRequest();
  }, [requested, clearRequest]);

  // The account and its health feed the section labels, so they are known before a GitHub section is opened.
  useEffect(() => {
    if (projectId !== null) void loadGithubStatus(projectId);
  }, [projectId, loadGithubStatus]);

  if (repositories.length === 0) return <RepositoryPanel />;

  const local = section === 'changes' || section === 'activity';

  return (
    <div className="gitpanel">
      <GitToolbar onOpenBranches={() => setBranchesOpen(true)} />
      <SectionNav section={section} onSelect={setSection} />
      {local && <GitMessages />}
      <div className={`gitpanel__body${section === 'changes' ? ' gitpanel__body--fill' : ''}`}>
        {section === 'changes' && <GitWorkbench />}
        {section === 'activity' && <ActivityView />}
        {(section === 'pulls' || section === 'actions') && <GithubSection view={section} />}
      </div>
      {branchesOpen && <BranchesModal onClose={() => setBranchesOpen(false)} />}
    </div>
  );
}

/** Two groups with their own names, so it is clear which sections read the local clone and which ask GitHub. */
function SectionNav({ section, onSelect }: { section: GitSection; onSelect: (next: GitSection) => void }): React.JSX.Element {
  const projectId = useAppStore((state) => state.selectedProjectId);
  const connected = useGithubStore((state) => (projectId === null ? false : state.integrationByProject[projectId]?.status === 'connected'));
  const pulls = useGithubStore((state) => state.pulls);
  const pullsState = useGithubStore((state) => state.pullsState);
  const hasNext = useGithubStore((state) => state.hasNext);
  const health = useGithubStore((state) => state.health);
  const actionsHealth = healthPill(health?.status ?? 'unknown');
  const tab = (key: GitSection, label: string, extra?: React.ReactNode): React.JSX.Element => (
    <button key={key} type="button" className={`subtabs__tab${section === key ? ' subtabs__tab--active' : ''}`} onClick={() => onSelect(key)}>
      {label}
      {extra}
    </button>
  );

  return (
    <nav className="subtabs gitnav" aria-label="Git sections">
      <span className="gitnav__group">
        <Icon name="git" size={14} /> Local
      </span>
      {LOCAL_SECTIONS.map((item) => tab(item.key, item.label))}
      <span className="gitnav__divider" aria-hidden="true" />
      <span className="gitnav__group">
        <Icon name="github" size={14} /> GitHub
      </span>
      {tab(
        'pulls',
        'Pull requests',
        connected && pullsState === 'open' && pulls.length > 0 ? (
          <Pill tone="success">
            {pulls.length}
            {hasNext ? '+' : ''}
          </Pill>
        ) : null
      )}
      {tab('actions', 'Actions', connected && health !== null ? <Pill tone={actionsHealth.tone} icon={actionsHealth.icon}>{actionsHealth.label}</Pill> : null)}
    </nav>
  );
}

function GitToolbar({ onOpenBranches }: { onOpenBranches: () => void }): React.JSX.Element {
  const repositories = useAppStore((state) => state.repositories);
  const openSettings = useAppStore((state) => state.openSettings);
  const { repositoryId, status, busy } = useGitStore();
  // One repository for the whole tab: the GitHub sections follow this choice by themselves.
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
        <button
          type="button"
          className="iconbutton"
          title="Add or manage the project's repositories"
          aria-label="Manage repositories"
          onClick={() => openSettings('workspace')}
        >
          <Icon name="gear" size={15} />
        </button>

        {status !== null && (
          <>
            <button type="button" className="chip chip--primary gitbar__branch" title="Branches: switch, create or delete" onClick={onOpenBranches}>
              <Icon name="git" size={13} />
              {status.detached ? `detached @ ${status.head?.slice(0, 7) ?? '?'}` : (status.branch ?? 'no branch')}
              <Icon name="chevronDown" size={13} />
            </button>
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

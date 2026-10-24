import { useEffect, useState } from 'react';
import { EmptyState } from './components/EmptyState';
import { ErrorBanner } from './components/ErrorBanner';
import { Overview } from './features/overview/Overview';
import { NewProjectModal } from './features/projects/NewProjectModal';
import { ProjectSidebar } from './features/projects/ProjectSidebar';
import { GitPanel } from './features/git/GitPanel';
import { GithubPanel } from './features/github/GithubPanel';
import { SshPanel } from './features/ssh/SshPanel';
import { TerminalPanel } from './features/terminal/TerminalPanel';
import { PendingPanel } from './features/workspace/PendingPanel';
import { TabBar } from './features/workspace/TabBar';
import { WorkspaceSettings } from './features/workspace/WorkspaceSettings';
import type { TabKey } from '@shared/schemas/tabs';
import { useAppStore } from './stores/app.store';

function ActivePanel(): React.JSX.Element {
  const activeTabKey = useAppStore((state) => state.activeTabKey);

  return (
    <div key={activeTabKey ?? 'none'} className="enter enter--fill">
      <PanelFor tabKey={activeTabKey} />
    </div>
  );
}

function PanelFor({ tabKey }: { tabKey: TabKey | null }): React.JSX.Element {
  switch (tabKey) {
    case 'git':
      return <GitPanel />;
    case 'settings':
      return <WorkspaceSettings />;
    case 'terminal':
      return <TerminalPanel />;
    case 'ssh':
      return <SshPanel />;
    case 'github':
      return <GithubPanel />;
    case 'deployments':
      return (
        <PendingPanel
          title="Deployments"
          milestone="Milestone 7"
          description="Deploy targets that invoke an existing workflow or deploy command. Steward reports a deployment as succeeded only when the provider or exit code says so."
        />
      );
    default:
      return <EmptyState title="No tab selected" description="Every project keeps its Git tab." />;
  }
}

const COLLAPSED_KEY = 'steward.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function App(): React.JSX.Element {
  const initialize = useAppStore((state) => state.initialize);
  const error = useAppStore((state) => state.error);
  const dismissError = useAppStore((state) => state.dismissError);
  const busy = useAppStore((state) => state.busy);
  const appInfo = useAppStore((state) => state.appInfo);
  const projects = useAppStore((state) => state.projects);
  const selectedProjectId = useAppStore((state) => state.selectedProjectId);
  const tabs = useAppStore((state) => state.tabs);
  const view = useAppStore((state) => state.view);
  const [creating, setCreating] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const project = projects.find((candidate) => candidate.id === selectedProjectId) ?? null;

  return (
    <div className={`app${collapsed ? ' app--collapsed' : ''}`}>
      <ProjectSidebar
        onNewProject={() => setCreating(true)}
        collapsed={collapsed}
        onToggle={() =>
          setCollapsed((value) => {
            try {
              localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1');
            } catch {
              // The preference just won't persist.
            }
            return !value;
          })
        }
      />

      <main className="workspace">
        {error !== null && <ErrorBanner error={error} onDismiss={dismissError} />}

        {view === 'overview' || project === null ? (
          <div key="overview" className="workspace__body enter">
            <Overview onNewProject={() => setCreating(true)} />
          </div>
        ) : (
          <div key={project.id} className="workspace__project enter">
            <header className="workspace__header">
              <div>
                <h2 className="workspace__title">{project.name}</h2>
                <p className="workspace__subtitle">
                  {project.description ?? 'No description'} · {project.slug}
                </p>
              </div>
              {busy && <span className="workspace__busy">Working…</span>}
            </header>

            <TabBar tabs={tabs} />

            <div className="workspace__body">
              <ActivePanel />
            </div>
          </div>
        )}

        {creating && <NewProjectModal onClose={() => setCreating(false)} />}

        <footer className="statusbar">
          {appInfo === null ? (
            <span>Connecting to the main process…</span>
          ) : (
            <>
              <span>Steward {appInfo.appVersion}</span>
              <span>Electron {appInfo.electronVersion}</span>
              <span>Node {appInfo.nodeVersion}</span>
              <span>
                {appInfo.gitAvailable ? `Git ${appInfo.gitVersion ?? ''}`.trim() : 'Git not found'}
              </span>
              <span>
                {appInfo.databaseDriver} · schema v{appInfo.schemaVersion}
              </span>
            </>
          )}
        </footer>
      </main>
    </div>
  );
}

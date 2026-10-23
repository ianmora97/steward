import { useEffect } from 'react';
import { EmptyState } from './components/EmptyState';
import { ErrorBanner } from './components/ErrorBanner';
import { ProjectSidebar } from './features/projects/ProjectSidebar';
import { RepositoryPanel } from './features/repositories/RepositoryPanel';
import { PendingPanel } from './features/workspace/PendingPanel';
import { TabBar } from './features/workspace/TabBar';
import { WorkspaceSettings } from './features/workspace/WorkspaceSettings';
import { useAppStore } from './stores/app.store';

function ActivePanel(): React.JSX.Element {
  const activeTabKey = useAppStore((state) => state.activeTabKey);

  switch (activeTabKey) {
    case 'git':
      return <RepositoryPanel />;
    case 'settings':
      return <WorkspaceSettings />;
    case 'terminal':
      return (
        <PendingPanel
          title="Integrated terminal"
          milestone="Milestone 4"
          description="A real PTY session rooted at the project's repository, with session lifecycle and captured output. Not started yet, so there is nothing to show here."
        />
      );
    case 'ssh':
      return (
        <PendingPanel
          title="SSH connections"
          milestone="Milestone 5"
          description="Remote hosts connected through the system OpenSSH client, so your agent, ~/.ssh/config and keys are reused and Steward never stores private keys."
        />
      );
    case 'actions':
      return (
        <PendingPanel
          title="GitHub Actions"
          milestone="Milestone 6"
          description="Workflow runs, statuses and logs, read from the GitHub API. Connection health and workflow health are reported separately."
        />
      );
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

export function App(): React.JSX.Element {
  const initialize = useAppStore((state) => state.initialize);
  const error = useAppStore((state) => state.error);
  const dismissError = useAppStore((state) => state.dismissError);
  const busy = useAppStore((state) => state.busy);
  const appInfo = useAppStore((state) => state.appInfo);
  const projects = useAppStore((state) => state.projects);
  const selectedProjectId = useAppStore((state) => state.selectedProjectId);
  const tabs = useAppStore((state) => state.tabs);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const project = projects.find((candidate) => candidate.id === selectedProjectId) ?? null;

  return (
    <div className="app">
      <ProjectSidebar />

      <main className="workspace">
        {error !== null && <ErrorBanner error={error} onDismiss={dismissError} />}

        {project === null ? (
          <div className="workspace__body">
            <EmptyState
              title="Create your first project"
              description="A project is an application or system. It can own several repositories, environments and integrations — one project is not one repository."
            />
          </div>
        ) : (
          <>
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
          </>
        )}

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

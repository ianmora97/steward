import { useEffect, useState } from 'react';
import { EmptyState } from './components/EmptyState';
import { ErrorBanner } from './components/ErrorBanner';
import { PageHeader } from './components/PageHeader';
import { ToastViewport } from './components/Toast';
import { TooltipLayer } from './components/Tooltip';
import { useMediaQuery } from './components/useMediaQuery';
import { TopProgress } from './components/TopProgress';
import { Overview } from './features/overview/Overview';
import { NewProjectModal } from './features/projects/NewProjectModal';
import { ProjectSidebar } from './features/projects/ProjectSidebar';
import { DeploymentsPanel } from './features/deployments/DeploymentsPanel';
import { DockerPanel } from './features/docker/DockerPanel';
import { GitPanel } from './features/git/GitPanel';
import { MongoPanel } from './features/mongodb/MongoPanel';
import { RedisPanel } from './features/redis/RedisPanel';
import { SshPanel } from './features/ssh/SshPanel';
import { TerminalPanel } from './features/terminal/TerminalPanel';
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
    case 'github':
      return <GitPanel />;
    case 'settings':
      return <WorkspaceSettings />;
    case 'terminal':
      return <TerminalPanel />;
    case 'ssh':
      return <SshPanel />;
    case 'deployments':
      return <DeploymentsPanel />;
    case 'mongodb':
      return <MongoPanel />;
    case 'redis':
      return <RedisPanel />;
    case 'docker':
      return <DockerPanel />;
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
  const projects = useAppStore((state) => state.projects);
  const selectedProjectId = useAppStore((state) => state.selectedProjectId);
  const tabs = useAppStore((state) => state.tabs);
  const view = useAppStore((state) => state.view);
  const [creating, setCreating] = useState(false);
  const [collapsedByUser, setCollapsed] = useState(readCollapsed);
  // Too little room (a small window, or a high zoom) folds the sidebar to icons whatever was chosen.
  const narrow = useMediaQuery('(max-width: 900px)');
  const collapsed = collapsedByUser || narrow;

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const project = projects.find((candidate) => candidate.id === selectedProjectId) ?? null;

  return (
    <div className={`app${collapsed ? ' app--collapsed' : ''}`}>
      <TopProgress active={busy} />
      <ToastViewport />
      <TooltipLayer />
      <ProjectSidebar
        onNewProject={() => setCreating(true)}
        collapsed={collapsed}
        onToggle={() => {
          // Folded by lack of room, not by choice: leave the saved preference alone.
          if (narrow) return;
          setCollapsed((value) => {
            try {
              localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1');
            } catch {
              // The preference just won't persist.
            }
            return !value;
          });
        }}
      />

      <main className="workspace">
        {error !== null && <ErrorBanner error={error} onDismiss={dismissError} />}

        {view === 'overview' || project === null ? (
          <div key="overview" className="workspace__body enter">
            <Overview onNewProject={() => setCreating(true)} />
          </div>
        ) : (
          <div key={project.id} className="workspace__project enter">
            <div className="workspace__header">
              <PageHeader title={project.name} subtitle={`${project.description ?? 'No description'} · ${project.slug}`} />
            </div>

            <TabBar tabs={tabs} />

            <div className="workspace__body">
              <ActivePanel />
            </div>
          </div>
        )}

        {creating && <NewProjectModal onClose={() => setCreating(false)} />}
      </main>
    </div>
  );
}

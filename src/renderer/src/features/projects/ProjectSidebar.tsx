import { useState } from 'react';
import { useAppStore } from '../../stores/app.store';
import { Icon } from '../../components/Icon';
import { DEFAULT_PROJECT_COLOR, inkOn, ProjectAvatar } from '../../components/ProjectAvatar';
import logo from '@assets/images/steward_logo.png';
import { IconButton } from '../../components/IconButton';
import { ReleaseNotes } from './ReleaseNotes';

/**
 * Projects are Steward's root entity: a project owns repositories, tabs and —
 * from later milestones — integrations, environments and execution history.
 * The sidebar is navigation only; creating and deleting projects lives in the overview.
 */
export function ProjectSidebar({
  onNewProject,
  collapsed,
  onToggle
}: {
  onNewProject: () => void;
  collapsed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const projects = useAppStore((state) => state.projects);
  const selectedProjectId = useAppStore((state) => state.selectedProjectId);
  const view = useAppStore((state) => state.view);
  const showOverview = useAppStore((state) => state.showOverview);
  const selectProject = useAppStore((state) => state.selectProject);
  const appInfo = useAppStore((state) => state.appInfo);
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <header className="sidebar__header">
        <img className="sidebar__logo" src={logo} alt="" width={36} height={38} />
        <div className="sidebar__titles">
          <h1 className="sidebar__brand">Steward</h1>
          <p className="sidebar__tagline">Infrastructure Ops</p>
        </div>
        <IconButton icon="panel" size={16} label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggle} />
      </header>

      <nav className="sidebar__nav" aria-label="Main">
        <button
          type="button"
          className={`navitem${view === 'overview' ? ' navitem--active' : ''}`}
          onClick={showOverview}
          title="Overview"
        >
          <Icon name="overview" />
          <span className="navitem__text">Overview</span>
        </button>
      </nav>

      <div className="sidebar__section">
        <span className="sidebar__label">Projects</span>
        <IconButton icon="plus" label="New project" size={14} onClick={onNewProject} />
      </div>

      <nav className="sidebar__nav sidebar__projects" aria-label="Projects">
        {projects.length === 0 && <p className="sidebar__hint">No projects yet.</p>}
        {projects.map((project) => {
          const active = view === 'project' && project.id === selectedProjectId;
          const accent = project.color ?? DEFAULT_PROJECT_COLOR;
          return (
            <button
              key={project.id}
              type="button"
              className={`navitem${active ? ' navitem--active' : ''}`}
              style={{ ['--nav-accent' as string]: accent, ['--nav-ink' as string]: inkOn(accent) }}
              onClick={() => void selectProject(project.id)}
              title={project.name}
            >
              <ProjectAvatar icon={project.icon} color={project.color} size={22} />
              <span className="navitem__text">{project.name}</span>
            </button>
          );
        })}
      </nav>

      <footer className="sidebar__footer">
        <span className="sidebar__version">Steward {appInfo?.appVersion ?? ''}</span>
        <IconButton icon="sparkles" size={15} label="Release notes" onClick={() => setNotesOpen(true)} />
      </footer>
      {notesOpen && <ReleaseNotes version={appInfo?.appVersion ?? null} onClose={() => setNotesOpen(false)} />}
    </aside>
  );
}

import { useAppStore } from '../../stores/app.store';
import { Icon } from '../../components/Icon';
import { ProjectAvatar } from '../../components/ProjectAvatar';
import logo from '@assets/images/steward_logo.png';

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

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <header className="sidebar__header">
        <img className="sidebar__logo" src={logo} alt="" width={36} height={38} />
        <div className="sidebar__titles">
          <h1 className="sidebar__brand">Steward</h1>
          <p className="sidebar__tagline">Infrastructure Ops</p>
        </div>
        <button
          type="button"
          className="iconbutton sidebar__toggle"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <Icon name="panel" />
        </button>
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
        <button type="button" className="iconbutton" onClick={onNewProject} aria-label="New project" title="New project">
          <Icon name="plus" size={14} />
        </button>
      </div>

      <nav className="sidebar__nav sidebar__projects" aria-label="Projects">
        {projects.length === 0 && <p className="sidebar__hint">No projects yet.</p>}
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className={`navitem${view === 'project' && project.id === selectedProjectId ? ' navitem--active' : ''}`}
            onClick={() => void selectProject(project.id)}
            title={project.name}
          >
            <ProjectAvatar icon={project.icon} color={project.color} size={22} />
            <span className="navitem__text">{project.name}</span>
          </button>
        ))}
      </nav>

      <footer className="sidebar__footer">
        <span>Steward {appInfo?.appVersion ?? ''}</span>
      </footer>
    </aside>
  );
}

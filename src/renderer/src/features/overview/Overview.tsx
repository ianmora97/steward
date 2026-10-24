import { useEffect, useState } from 'react';
import type { Project } from '@shared/schemas/project';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { useAppStore } from '../../stores/app.store';
import { useTerminalStore } from '../../stores/terminal.store';

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60]
];

function timeAgo(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

function Stat({ label, value }: { label: string; value: string | number }): React.JSX.Element {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
    </div>
  );
}

function ProjectCard({
  project,
  index,
  onDelete
}: {
  project: Project;
  index: number;
  onDelete: () => void;
}): React.JSX.Element {
  const repositories = useAppStore((state) => state.repositoriesByProject[project.id]);
  const selectProject = useAppStore((state) => state.selectProject);
  const [vpcCount, setVpcCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void window.steward.ssh.list({ projectId: project.id }).then((result) => {
      if (!cancelled && result.success) setVpcCount(result.data.length);
    });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const githubCount = (repositories ?? []).filter((repository) => repository.provider === 'github').length;
  const otherCount = (repositories ?? []).length - githubCount;

  return (
    <article className="projectcard" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <div className="projectcard__head">
        <div>
          <h3 className="projectcard__name">{project.name}</h3>
          <p className="projectcard__desc">{project.description ?? 'No description'}</p>
        </div>
        <button
          type="button"
          className="iconbutton iconbutton--danger"
          onClick={onDelete}
          aria-label={`Delete ${project.name}`}
          title="Delete project"
        >
          <Icon name="trash" />
        </button>
      </div>

      <div className="chips">
        {(repositories ?? []).length === 0 && <span className="pill pill--dim">No repositories</span>}
        {githubCount > 0 && (
          <span className="pill" title={(repositories ?? []).filter((r) => r.provider === 'github').map((r) => r.name).join(', ')}>
            <Icon name="github" size={14} />
            GitHub ({githubCount})
          </span>
        )}
        {otherCount > 0 && (
          <span className="pill" title={(repositories ?? []).filter((r) => r.provider !== 'github').map((r) => r.name).join(', ')}>
            <Icon name="repo" size={14} />
            Repositories ({otherCount})
          </span>
        )}
        {vpcCount > 0 && (
          <span className="pill">
            <Icon name="ssh" size={14} />
            VPC ({vpcCount})
          </span>
        )}
      </div>

      <div className="projectcard__foot">
        <span className="projectcard__time">
          <Icon name="clock" size={14} />
          Updated {timeAgo(project.updatedAt)}
        </span>
        <button type="button" className="button" onClick={() => void selectProject(project.id)}>
          Manage
          <Icon name="chevronRight" size={14} />
        </button>
      </div>
    </article>
  );
}

export function Overview({ onNewProject }: { onNewProject: () => void }): React.JSX.Element {
  const projects = useAppStore((state) => state.projects);
  const repositoriesByProject = useAppStore((state) => state.repositoriesByProject);
  const appInfo = useAppStore((state) => state.appInfo);
  const deleteProject = useAppStore((state) => state.deleteProject);
  const sessionsByProject = useTerminalStore((state) => state.sessionsByProject);

  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<Project | null>(null);

  const needle = query.trim().toLowerCase();
  const visible = projects.filter(
    (project) =>
      needle === '' ||
      project.name.toLowerCase().includes(needle) ||
      (project.description ?? '').toLowerCase().includes(needle)
  );

  const repositoryCount = Object.values(repositoriesByProject).reduce((sum, list) => sum + list.length, 0);
  const terminalCount = Object.values(sessionsByProject).reduce(
    (sum, list) => sum + list.filter((session) => session.status === 'running').length,
    0
  );

  return (
    <div className="overview">
      <header className="overview__header">
        <div>
          <h2 className="overview__title">Projects</h2>
          <p className="overview__subtitle">Manage your repositories, terminals and integrations</p>
        </div>
        <div className="overview__tools">
          <label className="searchbox">
            <Icon name="search" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects…"
              aria-label="Search projects"
            />
          </label>
          <button type="button" className="button button--primary" onClick={onNewProject}>
            <Icon name="plus" />
            New Project
          </button>
        </div>
      </header>

      <section className="stats" aria-label="Summary">
        <Stat label="Total projects" value={projects.length} />
        <Stat label="Repositories" value={repositoryCount} />
        <Stat label="Open terminals" value={terminalCount} />
        <Stat
          label="Git"
          value={appInfo === null ? '…' : appInfo.gitAvailable ? (appInfo.gitVersion ?? 'Available') : 'Not found'}
        />
      </section>

      {projects.length === 0 ? (
        <EmptyState
          title="Create your first project"
          description="A project is an application or system. It can own several repositories, environments and integrations — one project is not one repository."
        />
      ) : visible.length === 0 ? (
        <EmptyState title="No matches" description={`No project matches “${query.trim()}”.`} />
      ) : (
        <div className="projectlist">
          {visible.map((project, index) => (
            <ProjectCard key={project.id} project={project} index={index} onDelete={() => setDeleting(project)} />
          ))}
        </div>
      )}

      {deleting !== null && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete project"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const id = deleting.id;
            setDeleting(null);
            void deleteProject(id);
          }}
        >
          <p>It is removed from Steward. Its repository folders on disk are left untouched.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

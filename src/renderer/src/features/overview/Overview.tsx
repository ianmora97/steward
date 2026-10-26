import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ActivityEntry, OverviewProject } from '@shared/schemas/overview';
import type { Project } from '@shared/schemas/project';
import { OPTIONAL_TAB_KEYS, type TabKey } from '@shared/schemas/tabs';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { Pill } from '../../components/Pill';
import { ProjectAvatar } from '../../components/ProjectAvatar';
import { useAppStore } from '../../stores/app.store';
import { useTerminalStore } from '../../stores/terminal.store';
import { ACTIVITY_STATUS, activityKind, timeAgo } from './overview-meta';
import { ServicePills, servicePills } from './ServicePills';
import './overview.css';

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }): React.JSX.Element {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {hint !== undefined && <span className="stat__hint">{hint}</span>}
    </div>
  );
}

/** Opens a project on one of its services, adding that service to the tab bar when the project had taken it off. */
function useOpenService(): (projectId: string, target: { tab: TabKey } | { git: 'pulls' }) => Promise<void> {
  const selectProject = useAppStore((state) => state.selectProject);
  return useCallback(
    async (projectId, target) => {
      await selectProject(projectId);
      const store = useAppStore.getState();
      if ('git' in target) {
        store.openGitSection(target.git);
        return;
      }
      const onBar = store.tabs.some((tab) => tab.tabKey === target.tab && tab.visible);
      if (!onBar && OPTIONAL_TAB_KEYS.includes(target.tab)) await store.setTabVisibility(target.tab, true);
      useAppStore.getState().setActiveTab(target.tab);
    },
    [selectProject]
  );
}

function ProjectCard({
  project,
  summary,
  index,
  onDelete
}: {
  project: Project;
  summary: OverviewProject | undefined;
  index: number;
  onDelete: () => void;
}): React.JSX.Element {
  const selectProject = useAppStore((state) => state.selectProject);
  const open = useOpenService();
  const pills = summary === undefined ? [] : servicePills(summary);

  return (
    <article className="projectcard" style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}>
      <div className="projectcard__head">
        <div className="projectcard__identity">
          <ProjectAvatar icon={project.icon} color={project.color} size={40} />
          <div>
            <h3 className="projectcard__name">{project.name}</h3>
            <p className="projectcard__desc">{project.description ?? 'No description'}</p>
          </div>
        </div>
        <button type="button" className="iconbutton iconbutton--danger" onClick={onDelete} aria-label={`Delete ${project.name}`} title="Delete project">
          <Icon name="trash" />
        </button>
      </div>

      {summary === undefined ? (
        <span className="pill pill--dim">Reading services…</span>
      ) : pills.length === 0 ? (
        <span className="pill pill--dim">Nothing configured yet</span>
      ) : (
        <ServicePills pills={pills} onOpen={(target) => void open(project.id, target)} />
      )}

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

function RecentActivity({ entries, onOpen, onRefresh }: { entries: ActivityEntry[] | null; onOpen: (entry: ActivityEntry) => void; onRefresh: () => void }): React.JSX.Element {
  return (
    <aside className="activity" aria-label="Recent activity">
      <header className="activity__head">
        <h3 className="activity__title">Recent activity</h3>
        <button type="button" className="iconbutton" onClick={onRefresh} aria-label="Refresh activity" title="Refresh">
          <Icon name="refresh" size={15} />
        </button>
      </header>
      {entries === null && <p className="card__hint">Reading the activity…</p>}
      {entries !== null && entries.length === 0 && (
        <p className="card__hint">Nothing yet. Commits, pushes, SSH commands, Docker actions and database writes show up here.</p>
      )}
      <ul className="activity__list">
        {(entries ?? []).map((entry) => {
          const kind = activityKind(entry.kind);
          const status = ACTIVITY_STATUS[entry.status];
          return (
            <li key={entry.id}>
              <button type="button" className="activity__item" onClick={() => onOpen(entry)}>
                <span className="activity__icon">
                  <Icon name={kind.icon} size={15} />
                </span>
                <span className="activity__text">
                  <span className="activity__summary dpmono" title={entry.summary}>
                    {entry.summary}
                  </span>
                  <span className="activity__meta">
                    {entry.projectName} · {kind.label} · {timeAgo(entry.startedAt)}
                  </span>
                </span>
                <Pill tone={status.tone}>{status.label}</Pill>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export function Overview({ onNewProject }: { onNewProject: () => void }): React.JSX.Element {
  const projects = useAppStore((state) => state.projects);
  const deleteProject = useAppStore((state) => state.deleteProject);
  const sessionsByProject = useTerminalStore((state) => state.sessionsByProject);
  const open = useOpenService();

  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [summaries, setSummaries] = useState<OverviewProject[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [activityVersion, setActivityVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void window.steward.overview.summary().then((result) => {
      if (!cancelled && result.success) setSummaries(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [projects]);

  useEffect(() => {
    let cancelled = false;
    void window.steward.overview.activity().then((result) => {
      if (cancelled) return;
      setActivity(result.success ? result.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [projects, activityVersion]);

  const needle = query.trim().toLowerCase();
  const visible = projects.filter(
    (project) => needle === '' || project.name.toLowerCase().includes(needle) || (project.description ?? '').toLowerCase().includes(needle)
  );

  const totals = useMemo(() => {
    const sum = { repositories: 0, vpc: 0, reachable: 0, databases: 0 };
    for (const item of summaries ?? []) {
      sum.repositories += item.repositories;
      sum.vpc += item.vpc.total;
      sum.reachable += item.vpc.reachable;
      sum.databases += item.mongodb.total + item.redis.total;
    }
    return sum;
  }, [summaries]);

  const terminalCount = Object.values(sessionsByProject).reduce((sum, list) => sum + list.filter((session) => session.status === 'running').length, 0);
  const summaryOf = (projectId: string): OverviewProject | undefined => summaries?.find((item) => item.projectId === projectId);

  return (
    <div className="overview">
      <header className="overview__header">
        <div>
          <h2 className="overview__title">Projects</h2>
          <p className="overview__subtitle">Everything each project is connected to, and what happened lately</p>
        </div>
        <div className="overview__tools">
          <label className="searchbox">
            <Icon name="search" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects…" aria-label="Search projects" />
          </label>
          <button type="button" className="button button--primary" onClick={onNewProject}>
            <Icon name="plus" />
            New Project
          </button>
        </div>
      </header>

      <section className="stats" aria-label="Summary">
        <Stat label="Projects" value={projects.length} />
        <Stat label="Repositories" value={totals.repositories} />
        <Stat label="VPC reachable" value={totals.vpc === 0 ? '—' : `${totals.reachable} / ${totals.vpc}`} hint={totals.vpc === 0 ? 'No connections yet' : 'From the last check'} />
        <Stat label="Database connections" value={totals.databases} hint="MongoDB and Redis" />
        <Stat label="Open terminals" value={terminalCount} />
      </section>

      {projects.length === 0 ? (
        <EmptyState title="Create your first project" description="A project is an application or system. It can own several repositories, environments and integrations — one project is not one repository." />
      ) : (
        <div className="ovgrid">
          <div className="projectlist">
            {visible.length === 0 ? (
              <EmptyState title="No matches" description={`No project matches “${query.trim()}”.`} />
            ) : (
              visible.map((project, index) => (
                <ProjectCard key={project.id} project={project} summary={summaryOf(project.id)} index={index} onDelete={() => setDeleting(project)} />
              ))
            )}
          </div>
          <RecentActivity
            entries={activity}
            onRefresh={() => setActivityVersion((value) => value + 1)}
            onOpen={(entry) => void open(entry.projectId, { tab: activityKind(entry.kind).tab })}
          />
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

import type { ActivityEntry, DataSummary, OverviewProject } from '@shared/schemas/overview';
import type { TabKey } from '@shared/schemas/tabs';
import type { SqlDatabase } from '../db/driver';
import { listProjects } from '../db/project.repo';
import type { SshService } from './ssh.service';

const ACTIVITY_LIMIT = 15;
/** Looked at before filtering: Git alone writes a row for every status refresh. */
const ACTIVITY_WINDOW = 400;
const SUMMARY_MAX = 90;

/** Rows that say "the user did something", not "Steward looked": shells and connection checks are left out. */
const QUIET_KINDS = new Set(['local_command', 'ssh_shell', 'ssh_test']);
const GIT_CHANGES = new Set(['commit', 'push', 'pull', 'fetch', 'merge', 'checkout', 'switch', 'branch', 'reset', 'restore', 'add', 'rebase', 'cherry-pick', 'stash', 'tag']);

function emptyData(): DataSummary {
  return { total: 0, readOnly: 0, connectedBefore: 0 };
}

function clip(text: string): string {
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text;
}

interface ExecutionJoin {
  id: string;
  project_id: string;
  project_name: string;
  kind: string;
  command: string;
  args_json: string;
  status: ActivityEntry['status'];
  started_at: string;
}

export interface OverviewService {
  summary: () => OverviewProject[];
  activity: () => ActivityEntry[];
}

export function createOverviewService(deps: { db: SqlDatabase; ssh: SshService }): OverviewService {
  const { db, ssh } = deps;

  function summary(): OverviewProject[] {
    const projects = listProjects(db, false);

    const repositories = new Map<string, { total: number; github: number }>();
    for (const row of db
      .prepare(`SELECT project_id, COUNT(*) AS total, SUM(CASE WHEN provider = 'github' THEN 1 ELSE 0 END) AS github FROM repositories GROUP BY project_id`)
      .all<{ project_id: string; total: number; github: number }>()) {
      repositories.set(row.project_id, { total: row.total, github: row.github });
    }

    const github = new Map<string, OverviewProject['github']>();
    for (const row of db
      .prepare(`SELECT project_id, connection_status FROM integrations WHERE kind = 'github'`)
      .all<{ project_id: string; connection_status: OverviewProject['github'] }>()) {
      github.set(row.project_id, row.connection_status);
    }

    const targets = new Map<string, number>();
    for (const row of db.prepare('SELECT project_id, COUNT(*) AS total FROM deploy_targets GROUP BY project_id').all<{ project_id: string; total: number }>()) {
      targets.set(row.project_id, row.total);
    }

    const data = new Map<string, { mongodb: DataSummary; redis: DataSummary }>();
    for (const row of db
      .prepare(
        `SELECT project_id, kind, COUNT(*) AS total, SUM(read_only) AS read_only,
                SUM(CASE WHEN last_connected_at IS NULL THEN 0 ELSE 1 END) AS connected_before
           FROM data_connections GROUP BY project_id, kind`
      )
      .all<{ project_id: string; kind: 'mongodb' | 'redis'; total: number; read_only: number; connected_before: number }>()) {
      const entry = data.get(row.project_id) ?? { mongodb: emptyData(), redis: emptyData() };
      entry[row.kind] = { total: row.total, readOnly: row.read_only, connectedBefore: row.connected_before };
      data.set(row.project_id, entry);
    }

    const tabs = new Map<string, TabKey[]>();
    for (const row of db
      .prepare('SELECT project_id, tab_key FROM workspace_tabs WHERE visible = 1 ORDER BY position')
      .all<{ project_id: string; tab_key: TabKey }>()) {
      tabs.set(row.project_id, [...(tabs.get(row.project_id) ?? []), row.tab_key]);
    }

    return projects.map((project) => {
      const vpc = { total: 0, reachable: 0, attention: 0, down: 0, untested: 0 };
      // The hosts carry the outcome of their last check; reading them is a database read, not an ssh call.
      for (const host of ssh.list({ projectId: project.id })) {
        vpc.total += 1;
        switch (host.connection.state) {
          case 'connected':
            vpc.reachable += 1;
            break;
          case 'auth_failed':
          case 'host_key_unknown':
          case 'host_key_changed':
            vpc.attention += 1;
            break;
          case 'unreachable':
          case 'timeout':
          case 'error':
            vpc.down += 1;
            break;
          default:
            vpc.untested += 1;
        }
      }
      const repos = repositories.get(project.id) ?? { total: 0, github: 0 };
      const databases = data.get(project.id) ?? { mongodb: emptyData(), redis: emptyData() };
      return {
        projectId: project.id,
        repositories: repos.total,
        githubRepositories: repos.github,
        github: github.get(project.id) ?? 'unconfigured',
        vpc,
        deployTargets: targets.get(project.id) ?? 0,
        mongodb: databases.mongodb,
        redis: databases.redis,
        tabs: tabs.get(project.id) ?? []
      };
    });
  }

  function activity(): ActivityEntry[] {
    const rows = db
      .prepare(
        `SELECT e.id, e.project_id, p.name AS project_name, e.kind, e.command, e.args_json, e.status, e.started_at
           FROM executions e JOIN projects p ON p.id = e.project_id
          WHERE p.archived_at IS NULL
          ORDER BY e.started_at DESC
          LIMIT :limit`
      )
      .all<ExecutionJoin>({ limit: ACTIVITY_WINDOW });

    const entries: ActivityEntry[] = [];
    for (const row of rows) {
      if (QUIET_KINDS.has(row.kind)) continue;
      const args = JSON.parse(row.args_json) as string[];
      if (row.kind === 'git_op' && !GIT_CHANGES.has(args[0] ?? '')) continue;
      entries.push({
        id: row.id,
        projectId: row.project_id,
        projectName: row.project_name,
        kind: row.kind,
        summary: clip([row.command, ...args].join(' ')),
        status: row.status,
        startedAt: row.started_at
      });
      if (entries.length === ACTIVITY_LIMIT) break;
    }
    return entries;
  }

  return { summary, activity };
}

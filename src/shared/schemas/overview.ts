import type { TabKey } from './tabs';

/** What the home screen knows about one project's services. Everything comes from what Steward stored: nothing here opens a network connection. */
export interface OverviewProject {
  projectId: string;
  repositories: number;
  githubRepositories: number;
  /** The stored state of the project's GitHub connection. */
  github: 'unconfigured' | 'connected' | 'auth_error' | 'unreachable';
  /** SSH connections by what their last check said. */
  vpc: { total: number; reachable: number; attention: number; down: number; untested: number };
  deployTargets: number;
  mongodb: DataSummary;
  redis: DataSummary;
  /** The services this project has on its tab bar. */
  tabs: TabKey[];
}

export interface DataSummary {
  total: number;
  /** Connections Steward refuses to write through. */
  readOnly: number;
  /** Connections that have connected at least once. */
  connectedBefore: number;
}

/** One thing Steward did, in any project. */
export interface ActivityEntry {
  id: string;
  projectId: string;
  projectName: string;
  kind: string;
  /** A short line: what ran. Arguments are the ones already stored (secrets were redacted when recorded). */
  summary: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';
  startedAt: string;
}

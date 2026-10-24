import type {
  Deployment,
  DeploymentSource,
  DeploymentStatus
} from '@shared/schemas/deployments';
import type { SqlDatabase } from './driver';
import { nowIso } from './id';

interface DeploymentRow {
  id: string;
  project_id: string;
  environment_id: string;
  environment_name: string;
  deploy_target_id: string | null;
  target_name: string;
  target_kind: Deployment['targetKind'];
  repository_id: string | null;
  execution_id: string | null;
  ref: string | null;
  commit_sha: string | null;
  status: DeploymentStatus;
  status_source: DeploymentSource | null;
  run_id: number | null;
  run_url: string | null;
  requested_at: string;
  finished_at: string | null;
  notes: string | null;
}

const SELECT_DEPLOYMENT = `SELECT d.*, e.name AS environment_name
                             FROM deployments d JOIN environments e ON e.id = d.environment_id`;

function toDeployment(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    environmentName: row.environment_name,
    deployTargetId: row.deploy_target_id,
    targetName: row.target_name,
    targetKind: row.target_kind,
    repositoryId: row.repository_id,
    executionId: row.execution_id,
    ref: row.ref,
    commitSha: row.commit_sha,
    status: row.status,
    statusSource: row.status_source,
    runId: row.run_id,
    runUrl: row.run_url,
    requestedAt: row.requested_at,
    finishedAt: row.finished_at,
    notes: row.notes
  };
}

/** The fields a new deployment starts with; everything else begins empty. */
export interface NewDeployment {
  id: string;
  projectId: string;
  environmentId: string;
  deployTargetId: string;
  targetName: string;
  targetKind: Deployment['targetKind'];
  repositoryId: string | null;
  ref: string | null;
  requestedAt: string;
}

export function insertDeployment(db: SqlDatabase, deployment: NewDeployment): void {
  db.prepare(
    `INSERT INTO deployments (id, project_id, environment_id, deploy_target_id, target_name, target_kind,
                              repository_id, ref, status, requested_at)
     VALUES (:id, :project_id, :environment_id, :deploy_target_id, :target_name, :target_kind,
             :repository_id, :ref, 'requested', :requested_at)`
  ).run({
    id: deployment.id,
    project_id: deployment.projectId,
    environment_id: deployment.environmentId,
    deploy_target_id: deployment.deployTargetId,
    target_name: deployment.targetName,
    target_kind: deployment.targetKind,
    repository_id: deployment.repositoryId,
    ref: deployment.ref,
    requested_at: deployment.requestedAt
  });
}

export function findDeploymentById(db: SqlDatabase, id: string): Deployment | null {
  const row = db.prepare(`${SELECT_DEPLOYMENT} WHERE d.id = :id`).get<DeploymentRow>({ id });
  return row === undefined ? null : toDeployment(row);
}

export function listDeploymentsByProject(db: SqlDatabase, projectId: string, limit: number): Deployment[] {
  return db
    .prepare(`${SELECT_DEPLOYMENT} WHERE d.project_id = :project_id ORDER BY d.requested_at DESC, d.id DESC LIMIT :limit`)
    .all<DeploymentRow>({ project_id: projectId, limit })
    .map(toDeployment);
}

/** A target runs one deployment at a time: this is the one that blocks the next. */
export function findActiveDeploymentForTarget(db: SqlDatabase, targetId: string): Deployment | null {
  const row = db
    .prepare(`${SELECT_DEPLOYMENT} WHERE d.deploy_target_id = :target_id AND d.status IN ('requested', 'in_progress') LIMIT 1`)
    .get<DeploymentRow>({ target_id: targetId });
  return row === undefined ? null : toDeployment(row);
}

/** Whether some deployment already follows this run: one run can only ever belong to one deployment. */
export function isRunClaimed(db: SqlDatabase, runId: number): boolean {
  return (
    db.prepare('SELECT 1 AS found FROM deployments WHERE run_id = :run_id LIMIT 1').get<{ found: number }>({
      run_id: runId
    }) !== undefined
  );
}

/** Every deployment still waiting for an outcome, in any project: what a restart has to deal with. */
export function listActiveDeployments(db: SqlDatabase): Deployment[] {
  return db
    .prepare(`${SELECT_DEPLOYMENT} WHERE d.status IN ('requested', 'in_progress') ORDER BY d.requested_at, d.id`)
    .all<DeploymentRow>()
    .map(toDeployment);
}

/**
 * Progress while a deployment runs. `status` can only be one of the two open
 * states here: a deployment is closed through `settleDeployment`, so the
 * evidence rule has exactly one place to be enforced.
 */
export interface DeploymentPatch {
  status?: 'requested' | 'in_progress';
  executionId?: string;
  commitSha?: string;
  runId?: number;
  runUrl?: string;
  notes?: string;
}

const PATCH_COLUMNS = {
  status: 'status',
  executionId: 'execution_id',
  commitSha: 'commit_sha',
  runId: 'run_id',
  runUrl: 'run_url',
  notes: 'notes'
} as const;

/** Only touches a deployment that is still open, so a late progress report never reopens a settled one. */
export function updateDeployment(db: SqlDatabase, id: string, patch: DeploymentPatch): void {
  const assignments: string[] = [];
  const params: Record<string, string | number | null> = { id };
  for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
    const value = patch[key as keyof DeploymentPatch];
    if (value === undefined) continue;
    assignments.push(`${column} = :${column}`);
    params[column] = value;
  }
  if (assignments.length === 0) return;
  db.prepare(
    `UPDATE deployments SET ${assignments.join(', ')} WHERE id = :id AND status IN ('requested', 'in_progress')`
  ).run(params);
}

/**
 * How a deployment ended. `succeeded` cannot be expressed without its source:
 * the type is the rule that Steward never claims success it cannot vouch for.
 */
export type SettleOutcome =
  | { status: 'succeeded'; source: DeploymentSource; notes?: string | null }
  | { status: 'failed' | 'cancelled' | 'unknown'; source?: DeploymentSource | null; notes: string | null };

/** Closes an open deployment. Returns false when it was already closed, so the first outcome stands. */
export function settleDeployment(db: SqlDatabase, id: string, outcome: SettleOutcome): boolean {
  const result = db
    .prepare(
      `UPDATE deployments
          SET status = :status, status_source = :status_source, notes = COALESCE(:notes, notes),
              finished_at = :finished_at
        WHERE id = :id AND status IN ('requested', 'in_progress')`
    )
    .run({
      id,
      status: outcome.status,
      status_source: outcome.source ?? null,
      notes: outcome.notes ?? null,
      finished_at: nowIso()
    });
  return result.changes > 0;
}

/** Marks the execution row a deploy produced as belonging to its environment and target. */
export function linkExecutionToDeploy(
  db: SqlDatabase,
  executionId: string,
  environmentId: string,
  targetId: string
): void {
  db.prepare('UPDATE executions SET environment_id = :environment_id, deploy_target_id = :target_id WHERE id = :id').run({
    id: executionId,
    environment_id: environmentId,
    target_id: targetId
  });
}

/** An execution the app was closed in the middle of would otherwise stay "running" forever. */
export function closeInterruptedExecution(db: SqlDatabase, executionId: string, message: string): void {
  db.prepare(
    `UPDATE executions
        SET status = 'failed', finished_at = :finished_at, error_code = 'INTERRUPTED', error_message = :message
      WHERE id = :id AND finished_at IS NULL`
  ).run({ id: executionId, finished_at: nowIso(), message });
}

export function findExecutionLogPath(db: SqlDatabase, executionId: string): string | null {
  const row = db
    .prepare('SELECT log_path FROM executions WHERE id = :id')
    .get<{ log_path: string | null }>({ id: executionId });
  return row?.log_path ?? null;
}

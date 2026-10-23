import type { Execution } from '@shared/schemas/git';
import type { SqlDatabase } from './driver';

interface ExecutionRow {
  id: string;
  project_id: string;
  repository_id: string | null;
  kind: string;
  context: Execution['context'];
  command: string;
  args_json: string;
  cwd: string | null;
  status: Execution['status'];
  exit_code: number | null;
  confirmed_by_user: number;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_code: string | null;
  error_message: string | null;
}

function toExecution(row: ExecutionRow): Execution {
  return {
    id: row.id,
    projectId: row.project_id,
    repositoryId: row.repository_id,
    kind: row.kind,
    context: row.context,
    command: row.command,
    args: JSON.parse(row.args_json) as string[],
    cwd: row.cwd,
    status: row.status,
    exitCode: row.exit_code,
    confirmedByUser: row.confirmed_by_user === 1,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    errorCode: row.error_code,
    errorMessage: row.error_message
  };
}

export function insertExecution(db: SqlDatabase, execution: Execution): void {
  db.prepare(
    `INSERT INTO executions (id, project_id, repository_id, kind, context, command, args_json, cwd, status,
                             exit_code, confirmed_by_user, started_at, finished_at, duration_ms,
                             error_code, error_message)
     VALUES (:id, :project_id, :repository_id, :kind, :context, :command, :args_json, :cwd, :status,
             :exit_code, :confirmed_by_user, :started_at, :finished_at, :duration_ms,
             :error_code, :error_message)`
  ).run({
    id: execution.id,
    project_id: execution.projectId,
    repository_id: execution.repositoryId,
    kind: execution.kind,
    context: execution.context,
    command: execution.command,
    args_json: JSON.stringify(execution.args),
    cwd: execution.cwd,
    status: execution.status,
    exit_code: execution.exitCode,
    confirmed_by_user: execution.confirmedByUser ? 1 : 0,
    started_at: execution.startedAt,
    finished_at: execution.finishedAt,
    duration_ms: execution.durationMs,
    error_code: execution.errorCode,
    error_message: execution.errorMessage
  });
}

export function listExecutionsByRepository(db: SqlDatabase, repositoryId: string, limit: number): Execution[] {
  return db
    .prepare(
      `SELECT * FROM executions WHERE repository_id = :repository_id
        ORDER BY started_at DESC, id DESC LIMIT :limit`
    )
    .all<ExecutionRow>({ repository_id: repositoryId, limit })
    .map(toExecution);
}

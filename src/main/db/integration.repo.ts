import type { SqlDatabase } from './driver';

export type IntegrationKind = 'github';
export type ConnectionStatus = 'unconfigured' | 'connected' | 'auth_error' | 'unreachable';

export interface IntegrationConfig {
  login: string | null;
  scopes: string[];
  apiBase: string;
}

export interface IntegrationRecord {
  id: string;
  projectId: string;
  kind: IntegrationKind;
  connectionStatus: ConnectionStatus;
  connectionCheckedAt: string | null;
  lastError: string | null;
  config: IntegrationConfig;
  createdAt: string;
  updatedAt: string;
}

interface IntegrationRow {
  id: string;
  project_id: string;
  kind: IntegrationKind;
  connection_status: ConnectionStatus;
  connection_checked_at: string | null;
  last_error: string | null;
  config_json: string;
  created_at: string;
  updated_at: string;
}

const EMPTY_CONFIG: IntegrationConfig = { login: null, scopes: [], apiBase: '' };

/** A hand-edited or damaged config must not take the whole project down, so it degrades to empty. */
function parseConfig(json: string): IntegrationConfig {
  try {
    const parsed = JSON.parse(json) as Partial<IntegrationConfig> | null;
    return {
      login: typeof parsed?.login === 'string' ? parsed.login : null,
      scopes: Array.isArray(parsed?.scopes) ? parsed.scopes.filter((s): s is string => typeof s === 'string') : [],
      apiBase: typeof parsed?.apiBase === 'string' ? parsed.apiBase : ''
    };
  } catch {
    return { ...EMPTY_CONFIG };
  }
}

function toRecord(row: IntegrationRow): IntegrationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    connectionStatus: row.connection_status,
    connectionCheckedAt: row.connection_checked_at,
    lastError: row.last_error,
    config: parseConfig(row.config_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function insertIntegration(db: SqlDatabase, record: IntegrationRecord): IntegrationRecord {
  db.prepare(
    `INSERT INTO integrations (id, project_id, kind, connection_status, connection_checked_at, last_error,
                               config_json, created_at, updated_at)
     VALUES (:id, :project_id, :kind, :connection_status, :connection_checked_at, :last_error,
             :config_json, :created_at, :updated_at)`
  ).run({
    id: record.id,
    project_id: record.projectId,
    kind: record.kind,
    connection_status: record.connectionStatus,
    connection_checked_at: record.connectionCheckedAt,
    last_error: record.lastError,
    config_json: JSON.stringify(record.config),
    created_at: record.createdAt,
    updated_at: record.updatedAt
  });
  return record;
}

export function findIntegrationByProject(
  db: SqlDatabase,
  projectId: string,
  kind: IntegrationKind
): IntegrationRecord | null {
  const row = db
    .prepare('SELECT * FROM integrations WHERE project_id = :project_id AND kind = :kind')
    .get<IntegrationRow>({ project_id: projectId, kind });
  return row === undefined ? null : toRecord(row);
}

export function updateIntegration(
  db: SqlDatabase,
  id: string,
  patch: Partial<Pick<IntegrationRecord, 'connectionStatus' | 'connectionCheckedAt' | 'lastError' | 'config'>>,
  updatedAt: string
): void {
  const current = db.prepare('SELECT * FROM integrations WHERE id = :id').get<IntegrationRow>({ id });
  if (current === undefined) return;
  db.prepare(
    `UPDATE integrations
        SET connection_status = :connection_status, connection_checked_at = :connection_checked_at,
            last_error = :last_error, config_json = :config_json, updated_at = :updated_at
      WHERE id = :id`
  ).run({
    id,
    connection_status: patch.connectionStatus ?? current.connection_status,
    connection_checked_at:
      patch.connectionCheckedAt !== undefined ? patch.connectionCheckedAt : current.connection_checked_at,
    last_error: patch.lastError !== undefined ? patch.lastError : current.last_error,
    config_json: patch.config !== undefined ? JSON.stringify(patch.config) : current.config_json,
    updated_at: updatedAt
  });
}

export function deleteIntegration(db: SqlDatabase, id: string): number {
  return db.prepare('DELETE FROM integrations WHERE id = :id').run({ id }).changes;
}

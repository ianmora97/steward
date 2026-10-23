import type { Repository } from '@shared/schemas/repository';
import type { SqlDatabase } from './driver';

interface RepositoryRow {
  id: string;
  project_id: string;
  name: string;
  local_path: string;
  provider: Repository['provider'];
  remote_name: string | null;
  remote_url: string | null;
  default_branch: string | null;
  role: Repository['role'];
  service_name: string | null;
  created_at: string;
  last_opened_at: string | null;
}

function toRepository(row: RepositoryRow): Repository {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    localPath: row.local_path,
    provider: row.provider,
    remoteName: row.remote_name,
    remoteUrl: row.remote_url,
    defaultBranch: row.default_branch,
    role: row.role,
    serviceName: row.service_name,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at
  };
}

export function insertRepository(db: SqlDatabase, repository: Repository): Repository {
  db.prepare(
    `INSERT INTO repositories (id, project_id, name, local_path, provider, remote_name, remote_url,
                               default_branch, role, service_name, created_at, last_opened_at)
     VALUES (:id, :project_id, :name, :local_path, :provider, :remote_name, :remote_url,
             :default_branch, :role, :service_name, :created_at, :last_opened_at)`
  ).run({
    id: repository.id,
    project_id: repository.projectId,
    name: repository.name,
    local_path: repository.localPath,
    provider: repository.provider,
    remote_name: repository.remoteName,
    remote_url: repository.remoteUrl,
    default_branch: repository.defaultBranch,
    role: repository.role,
    service_name: repository.serviceName,
    created_at: repository.createdAt,
    last_opened_at: repository.lastOpenedAt
  });
  return repository;
}

export function listRepositoriesByProject(db: SqlDatabase, projectId: string): Repository[] {
  return db
    .prepare(
      `SELECT * FROM repositories
        WHERE project_id = :project_id
        ORDER BY CASE role WHEN 'primary' THEN 0 WHEN 'service' THEN 1 WHEN 'infra' THEN 2 ELSE 3 END,
                 name COLLATE NOCASE`
    )
    .all<RepositoryRow>({ project_id: projectId })
    .map(toRepository);
}

export function findRepositoryById(db: SqlDatabase, id: string): Repository | null {
  const row = db.prepare('SELECT * FROM repositories WHERE id = :id').get<RepositoryRow>({ id });
  return row === undefined ? null : toRepository(row);
}

export function findRepositoryByPath(
  db: SqlDatabase,
  projectId: string,
  localPath: string
): Repository | null {
  const row = db
    .prepare('SELECT * FROM repositories WHERE project_id = :project_id AND local_path = :local_path')
    .get<RepositoryRow>({ project_id: projectId, local_path: localPath });
  return row === undefined ? null : toRepository(row);
}

export function deleteRepositoryRow(db: SqlDatabase, id: string): number {
  return db.prepare('DELETE FROM repositories WHERE id = :id').run({ id }).changes;
}

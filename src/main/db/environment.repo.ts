import type { Environment } from '@shared/schemas/environments';
import type { SqlDatabase } from './driver';

interface EnvironmentRow {
  id: string;
  project_id: string;
  key: string;
  name: string;
  kind: Environment['kind'];
  rank: number;
  is_protected: number;
  created_at: string;
  updated_at: string;
}

function toEnvironment(row: EnvironmentRow): Environment {
  return {
    id: row.id,
    projectId: row.project_id,
    key: row.key,
    name: row.name,
    kind: row.kind,
    rank: row.rank,
    isProtected: row.is_protected === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listEnvironmentsByProject(db: SqlDatabase, projectId: string): Environment[] {
  return db
    .prepare('SELECT * FROM environments WHERE project_id = :project_id ORDER BY rank, name COLLATE NOCASE, id')
    .all<EnvironmentRow>({ project_id: projectId })
    .map(toEnvironment);
}

export function findEnvironmentById(db: SqlDatabase, id: string): Environment | null {
  const row = db.prepare('SELECT * FROM environments WHERE id = :id').get<EnvironmentRow>({ id });
  return row === undefined ? null : toEnvironment(row);
}

export function findEnvironmentByName(db: SqlDatabase, projectId: string, name: string): Environment | null {
  const row = db
    .prepare('SELECT * FROM environments WHERE project_id = :project_id AND name = :name COLLATE NOCASE')
    .get<EnvironmentRow>({ project_id: projectId, name });
  return row === undefined ? null : toEnvironment(row);
}

export function environmentKeyExists(db: SqlDatabase, projectId: string, key: string): boolean {
  return (
    db
      .prepare('SELECT 1 AS found FROM environments WHERE project_id = :project_id AND key = :key')
      .get<{ found: number }>({ project_id: projectId, key }) !== undefined
  );
}

export function nextEnvironmentRank(db: SqlDatabase, projectId: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(rank), -1) + 1 AS next FROM environments WHERE project_id = :project_id')
    .get<{ next: number }>({ project_id: projectId });
  return row?.next ?? 0;
}

export function insertEnvironment(db: SqlDatabase, environment: Environment): void {
  db.prepare(
    `INSERT INTO environments (id, project_id, key, name, kind, rank, is_protected, created_at, updated_at)
     VALUES (:id, :project_id, :key, :name, :kind, :rank, :is_protected, :created_at, :updated_at)`
  ).run({
    id: environment.id,
    project_id: environment.projectId,
    key: environment.key,
    name: environment.name,
    kind: environment.kind,
    rank: environment.rank,
    is_protected: environment.isProtected ? 1 : 0,
    created_at: environment.createdAt,
    updated_at: environment.updatedAt
  });
}

export function updateEnvironmentRow(db: SqlDatabase, environment: Environment): void {
  db.prepare(
    `UPDATE environments
        SET name = :name, kind = :kind, is_protected = :is_protected, updated_at = :updated_at
      WHERE id = :id`
  ).run({
    id: environment.id,
    name: environment.name,
    kind: environment.kind,
    is_protected: environment.isProtected ? 1 : 0,
    updated_at: environment.updatedAt
  });
}

export function deleteEnvironmentRow(db: SqlDatabase, id: string): void {
  db.prepare('DELETE FROM environments WHERE id = :id').run({ id });
}

export function setEnvironmentRanks(db: SqlDatabase, orderedIds: string[], updatedAt: string): void {
  const statement = db.prepare('UPDATE environments SET rank = :rank, updated_at = :updated_at WHERE id = :id');
  orderedIds.forEach((id, rank) => {
    statement.run({ id, rank, updated_at: updatedAt });
  });
}

/** What would be orphaned or lose its history if the environment disappeared. */
export function countEnvironmentUsage(db: SqlDatabase, id: string): { targets: number; deployments: number } {
  const targets = db
    .prepare('SELECT COUNT(*) AS n FROM deploy_targets WHERE environment_id = :id')
    .get<{ n: number }>({ id });
  const deployments = db
    .prepare('SELECT COUNT(*) AS n FROM deployments WHERE environment_id = :id')
    .get<{ n: number }>({ id });
  return { targets: targets?.n ?? 0, deployments: deployments?.n ?? 0 };
}

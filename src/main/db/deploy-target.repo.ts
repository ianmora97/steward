import {
  dispatchTargetConfigSchema,
  sshTargetConfigSchema,
  type DeployTarget,
  type DeployTargetKind
} from '@shared/schemas/deploy-targets';
import type { SqlDatabase } from './driver';

interface DeployTargetRow {
  id: string;
  project_id: string;
  environment_id: string;
  name: string;
  kind: DeployTargetKind;
  ssh_host_id: string | null;
  repository_id: string | null;
  config_json: string;
  requires_confirmation: number;
  created_at: string;
  updated_at: string;
}

function parseConfig(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * A row whose configuration no longer parses is skipped rather than allowed to
 * break the whole list. Only the id is logged: the config may hold a command.
 */
function toTarget(row: DeployTargetRow): DeployTarget | null {
  const common = {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    name: row.name,
    requiresConfirmation: row.requires_confirmation === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (row.kind === 'ssh_command') {
    const config = sshTargetConfigSchema.safeParse(parseConfig(row.config_json));
    if (!config.success) {
      console.error(`[steward] deploy target ${row.id} has an unreadable configuration`);
      return null;
    }
    return { ...common, kind: 'ssh_command', sshHostId: row.ssh_host_id, broken: row.ssh_host_id === null, config: config.data };
  }
  const config = dispatchTargetConfigSchema.safeParse(parseConfig(row.config_json));
  if (!config.success) {
    console.error(`[steward] deploy target ${row.id} has an unreadable configuration`);
    return null;
  }
  return {
    ...common,
    kind: 'github_workflow_dispatch',
    repositoryId: row.repository_id,
    broken: row.repository_id === null,
    config: config.data
  };
}

export function listDeployTargetsByProject(db: SqlDatabase, projectId: string): DeployTarget[] {
  return db
    .prepare('SELECT * FROM deploy_targets WHERE project_id = :project_id ORDER BY name COLLATE NOCASE, id')
    .all<DeployTargetRow>({ project_id: projectId })
    .flatMap((row) => {
      const target = toTarget(row);
      return target === null ? [] : [target];
    });
}

export function findDeployTargetById(db: SqlDatabase, id: string): DeployTarget | null {
  const row = db.prepare('SELECT * FROM deploy_targets WHERE id = :id').get<DeployTargetRow>({ id });
  return row === undefined ? null : toTarget(row);
}

export function findDeployTargetByName(db: SqlDatabase, projectId: string, name: string): DeployTarget | null {
  const row = db
    .prepare('SELECT * FROM deploy_targets WHERE project_id = :project_id AND name = :name COLLATE NOCASE')
    .get<DeployTargetRow>({ project_id: projectId, name });
  return row === undefined ? null : toTarget(row);
}

function params(target: DeployTarget): Record<string, string | number | null> {
  return {
    id: target.id,
    environment_id: target.environmentId,
    name: target.name,
    ssh_host_id: target.kind === 'ssh_command' ? target.sshHostId : null,
    repository_id: target.kind === 'github_workflow_dispatch' ? target.repositoryId : null,
    config_json: JSON.stringify(target.config),
    requires_confirmation: target.requiresConfirmation ? 1 : 0,
    updated_at: target.updatedAt
  };
}

export function insertDeployTarget(db: SqlDatabase, target: DeployTarget): void {
  db.prepare(
    `INSERT INTO deploy_targets (id, project_id, environment_id, name, kind, ssh_host_id, repository_id,
                                 config_json, requires_confirmation, created_at, updated_at)
     VALUES (:id, :project_id, :environment_id, :name, :kind, :ssh_host_id, :repository_id,
             :config_json, :requires_confirmation, :created_at, :updated_at)`
  ).run({ ...params(target), project_id: target.projectId, kind: target.kind, created_at: target.createdAt });
}

export function updateDeployTargetRow(db: SqlDatabase, target: DeployTarget): void {
  db.prepare(
    `UPDATE deploy_targets
        SET environment_id = :environment_id, name = :name, ssh_host_id = :ssh_host_id,
            repository_id = :repository_id, config_json = :config_json,
            requires_confirmation = :requires_confirmation, updated_at = :updated_at
      WHERE id = :id`
  ).run(params(target));
}

export function deleteDeployTargetRow(db: SqlDatabase, id: string): void {
  db.prepare('DELETE FROM deploy_targets WHERE id = :id').run({ id });
}

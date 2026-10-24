import { parseGithubRemote } from '@shared/github-remote';
import type {
  DeployTarget,
  DeployTargetCreateInput,
  DeployTargetIdInput,
  DeployTargetUpdateInput
} from '@shared/schemas/deploy-targets';
import { StewardServiceError } from '@shared/types/result';
import {
  deleteDeployTargetRow,
  findDeployTargetById,
  findDeployTargetByName,
  insertDeployTarget,
  listDeployTargetsByProject,
  updateDeployTargetRow
} from '../db/deploy-target.repo';
import type { SqlDatabase } from '../db/driver';
import { nowIso, uuidv7 } from '../db/id';
import { findRepositoryById } from '../db/repository.repo';
import { findSshHost } from '../db/ssh-host.repo';
import { requireEnvironment } from './environment.service';
import { requireProject } from './project.service';

export function requireDeployTarget(db: SqlDatabase, id: string): DeployTarget {
  const target = findDeployTargetById(db, id);
  if (target === null) {
    throw new StewardServiceError('NOT_FOUND', 'that deploy target no longer exists');
  }
  return target;
}

function assertNameFree(db: SqlDatabase, projectId: string, name: string, exceptId: string | null): void {
  const clash = findDeployTargetByName(db, projectId, name);
  if (clash !== null && clash.id !== exceptId) {
    throw new StewardServiceError('CONFLICT', 'a deploy target with that name already exists in this project');
  }
}

/** Whatever a target points at must belong to its project; a mismatch looks exactly like "not found". */
function assertEnvironment(db: SqlDatabase, projectId: string, environmentId: string): boolean {
  const environment = requireEnvironment(db, environmentId);
  if (environment.projectId !== projectId) {
    throw new StewardServiceError('NOT_FOUND', 'that environment no longer exists');
  }
  return environment.isProtected;
}

function assertSshHost(db: SqlDatabase, projectId: string, sshHostId: string): void {
  const host = findSshHost(db, sshHostId);
  if (host === null || host.projectId !== projectId) {
    throw new StewardServiceError('NOT_FOUND', 'that SSH host no longer exists');
  }
}

function assertGithubRepository(db: SqlDatabase, projectId: string, repositoryId: string): void {
  const repository = findRepositoryById(db, repositoryId);
  if (repository === null || repository.projectId !== projectId) {
    throw new StewardServiceError('NOT_FOUND', 'that repository no longer exists');
  }
  if (parseGithubRemote(repository.remoteUrl) === null) {
    throw new StewardServiceError('VALIDATION_FAILED', 'this repository has no github.com remote');
  }
}

export function listDeployTargets(db: SqlDatabase, projectId: string): DeployTarget[] {
  requireProject(db, projectId);
  return listDeployTargetsByProject(db, projectId);
}

export function createDeployTarget(db: SqlDatabase, input: DeployTargetCreateInput): DeployTarget {
  requireProject(db, input.projectId);
  const environmentProtected = assertEnvironment(db, input.projectId, input.environmentId);
  assertNameFree(db, input.projectId, input.name, null);

  const now = nowIso();
  const common = {
    id: uuidv7(),
    projectId: input.projectId,
    environmentId: input.environmentId,
    name: input.name,
    // A protected environment always asks, whatever the form sent.
    requiresConfirmation: environmentProtected || input.requiresConfirmation,
    broken: false,
    createdAt: now,
    updatedAt: now
  };

  let target: DeployTarget;
  if (input.kind === 'ssh_command') {
    assertSshHost(db, input.projectId, input.sshHostId);
    target = { ...common, kind: 'ssh_command', sshHostId: input.sshHostId, config: input.config };
  } else {
    assertGithubRepository(db, input.projectId, input.repositoryId);
    target = { ...common, kind: 'github_workflow_dispatch', repositoryId: input.repositoryId, config: input.config };
  }
  insertDeployTarget(db, target);
  return target;
}

export function updateDeployTarget(db: SqlDatabase, input: DeployTargetUpdateInput): DeployTarget {
  const existing = requireDeployTarget(db, input.id);
  if (existing.kind !== input.kind) {
    throw new StewardServiceError('VALIDATION_FAILED', 'a deploy target cannot change its kind');
  }
  const environmentProtected = assertEnvironment(db, existing.projectId, input.environmentId);
  assertNameFree(db, existing.projectId, input.name, existing.id);

  const common = {
    id: existing.id,
    projectId: existing.projectId,
    environmentId: input.environmentId,
    name: input.name,
    requiresConfirmation: environmentProtected || input.requiresConfirmation,
    broken: false,
    createdAt: existing.createdAt,
    updatedAt: nowIso()
  };

  let next: DeployTarget;
  if (input.kind === 'ssh_command') {
    assertSshHost(db, existing.projectId, input.sshHostId);
    next = { ...common, kind: 'ssh_command', sshHostId: input.sshHostId, config: input.config };
  } else {
    assertGithubRepository(db, existing.projectId, input.repositoryId);
    next = { ...common, kind: 'github_workflow_dispatch', repositoryId: input.repositoryId, config: input.config };
  }
  updateDeployTargetRow(db, next);
  return next;
}

/** Deployments made through it stay in the history with the name they had. */
export function deleteDeployTarget(db: SqlDatabase, input: DeployTargetIdInput): { id: string } {
  requireDeployTarget(db, input.id);
  deleteDeployTargetRow(db, input.id);
  return { id: input.id };
}

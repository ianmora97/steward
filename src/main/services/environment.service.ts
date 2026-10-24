import { slugify } from '@shared/schemas/common';
import type {
  Environment,
  EnvironmentCreateInput,
  EnvironmentIdInput,
  EnvironmentReorderInput,
  EnvironmentUpdateInput
} from '@shared/schemas/environments';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import {
  countEnvironmentUsage,
  deleteEnvironmentRow,
  environmentKeyExists,
  findEnvironmentById,
  findEnvironmentByName,
  insertEnvironment,
  listEnvironmentsByProject,
  nextEnvironmentRank,
  setEnvironmentRanks,
  updateEnvironmentRow
} from '../db/environment.repo';
import { nowIso, uuidv7 } from '../db/id';
import { requireProject } from './project.service';

export function requireEnvironment(db: SqlDatabase, id: string): Environment {
  const environment = findEnvironmentById(db, id);
  if (environment === null) {
    throw new StewardServiceError('NOT_FOUND', 'that environment no longer exists');
  }
  return environment;
}

function assertNameFree(db: SqlDatabase, projectId: string, name: string, exceptId: string | null): void {
  const clash = findEnvironmentByName(db, projectId, name);
  if (clash !== null && clash.id !== exceptId) {
    throw new StewardServiceError('CONFLICT', 'an environment with that name already exists in this project');
  }
}

/** The slug of the name, with -2, -3… appended until it is free in the project. */
function freeKey(db: SqlDatabase, projectId: string, name: string): string {
  const base = slugify(name);
  let key = base;
  for (let suffix = 2; environmentKeyExists(db, projectId, key); suffix += 1) {
    key = `${base}-${suffix}`;
  }
  return key;
}

export function listEnvironments(db: SqlDatabase, projectId: string): Environment[] {
  requireProject(db, projectId);
  return listEnvironmentsByProject(db, projectId);
}

export function createEnvironment(db: SqlDatabase, input: EnvironmentCreateInput): Environment {
  requireProject(db, input.projectId);
  assertNameFree(db, input.projectId, input.name, null);
  const now = nowIso();
  const environment: Environment = {
    id: uuidv7(),
    projectId: input.projectId,
    key: freeKey(db, input.projectId, input.name),
    name: input.name,
    kind: input.kind,
    rank: nextEnvironmentRank(db, input.projectId),
    isProtected: input.isProtected,
    createdAt: now,
    updatedAt: now
  };
  insertEnvironment(db, environment);
  return environment;
}

export function updateEnvironment(db: SqlDatabase, input: EnvironmentUpdateInput): Environment {
  const existing = requireEnvironment(db, input.id);
  if (existing.isProtected && !input.isProtected && !input.confirmed) {
    throw new StewardServiceError(
      'CONFIRMATION_REQUIRED',
      `removing the protection from ${existing.name} needs your confirmation`,
      'Deploys to it would no longer ask you to type its name.'
    );
  }
  assertNameFree(db, existing.projectId, input.name, existing.id);
  const next: Environment = {
    ...existing,
    name: input.name,
    kind: input.kind,
    isProtected: input.isProtected,
    updatedAt: nowIso()
  };
  updateEnvironmentRow(db, next);
  return next;
}

/** Applies a complete ordering. A partial or stale list is rejected rather than merged. */
export function reorderEnvironments(db: SqlDatabase, input: EnvironmentReorderInput): Environment[] {
  requireProject(db, input.projectId);
  const existing = listEnvironmentsByProject(db, input.projectId);
  const existingIds = new Set(existing.map((environment) => environment.id));
  const requestedIds = new Set(input.orderedIds);

  if (requestedIds.size !== input.orderedIds.length) {
    throw new StewardServiceError('VALIDATION_FAILED', 'the environment order contains duplicates');
  }
  if (requestedIds.size !== existingIds.size || [...existingIds].some((id) => !requestedIds.has(id))) {
    throw new StewardServiceError(
      'VALIDATION_FAILED',
      'the environment order must list every environment of this project exactly once'
    );
  }

  db.transaction(() => {
    setEnvironmentRanks(db, input.orderedIds, nowIso());
  });
  return listEnvironmentsByProject(db, input.projectId);
}

/** Servers pointing at it just lose their environment; targets and history make it undeletable. */
export function deleteEnvironment(db: SqlDatabase, input: EnvironmentIdInput): { id: string } {
  const environment = requireEnvironment(db, input.id);
  const usage = countEnvironmentUsage(db, input.id);
  if (usage.targets > 0 || usage.deployments > 0) {
    throw new StewardServiceError(
      'ENVIRONMENT_IN_USE',
      `${environment.name} is still in use`,
      `${usage.targets} deploy target(s) and ${usage.deployments} deployment(s) refer to it. Delete its targets first; an environment with deployment history cannot be deleted.`
    );
  }
  deleteEnvironmentRow(db, input.id);
  return { id: input.id };
}

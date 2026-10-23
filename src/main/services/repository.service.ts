import type { AddRepositoryInput, Repository, RepositoryProbe } from '@shared/schemas/repository';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { nowIso, uuidv7 } from '../db/id';
import {
  deleteRepositoryRow,
  findRepositoryByPath,
  insertRepository,
  listRepositoriesByProject
} from '../db/repository.repo';
import { probeRepository, repositoryNameFromPath } from './git.service';
import { requireProject } from './project.service';

export function listRepositories(db: SqlDatabase, projectId: string): Repository[] {
  requireProject(db, projectId);
  return listRepositoriesByProject(db, projectId);
}

export async function validateRepositoryPath(localPath: string): Promise<RepositoryProbe> {
  return await probeRepository(localPath);
}

/**
 * Binds an existing local repository to a project.
 *
 * The folder is validated against Git before a row is written: Steward never
 * records a repository it has not confirmed is a work tree. The work-tree root
 * reported by Git is stored, not the folder the user happened to pick, so two
 * different paths inside one repository cannot be added twice.
 */
export async function addRepository(db: SqlDatabase, input: AddRepositoryInput): Promise<Repository> {
  requireProject(db, input.projectId);

  const probe = await probeRepository(input.localPath);

  if (!probe.isGitRepository) {
    throw new StewardServiceError(
      'NOT_A_GIT_REPOSITORY',
      probe.reason ?? 'that folder is not a Git repository',
      'Pick the folder that contains the repository, or run `git init` there first.'
    );
  }

  const localPath = probe.workTreeRoot ?? probe.localPath;

  if (findRepositoryByPath(db, input.projectId, localPath) !== null) {
    throw new StewardServiceError('CONFLICT', 'that repository is already part of this project');
  }

  const existingCount = listRepositoriesByProject(db, input.projectId).length;

  const repository: Repository = {
    id: uuidv7(),
    projectId: input.projectId,
    name: input.name?.trim() ?? repositoryNameFromPath(localPath),
    localPath,
    provider: probe.provider,
    remoteName: probe.remoteName,
    remoteUrl: probe.remoteUrl,
    defaultBranch: probe.currentBranch,
    // The first repository of a project is its primary one unless told otherwise.
    role: input.role ?? (existingCount === 0 ? 'primary' : 'service'),
    serviceName: input.serviceName ?? null,
    createdAt: nowIso(),
    lastOpenedAt: null
  };

  return insertRepository(db, repository);
}

export function removeRepository(db: SqlDatabase, id: string): { id: string } {
  const changes = deleteRepositoryRow(db, id);
  if (changes === 0) {
    throw new StewardServiceError('NOT_FOUND', 'that repository is no longer part of this project');
  }
  return { id };
}

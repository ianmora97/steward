import { parseGithubRemote, type GithubRepoRef } from '@shared/github-remote';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { findRepositoryById } from '../db/repository.repo';

/**
 * Owner and repo come from the remote Steward stored, never from the renderer,
 * and the repository must belong to the project whose token is used. A
 * mismatch looks exactly like "not found".
 */
export function resolveGithubRepo(
  db: SqlDatabase,
  input: { projectId: string; repositoryId: string }
): GithubRepoRef {
  const repository = findRepositoryById(db, input.repositoryId);
  if (repository === null || repository.projectId !== input.projectId) {
    throw new StewardServiceError('NOT_FOUND', 'that repository no longer exists');
  }
  const ref = parseGithubRemote(repository.remoteUrl);
  if (ref === null) {
    throw new StewardServiceError('VALIDATION_FAILED', 'this repository has no github.com remote');
  }
  return ref;
}

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StewardDatabase } from '@main/db/connection';
import { runCommand } from '@main/exec/run';
import { createProject } from '@main/services/project.service';
import {
  addRepository,
  listRepositories,
  removeRepository,
  validateRepositoryPath
} from '@main/services/repository.service';
import { createTempDirectory, createTestDatabase } from '../helpers/database';

/**
 * These tests drive the real `git` executable against temporary repositories,
 * because the behaviour under test is Steward's agreement with Git, not a mock
 * of it.
 */
async function git(args: string[], cwd?: string): Promise<void> {
  const result = await runCommand('git', args, cwd === undefined ? {} : { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
}

describe('repository service against real repositories', () => {
  let database: StewardDatabase;
  let cleanupDatabase: () => void;
  let projectId: string;
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    ({ database, cleanup: cleanupDatabase } = createTestDatabase());
    projectId = createProject(database.db, { name: 'Integration' }).id;
  });

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    cleanupDatabase();
  });

  function tempDirectory(prefix: string): string {
    const { path, cleanup } = createTempDirectory(prefix);
    cleanups.push(cleanup);
    return path;
  }

  async function initRepository(prefix: string): Promise<string> {
    const path = tempDirectory(prefix);
    await git(['-C', path, 'init', '-b', 'main']);
    return path;
  }

  it('recognises a repository that has no commits yet', async () => {
    const path = await initRepository('steward-repo-empty-');

    const probe = await validateRepositoryPath(path);

    expect(probe.isGitRepository).toBe(true);
    expect(probe.detachedHead).toBe(false);
    expect(probe.currentBranch).toBe('main');
    expect(probe.remoteUrl).toBeNull();
    expect(probe.provider).toBe('unknown');
    expect(probe.reason).toBeNull();
  });

  it('reports a plain folder as not a repository instead of raising', async () => {
    const path = tempDirectory('steward-plain-');

    const probe = await validateRepositoryPath(path);

    expect(probe.isGitRepository).toBe(false);
    expect(probe.reason).toMatch(/not a Git repository/);
    await expect(addRepository(database.db, { projectId, localPath: path })).rejects.toMatchObject({
      code: 'NOT_A_GIT_REPOSITORY'
    });
    expect(listRepositories(database.db, projectId)).toEqual([]);
  });

  it('refuses a path that does not exist or is a file', async () => {
    const directory = tempDirectory('steward-missing-');
    const filePath = join(directory, 'notes.txt');
    writeFileSync(filePath, 'not a folder');

    await expect(validateRepositoryPath(join(directory, 'nope'))).rejects.toMatchObject({
      code: 'PATH_NOT_FOUND'
    });
    await expect(validateRepositoryPath(filePath)).rejects.toMatchObject({ code: 'PATH_INVALID' });
  });

  it('identifies a GitHub remote and records it', async () => {
    const path = await initRepository('steward-repo-remote-');
    await git(['-C', path, 'remote', 'add', 'origin', 'git@github.com:ianmora97/steward.git']);

    const repository = await addRepository(database.db, { projectId, localPath: path });

    expect(repository.provider).toBe('github');
    expect(repository.remoteName).toBe('origin');
    expect(repository.remoteUrl).toBe('git@github.com:ianmora97/steward.git');
    expect(repository.role).toBe('primary');
  });

  it('stores the work-tree root, so the same repository cannot be added twice', async () => {
    const path = await initRepository('steward-repo-dedupe-');
    const nested = join(path, 'packages', 'api');
    mkdirSync(nested, { recursive: true });

    const added = await addRepository(database.db, { projectId, localPath: path });
    expect(added.localPath).toBe(path);

    // Adding a subdirectory resolves to the same work tree and is rejected.
    await expect(addRepository(database.db, { projectId, localPath: nested })).rejects.toMatchObject({
      code: 'CONFLICT'
    });
    expect(listRepositories(database.db, projectId)).toHaveLength(1);
  });

  it('treats the first repository as primary and later ones as services', async () => {
    const first = await initRepository('steward-repo-first-');
    const second = await initRepository('steward-repo-second-');

    const primary = await addRepository(database.db, { projectId, localPath: first });
    const service = await addRepository(database.db, {
      projectId,
      localPath: second,
      serviceName: 'billing-api'
    });

    expect(primary.role).toBe('primary');
    expect(service.role).toBe('service');
    expect(service.serviceName).toBe('billing-api');
    expect(listRepositories(database.db, projectId).map((repository) => repository.role)).toEqual([
      'primary',
      'service'
    ]);
  });

  it('treats a branch name containing shell syntax as data', async () => {
    const path = await initRepository('steward-repo-hostile-');
    const hostileBranch = '$(touch_pwned)';
    await git(['-C', path, 'checkout', '-b', hostileBranch]);

    const probe = await validateRepositoryPath(path);

    expect(probe.currentBranch).toBe(hostileBranch);
    expect(existsSync(join(path, 'touch_pwned'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'touch_pwned'))).toBe(false);
  });

  it('reports a bare repository as unusable rather than adding it', async () => {
    const path = tempDirectory('steward-repo-bare-');
    await git(['-C', path, 'init', '--bare']);

    const probe = await validateRepositoryPath(path);

    expect(probe.isGitRepository).toBe(false);
    expect(probe.isBare).toBe(true);
    expect(probe.reason).toMatch(/bare repository/);
  });

  it('removes a repository record without touching the folder', async () => {
    const path = await initRepository('steward-repo-remove-');
    const repository = await addRepository(database.db, { projectId, localPath: path });

    removeRepository(database.db, repository.id);

    expect(listRepositories(database.db, projectId)).toEqual([]);
    expect(existsSync(join(path, '.git'))).toBe(true);
    expect(() => removeRepository(database.db, repository.id)).toThrowError(/no longer part/);
  });

  it('rejects a repository for a project that does not exist', async () => {
    const path = await initRepository('steward-repo-orphan-');

    await expect(
      addRepository(database.db, { projectId: '0192f0c0-dead-7000-8000-000000000000', localPath: path })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

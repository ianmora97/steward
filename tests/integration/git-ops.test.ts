import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StewardDatabase } from '@main/db/connection';
import { runCommand } from '@main/exec/run';
import {
  abortMerge,
  checkoutBranch,
  commit,
  createBranch,
  deleteBranch,
  discardPaths,
  fetchRemote,
  getDiff,
  getStatus,
  listBranches,
  listExecutions,
  pull,
  push,
  stagePaths,
  unstagePaths
} from '@main/services/git-ops.service';
import { createProject } from '@main/services/project.service';
import { addRepository } from '@main/services/repository.service';
import { gitDeleteBranchInputSchema, gitDiscardInputSchema } from '@shared/schemas/git';
import { createTempDirectory, createTestDatabase } from '../helpers/database';

/** Git for Windows may check files out with CRLF; content is what matters here. */
function read(dir: string, name: string): string {
  return readFileSync(join(dir, name), 'utf8').split(String.fromCharCode(13)).join('');
}

const NO_SUCH_ID = '0192f0c0-dead-7000-8000-000000000000';

/** Drives the real `git`, so these tests check Steward's agreement with Git rather than a mock of it. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await runCommand('git', ['-C', cwd, ...args], {
    env: { ...(process.env as Record<string, string>), LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' }
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

describe('git operations against real repositories', () => {
  let database: StewardDatabase;
  let cleanupDatabase: () => void;
  let db: StewardDatabase['db'];
  let projectId: string;
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    ({ database, cleanup: cleanupDatabase } = createTestDatabase());
    db = database.db;
    projectId = createProject(db, { name: 'Git ops' }).id;
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

  async function configure(path: string): Promise<void> {
    await git(path, 'config', 'user.name', 'Steward Test');
    await git(path, 'config', 'user.email', 'test@example.com');
    await git(path, 'config', 'commit.gpgsign', 'false');
  }

  async function newRepo(prefix = 'steward-ops-'): Promise<{ path: string; id: string }> {
    const path = tempDirectory(prefix);
    await git(path, 'init', '-b', 'main');
    await configure(path);
    const repository = await addRepository(db, { projectId, localPath: path });
    return { path, id: repository.id };
  }

  function write(path: string, name: string, content: string): void {
    const full = join(path, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }

  async function commitFile(path: string, name: string, content: string, message = 'add'): Promise<void> {
    write(path, name, content);
    await git(path, 'add', '--all');
    await git(path, 'commit', '-m', message);
  }

  /** A repo wired to a local bare "remote", with one commit pushed. */
  async function repoWithRemote(): Promise<{ path: string; id: string; remote: string }> {
    const remote = tempDirectory('steward-remote-');
    await git(remote, 'init', '--bare', '-b', 'main');
    const repo = await newRepo('steward-local-');
    await git(repo.path, 'remote', 'add', 'origin', remote);
    await commitFile(repo.path, 'a.txt', 'one\n');
    await push(db, repo.id);
    return { ...repo, remote };
  }

  async function teammateClone(remote: string): Promise<string> {
    const teammate = tempDirectory('steward-teammate-');
    await git(teammate, 'clone', '-q', remote, '.');
    await configure(teammate);
    return teammate;
  }

  describe('status', () => {
    it('reports staged, unstaged and untracked changes, including renames, deletions and binaries', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'keep.txt', 'keep\n');
      await commitFile(path, 'gone.txt', 'bye\n');
      await commitFile(path, 'old name.txt', 'rename me, enough content to detect the rename\n');

      await git(path, 'mv', 'old name.txt', 'new name.txt');
      await git(path, 'rm', '-q', 'gone.txt');
      write(path, 'keep.txt', 'changed\n');
      write(path, 'untracked file.txt', 'x');
      writeFileSync(join(path, 'image.bin'), Buffer.from([0, 1, 2, 0, 255, 0]));

      const status = await getStatus(db, id);
      const byPath = new Map(status.files.map((file) => [file.path, file]));

      expect(status).toMatchObject({ branch: 'main', detached: false, hasCommits: true, mergeInProgress: false });
      expect(byPath.get('new name.txt')).toMatchObject({ staged: 'renamed', originalPath: 'old name.txt' });
      expect(byPath.get('gone.txt')).toMatchObject({ staged: 'deleted', unstaged: null });
      expect(byPath.get('keep.txt')).toMatchObject({ staged: null, unstaged: 'modified' });
      expect(byPath.get('untracked file.txt')).toMatchObject({ unstaged: 'untracked' });
      expect(byPath.get('image.bin')).toMatchObject({ unstaged: 'untracked' });
    });

    it('works on a repository with no commits', async () => {
      const { path, id } = await newRepo();
      write(path, 'first.txt', 'hello');

      const status = await getStatus(db, id);

      expect(status.hasCommits).toBe(false);
      expect(status.branch).toBe('main');
      expect(status.files).toHaveLength(1);
    });

    it('lists files inside untracked directories individually', async () => {
      const { path, id } = await newRepo();
      write(path, 'src/deep/a.ts', '1');
      write(path, 'src/deep/b.ts', '2');

      const status = await getStatus(db, id);

      expect(status.files.map((file) => file.path).sort()).toEqual(['src/deep/a.ts', 'src/deep/b.ts']);
    });

    it('fails clearly when the repository id is unknown', async () => {
      await expect(getStatus(db, NO_SUCH_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('diff', () => {
    it('diffs unstaged, staged and untracked files, and flags binaries', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'a.txt', 'one\n');
      write(path, 'a.txt', 'one\ntwo\n');
      write(path, 'new.txt', 'brand new\n');
      writeFileSync(join(path, 'bin.dat'), Buffer.from([0, 1, 2, 3, 0, 0, 255]));

      const unstaged = await getDiff(db, { repositoryId: id, path: 'a.txt', staged: false });
      expect(unstaged.text).toContain('+two');
      expect(unstaged.binary).toBe(false);

      const untracked = await getDiff(db, { repositoryId: id, path: 'new.txt', staged: false, untracked: true });
      expect(untracked.text).toContain('+brand new');

      const binary = await getDiff(db, { repositoryId: id, path: 'bin.dat', staged: false, untracked: true });
      expect(binary.binary).toBe(true);
      expect(binary.text).toBe('');

      await stagePaths(db, { repositoryId: id, paths: ['a.txt'] });
      const staged = await getDiff(db, { repositoryId: id, path: 'a.txt', staged: true });
      expect(staged.text).toContain('+two');
      expect((await getDiff(db, { repositoryId: id, path: 'a.txt', staged: false })).empty).toBe(true);
    });
  });

  describe('stage, unstage and commit', () => {
    it('stages, commits, and the commit appears in git log', async () => {
      const { path, id } = await newRepo();
      write(path, 'a.txt', 'hello\n');

      await stagePaths(db, { repositoryId: id, paths: ['a.txt'] });
      const result = await commit(db, { repositoryId: id, message: 'first commit' });

      expect(result.summary).toBe('first commit');
      expect(await git(path, 'log', '--format=%s')).toBe('first commit');
      expect((await getStatus(db, id)).files).toEqual([]);
    });

    it('unstages a file, both before and after the first commit', async () => {
      const { path, id } = await newRepo();
      write(path, 'a.txt', 'hello\n');
      await stagePaths(db, { repositoryId: id, paths: ['a.txt'] });

      const beforeFirstCommit = await unstagePaths(db, { repositoryId: id, paths: ['a.txt'] });
      expect(beforeFirstCommit.files[0]).toMatchObject({ staged: null, unstaged: 'untracked' });

      await commitFile(path, 'b.txt', 'b\n');
      write(path, 'b.txt', 'b2\n');
      await stagePaths(db, { repositoryId: id, paths: ['b.txt'] });
      const afterFirstCommit = await unstagePaths(db, { repositoryId: id, paths: ['b.txt'] });
      expect(afterFirstCommit.files.find((f) => f.path === 'b.txt')).toMatchObject({
        staged: null,
        unstaged: 'modified'
      });
    });

    it('stages a deletion', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'a.txt', 'x\n');
      unlinkSync(join(path, 'a.txt'));

      const status = await stagePaths(db, { repositoryId: id, paths: ['a.txt'] });

      expect(status.files[0]).toMatchObject({ path: 'a.txt', staged: 'deleted' });
    });

    it('refuses to commit with nothing staged', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'a.txt', 'x\n');
      write(path, 'a.txt', 'changed\n');

      await expect(commit(db, { repositoryId: id, message: 'nope' })).rejects.toMatchObject({
        code: 'GIT_NOTHING_TO_COMMIT'
      });
    });

    it('treats an option-like or glob-like path as a literal file name', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'real.txt', 'real\n');
      write(path, '-rf', 'dash');
      write(path, 'other.txt', 'other');

      const status = await stagePaths(db, { repositoryId: id, paths: ['-rf'] });

      expect(status.files.find((f) => f.path === '-rf')).toMatchObject({ staged: 'added' });
      expect(status.files.find((f) => f.path === 'other.txt')).toMatchObject({ staged: null });

      // A literal `*` names no file, so it must not expand to everything else.
      await expect(stagePaths(db, { repositoryId: id, paths: ['*'] })).rejects.toMatchObject({ code: 'GIT_FAILED' });
      expect((await getStatus(db, id)).files.find((f) => f.path === 'other.txt')).toMatchObject({ staged: null });
    });
  });

  describe('discard', () => {
    it('restores tracked files and removes untracked ones', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'a.txt', 'original\n');
      write(path, 'a.txt', 'edited\n');
      write(path, 'scratch.txt', 'temp');

      const status = await discardPaths(db, { repositoryId: id, paths: ['a.txt', 'scratch.txt'], confirmed: true });

      expect(status.files).toEqual([]);
      expect(read(path, 'a.txt')).toBe('original\n');
      expect(existsSync(join(path, 'scratch.txt'))).toBe(false);
    });

    it('is rejected by validation without confirmation, so declining changes nothing', async () => {
      const { path } = await newRepo();
      await commitFile(path, 'a.txt', 'original\n');
      write(path, 'a.txt', 'edited\n');

      const base = { repositoryId: NO_SUCH_ID, paths: ['a.txt'] };
      expect(gitDiscardInputSchema.safeParse(base).success).toBe(false);
      expect(gitDiscardInputSchema.safeParse({ ...base, confirmed: false }).success).toBe(false);
      expect(read(path, 'a.txt')).toBe('edited\n');
    });

    it('records the confirmation on the execution row', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'a.txt', 'original\n');
      write(path, 'a.txt', 'edited\n');

      await discardPaths(db, { repositoryId: id, paths: ['a.txt'], confirmed: true });

      const restore = listExecutions(db, id).find((e) => e.args.includes('restore'));
      expect(restore).toMatchObject({ confirmedByUser: true, status: 'succeeded', exitCode: 0 });
    });

    it('refuses a path that has no changes', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'a.txt', 'original\n');

      await expect(discardPaths(db, { repositoryId: id, paths: ['a.txt'], confirmed: true })).rejects.toMatchObject({
        code: 'NOT_FOUND'
      });
    });
  });

  describe('branches', () => {
    it('lists, creates, checks out and deletes branches', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'a.txt', 'x\n');

      const created = await createBranch(db, { repositoryId: id, name: 'feature/login', checkout: true });
      expect(created.current).toBe('feature/login');
      expect(created.branches.map((b) => b.name).sort()).toEqual(['feature/login', 'main']);

      await checkoutBranch(db, { repositoryId: id, name: 'main' });
      const removed = await deleteBranch(db, { repositoryId: id, name: 'feature/login' });
      expect(removed.branches.map((b) => b.name)).toEqual(['main']);
    });

    it('reports the unborn branch of an empty repository', async () => {
      const { id } = await newRepo();

      expect(await listBranches(db, id)).toMatchObject({ current: 'main', detached: false, branches: [] });
    });

    it('creates and checks out a branch whose name is shell syntax without executing it', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'a.txt', 'x\n');
      const hostile = '$(touch_pwned)';

      const list = await createBranch(db, { repositoryId: id, name: hostile, checkout: true });

      expect(list.current).toBe(hostile);
      expect(existsSync(join(path, 'touch_pwned'))).toBe(false);
      expect(existsSync(join(process.cwd(), 'touch_pwned'))).toBe(false);

      await checkoutBranch(db, { repositoryId: id, name: 'main' });
      await checkoutBranch(db, { repositoryId: id, name: hostile });
      expect(existsSync(join(path, 'touch_pwned'))).toBe(false);
    });

    it('rejects names Git cannot hold, such as ones with a space, instead of mangling them', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'a.txt', 'x\n');

      for (const name of ['$(touch pwned)', 'a..b', 'bad~name', 'a b']) {
        await expect(createBranch(db, { repositoryId: id, name })).rejects.toMatchObject({
          code: 'GIT_INVALID_REF'
        });
      }
      expect(existsSync(join(path, 'pwned'))).toBe(false);
    });

    it('refuses a duplicate branch name', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'a.txt', 'x\n');
      await createBranch(db, { repositoryId: id, name: 'dup' });

      await expect(createBranch(db, { repositoryId: id, name: 'dup' })).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('refuses to delete an unmerged branch unless force is confirmed', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'a.txt', 'x\n');
      await createBranch(db, { repositoryId: id, name: 'wip', checkout: true });
      await commitFile(path, 'wip.txt', 'unmerged work\n', 'wip commit');
      await checkoutBranch(db, { repositoryId: id, name: 'main' });

      await expect(deleteBranch(db, { repositoryId: id, name: 'wip' })).rejects.toMatchObject({
        code: 'GIT_UNMERGED_BRANCH'
      });
      expect((await listBranches(db, id)).branches.map((b) => b.name)).toContain('wip');

      // A force request that was never confirmed does not pass validation.
      expect(gitDeleteBranchInputSchema.safeParse({ repositoryId: id, name: 'wip', force: true }).success).toBe(false);

      const after = await deleteBranch(db, { repositoryId: id, name: 'wip', force: true, confirmed: true });
      expect(after.branches.map((b) => b.name)).toEqual(['main']);
    });

    it('refuses to check out over uncommitted changes with a distinct error', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'a.txt', 'main\n');
      await createBranch(db, { repositoryId: id, name: 'other', checkout: true });
      await commitFile(path, 'a.txt', 'other\n', 'other change');
      await checkoutBranch(db, { repositoryId: id, name: 'main' });
      write(path, 'a.txt', 'dirty\n');

      await expect(checkoutBranch(db, { repositoryId: id, name: 'other' })).rejects.toMatchObject({
        code: 'GIT_LOCAL_CHANGES'
      });
    });
  });

  describe('fetch, pull and push', () => {
    it("pushes with an upstream on first push, then fetches and pulls a teammate's commit", async () => {
      const { path, id, remote } = await repoWithRemote();
      expect((await getStatus(db, id)).upstream).toBe('origin/main');

      const teammate = await teammateClone(remote);
      await commitFile(teammate, 'b.txt', 'from teammate\n', 'teammate commit');
      await git(teammate, 'push', '-q');

      await fetchRemote(db, id);
      expect((await getStatus(db, id)).behind).toBe(1);

      const pulled = await pull(db, { repositoryId: id });
      expect(pulled.operation).toBe('pull');
      expect(read(path, 'b.txt')).toBe('from teammate\n');
      expect((await getStatus(db, id)).behind).toBe(0);
    });

    it('rejects a non-fast-forward push with its own error and never forces', async () => {
      const { path, id, remote } = await repoWithRemote();
      const teammate = await teammateClone(remote);
      await commitFile(teammate, 'b.txt', 'theirs\n', 'theirs');
      await git(teammate, 'push', '-q');

      await commitFile(path, 'c.txt', 'mine\n', 'mine');

      await expect(push(db, id)).rejects.toMatchObject({ code: 'GIT_NON_FAST_FORWARD' });
      expect(await git(remote, 'log', '--format=%s', 'main')).not.toContain('mine');
    });

    it('reports a diverged fast-forward pull, then a merge conflict that can be aborted', async () => {
      const { path, id, remote } = await repoWithRemote();
      const teammate = await teammateClone(remote);
      await commitFile(teammate, 'a.txt', 'theirs\n', 'theirs');
      await git(teammate, 'push', '-q');

      await commitFile(path, 'a.txt', 'mine\n', 'mine');
      await fetchRemote(db, id);

      await expect(pull(db, { repositoryId: id })).rejects.toMatchObject({ code: 'GIT_DIVERGED' });
      await expect(pull(db, { repositoryId: id, mode: 'merge' })).rejects.toMatchObject({
        code: 'GIT_MERGE_CONFLICT'
      });

      const status = await getStatus(db, id);
      expect(status.mergeInProgress).toBe(true);
      expect(status.files.find((f) => f.path === 'a.txt')?.conflicted).toBe(true);
      await expect(commit(db, { repositoryId: id, message: 'merge' })).rejects.toMatchObject({
        code: 'GIT_MERGE_CONFLICT'
      });

      const aborted = await abortMerge(db, id);
      expect(aborted.mergeInProgress).toBe(false);
      expect(read(path, 'a.txt')).toBe('mine\n');
    });

    it('reports a missing remote, a missing upstream and an unreachable remote distinctly', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'a.txt', 'x\n');

      await expect(fetchRemote(db, id)).rejects.toMatchObject({ code: 'GIT_NO_REMOTE' });
      await expect(pull(db, { repositoryId: id })).rejects.toMatchObject({ code: 'GIT_NO_REMOTE' });
      await expect(push(db, id)).rejects.toMatchObject({ code: 'GIT_NO_REMOTE' });

      await git(path, 'remote', 'add', 'origin', join(path, 'does-not-exist'));
      await expect(fetchRemote(db, id)).rejects.toMatchObject({ code: 'GIT_REMOTE_NOT_FOUND' });
    });
  });

  describe('failure modes', () => {
    it('reports a repository that is no longer a work tree', async () => {
      const { path, id } = await newRepo();
      rmSync(join(path, '.git'), { recursive: true, force: true });

      await expect(getStatus(db, id)).rejects.toMatchObject({ code: 'NOT_A_GIT_REPOSITORY' });
    });

    it('reports a repository folder that was deleted', async () => {
      const { path, id } = await newRepo();
      rmSync(path, { recursive: true, force: true });

      await expect(getStatus(db, id)).rejects.toMatchObject({ code: 'PATH_NOT_FOUND' });
    });

    it('reports a missing git executable', async () => {
      const { id } = await newRepo();
      const original = process.env['PATH'];
      const originalWindowsPath = process.env['Path'];
      process.env['PATH'] = '';
      process.env['Path'] = '';
      try {
        await expect(getStatus(db, id)).rejects.toMatchObject({ code: 'GIT_NOT_FOUND' });
      } finally {
        if (original !== undefined) process.env['PATH'] = original;
        if (originalWindowsPath !== undefined) process.env['Path'] = originalWindowsPath;
      }
    });
  });

  describe('execution history', () => {
    it('records actions with command, args, exit code, status and duration, and skips reads', async () => {
      const { path, id } = await newRepo();
      write(path, 'a.txt', 'hello\n');

      await getStatus(db, id);
      await stagePaths(db, { repositoryId: id, paths: ['a.txt'] });
      await commit(db, { repositoryId: id, message: 'recorded' });

      const rows = listExecutions(db, id);
      const add = rows.find((row) => row.args.includes('add'));
      const commitRow = rows.find((row) => row.args.includes('commit'));

      expect(add).toMatchObject({ kind: 'git_op', command: 'git', status: 'succeeded', exitCode: 0, context: 'local' });
      expect(add?.args).toEqual(['add', '--all', '--', 'a.txt']);
      expect(add?.cwd).toBe(path);
      expect(add?.durationMs).toBeGreaterThanOrEqual(0);
      expect(commitRow?.args).toContain('recorded');
      expect(rows.some((row) => row.args.includes('status'))).toBe(false);
    });

    it('records a failed network operation with its classified error', async () => {
      const { path, id } = await newRepo();
      await commitFile(path, 'a.txt', 'x\n');
      await git(path, 'remote', 'add', 'origin', join(path, 'nowhere'));
      await fetchRemote(db, id).catch(() => undefined);

      const row = listExecutions(db, id).find((r) => r.args.includes('fetch'));

      expect(row).toMatchObject({ status: 'failed', errorCode: 'GIT_REMOTE_NOT_FOUND' });
      expect(row?.exitCode).not.toBe(0);
    });
  });
});

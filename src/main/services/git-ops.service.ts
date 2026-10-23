import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Execution,
  GitBranchList,
  GitCheckoutInput,
  GitCommitInput,
  GitCommitResult,
  GitCreateBranchInput,
  GitDeleteBranchInput,
  GitDiff,
  GitDiffInput,
  GitDiscardInput,
  GitPullInput,
  GitStageInput,
  GitStatus,
  GitSyncResult
} from '@shared/schemas/git';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { listExecutionsByRepository } from '../db/execution.repo';
import { findRepositoryById } from '../db/repository.repo';
import { redact } from './git-errors';
import { execGit, type GitSession } from './git-exec';
import { BRANCH_FORMAT, parseBranches, parseStatusV2 } from './git-parse';

/**
 * Everyday Git operations for the Git tab.
 *
 * Git stays the source of truth: every function asks the installed `git` and
 * returns what it says. Nothing here caches repository state, and every
 * mutating or network operation writes an `executions` row.
 *
 * User-supplied values (paths, branch names, messages) only ever appear as
 * elements of the argument array, after the options that could be confused with
 * them, so a branch called `$(touch_pwned)` or a file called `-rf` is data.
 */
export function session(db: SqlDatabase, repositoryId: string): GitSession {
  const repository = findRepositoryById(db, repositoryId);
  if (repository === null) {
    throw new StewardServiceError('NOT_FOUND', 'that repository is no longer part of this project');
  }
  return { db, repository };
}

function trimOutput(stdout: string, stderr: string): string {
  return redact([stderr, stdout].map((part) => part.trim()).filter((part) => part !== '').join('\n'));
}

/* Status ------------------------------------------------------------------ */

async function isMergeInProgress(s: GitSession): Promise<boolean> {
  const dir = await execGit(s, ['rev-parse', '--absolute-git-dir']);
  return existsSync(join(dir.stdout.trim(), 'MERGE_HEAD'));
}

export async function getStatus(db: SqlDatabase, repositoryId: string): Promise<GitStatus> {
  return await readStatus(session(db, repositoryId));
}

async function readStatus(s: GitSession): Promise<GitStatus> {
  const out = await execGit(s, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
  const parsed = parseStatusV2(out.stdout);
  return { ...parsed, mergeInProgress: await isMergeInProgress(s) };
}

/* Diff -------------------------------------------------------------------- */

const MAX_DIFF_BYTES = 500_000;

export async function getDiff(db: SqlDatabase, input: GitDiffInput): Promise<GitDiff> {
  const s = session(db, input.repositoryId);
  const common = ['--no-color', '--no-ext-diff', '--no-textconv'];

  const args =
    input.untracked === true && !input.staged
      ? ['diff', '--no-index', ...common, '--', '/dev/null', input.path]
      : ['diff', ...(input.staged ? ['--cached'] : []), ...common, '--', input.path];

  // `git diff --no-index` exits 1 when the files differ, which is the normal case.
  const out = await execGit(s, args, {
    maxOutputBytes: MAX_DIFF_BYTES,
    okExitCodes: input.untracked === true ? [0, 1] : [0]
  });

  const binary = /^Binary files .* differ$/m.test(out.stdout) || out.stdout.includes('GIT binary patch');

  return {
    path: input.path,
    staged: input.staged,
    text: binary ? '' : out.stdout,
    binary,
    truncated: out.truncated,
    empty: out.stdout.trim() === ''
  };
}

/* Staging ----------------------------------------------------------------- */

export async function stagePaths(db: SqlDatabase, input: GitStageInput): Promise<GitStatus> {
  const s = session(db, input.repositoryId);
  // --all so that staging a deleted file stages the deletion.
  await execGit(s, ['add', '--all', '--', ...input.paths], { record: true });
  return await readStatus(s);
}

export async function unstagePaths(db: SqlDatabase, input: GitStageInput): Promise<GitStatus> {
  const s = session(db, input.repositoryId);

  // Before the first commit there is no HEAD to restore from; the index entry
  // is dropped instead.
  const head = await execGit(s, ['rev-parse', '--verify', '--quiet', 'HEAD'], { okExitCodes: [0, 1] });
  const hasHead = head.exitCode === 0;

  const args = hasHead
    ? ['restore', '--staged', '--', ...input.paths]
    : ['rm', '--cached', '-r', '--quiet', '--ignore-unmatch', '--', ...input.paths];

  await execGit(s, args, { record: true });
  return await readStatus(s);
}

/**
 * Throws away uncommitted work. The schema only admits `confirmed: true`, so a
 * caller that skipped the confirmation step fails validation before this runs.
 */
export async function discardPaths(db: SqlDatabase, input: GitDiscardInput): Promise<GitStatus> {
  const s = session(db, input.repositoryId);
  const status = await readStatus(s);
  const byPath = new Map(status.files.map((file) => [file.path, file]));

  const tracked: string[] = [];
  const untracked: string[] = [];
  for (const path of input.paths) {
    const file = byPath.get(path);
    if (file === undefined) {
      throw new StewardServiceError('NOT_FOUND', `there are no changes to discard in ${path}`);
    }
    if (file.conflicted) {
      throw new StewardServiceError(
        'GIT_MERGE_CONFLICT',
        `${path} is conflicted`,
        'Resolve the conflict or abort the merge instead of discarding the file.'
      );
    }
    if (file.unstaged === 'untracked') untracked.push(path);
    else tracked.push(path);
  }

  if (tracked.length > 0) {
    await execGit(s, ['restore', '--worktree', '--', ...tracked], { record: true, confirmed: true });
  }
  if (untracked.length > 0) {
    await execGit(s, ['clean', '--force', '--', ...untracked], { record: true, confirmed: true });
  }
  return await readStatus(s);
}

/* Commit ------------------------------------------------------------------ */

export async function commit(db: SqlDatabase, input: GitCommitInput): Promise<GitCommitResult> {
  const s = session(db, input.repositoryId);
  const status = await readStatus(s);

  if (status.files.some((file) => file.conflicted)) {
    throw new StewardServiceError(
      'GIT_MERGE_CONFLICT',
      'There are unresolved conflicts',
      'Resolve the conflicted files and stage them before committing.'
    );
  }
  const hasStaged = status.files.some((file) => file.staged !== null);
  if (!hasStaged && !status.mergeInProgress) {
    throw new StewardServiceError(
      'GIT_NOTHING_TO_COMMIT',
      'There is nothing staged to commit',
      'Stage at least one change first.'
    );
  }

  await execGit(s, ['commit', '--message', input.message], { record: true, timeoutMs: 120_000 });

  const sha = await execGit(s, ['rev-parse', '--short', 'HEAD']);
  const subject = await execGit(s, ['log', '-1', '--pretty=%s']);
  return { sha: sha.stdout.trim(), summary: subject.stdout.trim() };
}

/* Branches ---------------------------------------------------------------- */

export async function listBranches(db: SqlDatabase, repositoryId: string): Promise<GitBranchList> {
  const s = session(db, repositoryId);

  const refs = await execGit(s, [
    'for-each-ref',
    `--format=${BRANCH_FORMAT}`,
    '--sort=-committerdate',
    'refs/heads',
    'refs/remotes'
  ]);
  const branches = parseBranches(refs.stdout);

  // On a repository with no commits there are no refs yet, but HEAD still names
  // the branch that the first commit will create.
  const symbolic = await execGit(s, ['symbolic-ref', '--short', '--quiet', 'HEAD'], { okExitCodes: [0, 1] });
  const detached = symbolic.exitCode !== 0;
  const current = detached ? null : symbolic.stdout.trim() || null;

  return { current, detached, branches };
}

async function assertValidBranchName(s: GitSession, name: string): Promise<void> {
  // Rejects names Git would refuse, including ones containing spaces, `..`,
  // control characters or a leading hyphen.
  await execGit(s, ['check-ref-format', '--branch', name]);
}

export async function createBranch(db: SqlDatabase, input: GitCreateBranchInput): Promise<GitBranchList> {
  const s = session(db, input.repositoryId);
  await assertValidBranchName(s, input.name);

  const start = input.startPoint === undefined ? [] : [input.startPoint];
  const args =
    input.checkout === true ? ['switch', '--create', input.name, ...start] : ['branch', input.name, ...start];

  await execGit(s, args, { record: true });
  return await listBranches(db, input.repositoryId);
}

export async function checkoutBranch(db: SqlDatabase, input: GitCheckoutInput): Promise<GitStatus> {
  const s = session(db, input.repositoryId);
  await assertValidBranchName(s, input.name);

  const args = input.remote === true ? ['switch', '--track', input.name] : ['switch', input.name];
  await execGit(s, args, { record: true });
  return await readStatus(s);
}

export async function deleteBranch(db: SqlDatabase, input: GitDeleteBranchInput): Promise<GitBranchList> {
  const s = session(db, input.repositoryId);
  await assertValidBranchName(s, input.name);

  const force = input.force === true;
  const args = force ? ['branch', '--delete', '--force', input.name] : ['branch', '--delete', input.name];
  await execGit(s, args, { record: true, confirmed: force && input.confirmed === true });
  return await listBranches(db, input.repositoryId);
}

/* Remotes ----------------------------------------------------------------- */

async function resolveRemote(s: GitSession): Promise<string> {
  const out = await execGit(s, ['remote']);
  const remotes = out.stdout.split(/\r?\n/).filter((line) => line !== '');
  if (remotes.length === 0) {
    throw new StewardServiceError(
      'GIT_NO_REMOTE',
      'This repository has no remote configured',
      'Add one with `git remote add origin <url>`.'
    );
  }
  const preferred = s.repository.remoteName;
  if (preferred !== null && remotes.includes(preferred)) return preferred;
  return remotes.includes('origin') ? 'origin' : (remotes[0] as string);
}

const NETWORK_TIMEOUT_MS = 120_000;

export async function fetchRemote(db: SqlDatabase, repositoryId: string): Promise<GitSyncResult> {
  const s = session(db, repositoryId);
  const remote = await resolveRemote(s);
  const out = await execGit(s, ['fetch', '--prune', remote], { record: true, timeoutMs: NETWORK_TIMEOUT_MS });
  return { operation: 'fetch', output: trimOutput(out.stdout, out.stderr) };
}

export async function pull(db: SqlDatabase, input: GitPullInput): Promise<GitSyncResult> {
  const s = session(db, input.repositoryId);
  const status = await readStatus(s);

  if (status.detached || status.branch === null) {
    throw new StewardServiceError('GIT_FAILED', 'HEAD is detached', 'Check out a branch before pulling.');
  }
  if (status.upstream === null) {
    throw new StewardServiceError(
      'GIT_NO_REMOTE',
      'This branch has no upstream to pull from',
      'Push it once to set an upstream, or set one with `git branch --set-upstream-to`.'
    );
  }

  const strategy = input.mode === 'merge' ? ['--no-rebase', '--no-edit'] : ['--ff-only'];
  const out = await execGit(s, ['pull', ...strategy], { record: true, timeoutMs: NETWORK_TIMEOUT_MS });
  return { operation: 'pull', output: trimOutput(out.stdout, out.stderr) };
}

/** Pushes the current branch; sets the upstream on first push. Never forces. */
export async function push(db: SqlDatabase, repositoryId: string): Promise<GitSyncResult> {
  const s = session(db, repositoryId);
  const status = await readStatus(s);

  if (status.detached || status.branch === null) {
    throw new StewardServiceError('GIT_FAILED', 'HEAD is detached', 'Check out or create a branch before pushing.');
  }
  if (!status.hasCommits) {
    throw new StewardServiceError('GIT_FAILED', 'There is nothing to push yet', 'Make a first commit.');
  }

  const args =
    status.upstream === null
      ? ['push', '--set-upstream', await resolveRemote(s), status.branch]
      : ['push'];

  const out = await execGit(s, args, { record: true, timeoutMs: NETWORK_TIMEOUT_MS });
  return { operation: 'push', output: trimOutput(out.stdout, out.stderr) };
}

export async function abortMerge(db: SqlDatabase, repositoryId: string): Promise<GitStatus> {
  const s = session(db, repositoryId);
  if (!(await isMergeInProgress(s))) {
    throw new StewardServiceError('GIT_FAILED', 'There is no merge in progress');
  }
  await execGit(s, ['merge', '--abort'], { record: true, confirmed: true });
  return await readStatus(s);
}

/* History ----------------------------------------------------------------- */

export function listExecutions(db: SqlDatabase, repositoryId: string, limit = 50): Execution[] {
  session(db, repositoryId);
  return listExecutionsByRepository(db, repositoryId, limit);
}

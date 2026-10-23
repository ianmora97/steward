import type { GitDiff } from '@shared/schemas/git';
import type {
  GitCommitDetail,
  GitCommitDetailInput,
  GitCommitDiffInput,
  GitHistory,
  GitHistoryInput
} from '@shared/schemas/graph';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { execGit, type GitSession } from './git-exec';
import { session } from './git-ops.service';
import { LOG_FORMAT, parseCommitFiles, parseLog } from './git-parse';

/**
 * Read-only history for the commit graph. Nothing here writes to the
 * repository or the database; Git is asked each time, a page at a time, so a
 * history of any size loads without holding it all in memory.
 */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const HISTORY_TIMEOUT_MS = 60_000;
const MAX_DIFF_BYTES = 500_000;

/** A repository with no refs yet has no history; `git log` would fail instead of answering "nothing". */
async function hasHistory(s: GitSession, scope: GitHistoryInput['scope']): Promise<boolean> {
  if (scope === 'head') {
    const head = await execGit(s, ['rev-parse', '--verify', '--quiet', 'HEAD'], { okExitCodes: [0, 1] });
    return head.exitCode === 0;
  }
  const refs = await execGit(s, ['for-each-ref', '--count=1', '--format=%(refname)']);
  return refs.stdout.trim() !== '';
}

export async function getHistory(db: SqlDatabase, input: GitHistoryInput): Promise<GitHistory> {
  const s = session(db, input.repositoryId);
  if (!(await hasHistory(s, input.scope))) return { commits: [], hasMore: false };

  const out = await execGit(
    s,
    [
      'log',
      input.scope === 'all' ? '--all' : 'HEAD',
      // Parents always appear after their children, which the lane layout relies on.
      '--topo-order',
      '--decorate=full',
      '-z',
      `--format=${LOG_FORMAT}`,
      `--skip=${input.skip}`,
      `--max-count=${input.limit}`
    ],
    { timeoutMs: HISTORY_TIMEOUT_MS }
  );

  const commits = parseLog(out.stdout);
  return { commits, hasMore: commits.length === input.limit };
}

async function requireCommit(s: GitSession, sha: string): Promise<string> {
  const out = await execGit(s, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], { okExitCodes: [0, 1] });
  if (out.exitCode !== 0) {
    throw new StewardServiceError('NOT_FOUND', 'that commit no longer exists in this repository');
  }
  return out.stdout.trim();
}

export async function getCommitDetail(db: SqlDatabase, input: GitCommitDetailInput): Promise<GitCommitDetail> {
  const s = session(db, input.repositoryId);
  const sha = await requireCommit(s, input.sha);

  const format = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%cI', '%s', '%b'].join('%x1f');
  const shown = await execGit(s, ['show', '--no-patch', `--format=${format}`, sha]);
  const [
    fullSha = sha,
    parentsText = '',
    author = '',
    email = '',
    authorDate = '',
    committer = '',
    commitDate = '',
    subject = '',
    body = ''
  ] = shown.stdout.split('\x1f');
  const parents = parentsText === '' ? [] : parentsText.split(' ');

  // Merge commits are compared with their first parent: the changes the merge
  // brought into the branch, which is what a reader expects to see.
  const range = parents[0] === undefined ? ['--root', sha] : [parents[0], sha];
  const common = ['diff-tree', '-r', '-M', '--no-commit-id', '-z'];
  const names = await execGit(s, [...common, '--name-status', ...range], { timeoutMs: HISTORY_TIMEOUT_MS });
  const numbers = await execGit(s, [...common, '--numstat', ...range], { timeoutMs: HISTORY_TIMEOUT_MS });

  return {
    sha: fullSha,
    parents,
    author,
    email,
    authorDate,
    committer,
    commitDate,
    subject,
    body: body.trim(),
    files: parseCommitFiles(names.stdout, numbers.stdout),
    isMerge: parents.length > 1
  };
}

export async function getCommitDiff(db: SqlDatabase, input: GitCommitDiffInput): Promise<GitDiff> {
  const s = session(db, input.repositoryId);
  const sha = await requireCommit(s, input.sha);

  const parent = await execGit(s, ['rev-parse', '--verify', '--quiet', `${sha}^1`], { okExitCodes: [0, 1] });
  const base = parent.exitCode === 0 ? parent.stdout.trim() : EMPTY_TREE;

  const out = await execGit(
    s,
    ['diff', '--no-color', '--no-ext-diff', '--no-textconv', base, sha, '--', input.path],
    { maxOutputBytes: MAX_DIFF_BYTES, timeoutMs: HISTORY_TIMEOUT_MS }
  );
  const binary = /^Binary files .* differ$/m.test(out.stdout) || out.stdout.includes('GIT binary patch');

  return {
    path: input.path,
    staged: false,
    text: binary ? '' : out.stdout,
    binary,
    truncated: out.truncated,
    empty: out.stdout.trim() === ''
  };
}

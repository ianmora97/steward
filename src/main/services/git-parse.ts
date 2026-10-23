import type { GitBranch, GitFileChangeKind, GitFileEntry, GitStatus } from '@shared/schemas/git';

/**
 * Pure parsers for Git's machine-readable output. No process, no I/O: they are
 * unit-tested against captured output, and the integration tests check them
 * against real repositories.
 */
const SHORT_KIND: Record<string, GitFileChangeKind> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange'
};

function kindFromCode(code: string): GitFileChangeKind | null {
  return SHORT_KIND[code] ?? null;
}

/**
 * Parses `git status --porcelain=v2 --branch -z`.
 *
 * Records are NUL-separated, which is what makes paths with spaces, quotes or
 * newlines safe. A rename/copy record (`2`) is followed by one extra NUL field
 * holding the original path.
 */
export function parseStatusV2(output: string): Omit<GitStatus, 'mergeInProgress'> {
  let branch: string | null = null;
  let detached = false;
  let head: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let hasCommits = true;
  const files: GitFileEntry[] = [];

  const fields = output.split('\0');
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? '';
    if (field === '') continue;

    if (field.startsWith('# ')) {
      const [key, ...rest] = field.slice(2).split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') {
        if (value === '(initial)') hasCommits = false;
        else head = value;
      } else if (key === 'branch.head') {
        if (value === '(detached)') detached = true;
        else branch = value;
      } else if (key === 'branch.upstream') {
        upstream = value;
      } else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value);
        if (match !== null) {
          ahead = Number(match[1]);
          behind = Number(match[2]);
        }
      }
      continue;
    }

    const type = field[0];
    if (type === '1') {
      // 1 XY sub mH mI mW hH hI path
      const parts = field.split(' ');
      const xy = parts[1] ?? '..';
      const path = parts.slice(8).join(' ');
      files.push(entry(path, null, xy));
    } else if (type === '2') {
      // 2 XY sub mH mI mW hH hI Xscore path  \0 origPath
      const parts = field.split(' ');
      const xy = parts[1] ?? '..';
      const path = parts.slice(9).join(' ');
      const original = fields[index + 1] ?? null;
      index += 1;
      files.push(entry(path, original, xy));
    } else if (type === 'u') {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const parts = field.split(' ');
      const path = parts.slice(10).join(' ');
      files.push({ path, originalPath: null, staged: null, unstaged: null, conflicted: true });
    } else if (type === '?') {
      files.push({
        path: field.slice(2),
        originalPath: null,
        staged: null,
        unstaged: 'untracked',
        conflicted: false
      });
    }
    // '!' (ignored) is not requested, and any other record type is skipped
    // rather than guessed at.
  }

  return { branch, detached, head, upstream, ahead, behind, files, hasCommits };
}

function entry(path: string, originalPath: string | null, xy: string): GitFileEntry {
  return {
    path,
    originalPath,
    staged: kindFromCode(xy[0] ?? '.'),
    unstaged: kindFromCode(xy[1] ?? '.'),
    conflicted: false
  };
}

/** Field separator used in the `for-each-ref` format; ref names cannot contain control characters. */
export const REF_FIELD_SEPARATOR = '\x1f';

export const BRANCH_FORMAT = [
  '%(refname)',
  '%(refname:short)',
  '%(objectname:short)',
  '%(HEAD)',
  '%(upstream:short)',
  '%(upstream:track)'
].join('%1f');

export function parseBranches(output: string): GitBranch[] {
  const branches: GitBranch[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (line === '') continue;
    const [fullName = '', name = '', sha = '', headMark = '', upstream = '', track = ''] =
      line.split(REF_FIELD_SEPARATOR);

    const remote = fullName.startsWith('refs/remotes/');
    // `origin/HEAD` is a pointer, not a branch the user can act on.
    if (remote && fullName.endsWith('/HEAD')) continue;
    if (!remote && !fullName.startsWith('refs/heads/')) continue;

    const ahead = /ahead (\d+)/.exec(track);
    const behind = /behind (\d+)/.exec(track);

    branches.push({
      name,
      fullName,
      remote,
      current: headMark === '*',
      sha,
      upstream: upstream === '' ? null : upstream,
      ahead: ahead === null ? 0 : Number(ahead[1]),
      behind: behind === null ? 0 : Number(behind[1]),
      upstreamGone: track.includes('gone')
    });
  }

  return branches;
}

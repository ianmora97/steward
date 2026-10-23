import type { GitBranch, GitFileChangeKind, GitFileEntry, GitStatus } from '@shared/schemas/git';
import type { CommitFile, GraphCommit, GraphRef } from '@shared/schemas/graph';

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

/* History ----------------------------------------------------------------- */

/** `git log -z` record layout; the separator cannot appear in these fields. */
export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%aI', '%D', '%s'].join('%x1f');

/**
 * Parses the `%D` decoration list produced with `--decorate=full`, e.g.
 * `HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main`.
 * Full names are what let `feature/x` (local) be told apart from `origin/x`.
 */
export function parseRefs(decoration: string): GraphRef[] {
  const refs: GraphRef[] = [];

  for (const raw of decoration.split(', ')) {
    const token = raw.trim();
    if (token === '') continue;

    if (token === 'HEAD') {
      refs.push({ name: 'HEAD', kind: 'head', current: true });
    } else if (token.startsWith('HEAD -> refs/heads/')) {
      refs.push({ name: token.slice('HEAD -> refs/heads/'.length), kind: 'local', current: true });
    } else if (token.startsWith('tag: refs/tags/')) {
      refs.push({ name: token.slice('tag: refs/tags/'.length), kind: 'tag', current: false });
    } else if (token.startsWith('refs/heads/')) {
      refs.push({ name: token.slice('refs/heads/'.length), kind: 'local', current: false });
    } else if (token.startsWith('refs/remotes/')) {
      const name = token.slice('refs/remotes/'.length);
      // `origin/HEAD` is a pointer, not a branch.
      if (!name.endsWith('/HEAD')) refs.push({ name, kind: 'remote', current: false });
    }
  }

  return refs;
}

export function parseLog(output: string): GraphCommit[] {
  const commits: GraphCommit[] = [];

  for (const record of output.split('\0')) {
    if (record.trim() === '') continue;
    const [sha = '', parents = '', author = '', email = '', date = '', decoration = '', subject = ''] =
      record.replace(/^\n+/, '').split('\x1f');
    if (sha === '') continue;

    commits.push({
      sha,
      parents: parents === '' ? [] : parents.split(' '),
      author,
      email,
      date,
      subject,
      refs: parseRefs(decoration)
    });
  }

  return commits;
}

const STATUS_KIND: Record<string, CommitFile['status']> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange'
};

/**
 * Combines `diff-tree --name-status -z` and `--numstat -z` into one file list.
 * Rename/copy records carry two paths in both outputs.
 */
export function parseCommitFiles(nameStatus: string, numstat: string): CommitFile[] {
  const stats = new Map<string, { additions: number | null; deletions: number | null; binary: boolean }>();

  const numTokens = numstat.split('\0');
  for (let i = 0; i < numTokens.length; i += 1) {
    const token = numTokens[i] ?? '';
    if (token === '') continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(token);
    if (match === null) continue;
    const binary = match[1] === '-';
    const entry = {
      additions: binary ? null : Number(match[1]),
      deletions: binary ? null : Number(match[2]),
      binary
    };
    if (match[3] === '') {
      // Rename: the next two tokens are the old and new path.
      const newPath = numTokens[i + 2] ?? '';
      stats.set(newPath, entry);
      i += 2;
    } else {
      stats.set(match[3] ?? '', entry);
    }
  }

  const files: CommitFile[] = [];
  const tokens = nameStatus.split('\0');
  for (let i = 0; i < tokens.length; i += 1) {
    const code = tokens[i] ?? '';
    if (code === '') continue;
    const kind = STATUS_KIND[code[0] ?? ''];
    if (kind === undefined) continue;

    const twoPaths = code[0] === 'R' || code[0] === 'C';
    const first = tokens[i + 1] ?? '';
    const second = twoPaths ? (tokens[i + 2] ?? '') : null;
    i += twoPaths ? 2 : 1;

    const path = second ?? first;
    const stat = stats.get(path) ?? { additions: null, deletions: null, binary: false };
    files.push({ path, originalPath: twoPaths ? first : null, status: kind, ...stat });
  }

  return files;
}

import { describe, expect, it } from 'vitest';
import { classifyGitFailure, redact } from '@main/services/git-errors';
import { parseBranches, parseStatusV2 } from '@main/services/git-parse';

const SEP = '\x1f';

describe('parseStatusV2', () => {
  it('reads branch headers, ahead/behind and every record type', () => {
    const output = [
      '# branch.oid 1234567890abcdef',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 aaa bbb staged.txt',
      '1 .M N... 100644 100644 100644 aaa bbb dirty file.txt',
      '1 MM N... 100644 100644 100644 aaa bbb both.txt',
      '1 .D N... 100644 100644 000000 aaa bbb gone.txt',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new name.txt',
      'old name.txt',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt',
      '? new.txt',
      ''
    ].join('\0');

    const status = parseStatusV2(output);

    expect(status).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, hasCommits: true });
    expect(status.files).toEqual([
      { path: 'staged.txt', originalPath: null, staged: 'modified', unstaged: null, conflicted: false },
      { path: 'dirty file.txt', originalPath: null, staged: null, unstaged: 'modified', conflicted: false },
      { path: 'both.txt', originalPath: null, staged: 'modified', unstaged: 'modified', conflicted: false },
      { path: 'gone.txt', originalPath: null, staged: null, unstaged: 'deleted', conflicted: false },
      { path: 'new name.txt', originalPath: 'old name.txt', staged: 'renamed', unstaged: null, conflicted: false },
      { path: 'conflict.txt', originalPath: null, staged: null, unstaged: null, conflicted: true },
      { path: 'new.txt', originalPath: null, staged: null, unstaged: 'untracked', conflicted: false }
    ]);
  });

  it('handles an unborn branch and a detached HEAD', () => {
    expect(parseStatusV2('# branch.oid (initial)\0# branch.head main\0')).toMatchObject({
      hasCommits: false,
      branch: 'main',
      head: null
    });
    expect(parseStatusV2('# branch.oid abc\0# branch.head (detached)\0')).toMatchObject({
      detached: true,
      branch: null
    });
  });
});

describe('parseBranches', () => {
  it('parses local and remote branches, skipping the remote HEAD pointer', () => {
    const lines = [
      ['refs/heads/main', 'main', 'abc1234', '*', 'origin/main', '[ahead 2, behind 1]'],
      ['refs/heads/feature', 'feature', 'def5678', ' ', '', ''],
      ['refs/heads/old', 'old', 'aaa0000', ' ', 'origin/old', '[gone]'],
      ['refs/remotes/origin/HEAD', 'origin', 'abc1234', ' ', '', ''],
      ['refs/remotes/origin/main', 'origin/main', 'abc1234', ' ', '', '']
    ].map((fields) => fields.join(SEP));

    const branches = parseBranches(lines.join('\n') + '\n');

    expect(branches.map((b) => b.name)).toEqual(['main', 'feature', 'old', 'origin/main']);
    expect(branches[0]).toMatchObject({ current: true, ahead: 2, behind: 1, upstream: 'origin/main' });
    expect(branches[2]).toMatchObject({ upstreamGone: true });
    expect(branches[3]).toMatchObject({ remote: true });
  });
});

describe('classifyGitFailure', () => {
  const cases: Array<[string, string]> = [
    ['! [rejected] main -> main (non-fast-forward)', 'GIT_NON_FAST_FORWARD'],
    ['fatal: Not possible to fast-forward, aborting.', 'GIT_DIVERGED'],
    ['CONFLICT (content): Merge conflict in a.txt\nAutomatic merge failed', 'GIT_MERGE_CONFLICT'],
    ["fatal: could not read Username for 'https://github.com': terminal prompts disabled", 'GIT_AUTH_FAILED'],
    ['git@github.com: Permission denied (publickey).', 'GIT_AUTH_FAILED'],
    ["fatal: unable to access 'https://x/': Could not resolve host: x", 'GIT_NETWORK_FAILED'],
    ["fatal: repository 'https://github.com/a/b/' not found\nRepository not found", 'GIT_REMOTE_NOT_FOUND'],
    ["error: The branch 'x' is not fully merged.", 'GIT_UNMERGED_BRANCH'],
    ['error: Your local changes to the following files would be overwritten by checkout', 'GIT_LOCAL_CHANGES'],
    ['Author identity unknown\n*** Please tell me who you are.', 'GIT_IDENTITY_MISSING'],
    ["fatal: 'a b' is not a valid branch name", 'GIT_INVALID_REF'],
    ["fatal: a branch named 'x' already exists", 'CONFLICT'],
    ['fatal: something unexpected', 'GIT_FAILED']
  ];

  it.each(cases)('classifies %j as %s', (stderr, code) => {
    expect(classifyGitFailure('', stderr).code).toBe(code);
  });
});

describe('redact', () => {
  it('removes URL credentials and tokens', () => {
    const redacted = redact('fatal: unable to access https://user:ghp_abcdefghijklmnopqrstuvwx@github.com/a/b');
    expect(redacted).not.toMatch(/ghp_|user:/);
    expect(redact('token ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toBe('token ***');
  });
});

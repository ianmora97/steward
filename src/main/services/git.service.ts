import { basename, resolve } from 'node:path';
import type { Provider, RepositoryProbe } from '@shared/schemas/repository';
import { StewardServiceError } from '@shared/types/result';
import { runCommand } from '../exec/run';
import { validateExistingDirectory } from '../security/paths';

/**
 * Git is the source of truth. Steward asks the installed `git` and reports what
 * it says; it never guesses repository state and never reimplements Git.
 *
 * Every call passes the directory as `-C <dir>` in the argument array, so a
 * path or branch name containing shell metacharacters is inert data.
 */
const GIT = 'git';

export async function getGitVersion(): Promise<string | null> {
  try {
    const result = await runCommand(GIT, ['--version'], { timeoutMs: 5000 });
    if (result.exitCode !== 0) return null;
    return result.stdout.trim().replace(/^git version\s*/i, '') || null;
  } catch {
    return null;
  }
}

async function gitIn(dir: string, args: readonly string[]): Promise<{ ok: boolean; value: string }> {
  const result = await runCommand(GIT, ['-C', dir, ...args], { timeoutMs: 10_000 });
  return { ok: result.exitCode === 0, value: result.stdout.trim() };
}

export function providerFromRemoteUrl(remoteUrl: string | null): Provider {
  if (remoteUrl === null || remoteUrl.trim() === '') return 'unknown';
  return /(^|[@/.])github\.com([:/]|$)/i.test(remoteUrl) ? 'github' : 'other';
}

/**
 * Inspects a folder and reports whether it is a usable Git work tree.
 *
 * A folder that is not a repository is a normal, reportable outcome carried in
 * the returned probe, not an exception: the UI shows the reason. Exceptions are
 * reserved for a missing folder or a missing `git`.
 */
export async function probeRepository(candidatePath: string): Promise<RepositoryProbe> {
  const { path: dir } = validateExistingDirectory(candidatePath);

  const empty: RepositoryProbe = {
    localPath: dir,
    exists: true,
    isDirectory: true,
    isGitRepository: false,
    isBare: false,
    workTreeRoot: null,
    currentBranch: null,
    detachedHead: false,
    remoteName: null,
    remoteUrl: null,
    provider: 'unknown',
    reason: null
  };

  const version = await getGitVersion();
  if (version === null) {
    throw new StewardServiceError(
      'GIT_NOT_FOUND',
      'Git was not found on this system',
      'Steward uses the installed Git executable for all repository operations. Install Git and reopen this dialog.'
    );
  }

  const insideWorkTree = await gitIn(dir, ['rev-parse', '--is-inside-work-tree']);
  if (!insideWorkTree.ok || insideWorkTree.value !== 'true') {
    const bare = await gitIn(dir, ['rev-parse', '--is-bare-repository']);
    if (bare.ok && bare.value === 'true') {
      return {
        ...empty,
        isBare: true,
        reason: 'that folder is a bare repository, which has no working tree to inspect'
      };
    }
    return { ...empty, reason: 'that folder is not a Git repository' };
  }

  const toplevel = await gitIn(dir, ['rev-parse', '--show-toplevel']);
  // Git answers with forward slashes even on Windows; normalizing here keeps
  // stored paths in the platform's own form, so the UNIQUE (project_id,
  // local_path) constraint actually catches the same repository twice.
  const workTreeRoot = toplevel.ok && toplevel.value !== '' ? resolve(toplevel.value) : dir;

  // `symbolic-ref` also answers correctly on a repository with no commits yet,
  // where `rev-parse HEAD` would fail.
  const symbolic = await gitIn(dir, ['symbolic-ref', '--short', 'HEAD']);
  const detachedHead = !symbolic.ok;
  const currentBranch = symbolic.ok && symbolic.value !== '' ? symbolic.value : null;

  const remotes = await gitIn(dir, ['remote']);
  const remoteNames = remotes.ok ? remotes.value.split(/\r?\n/).filter((line) => line !== '') : [];
  const remoteName = remoteNames.includes('origin') ? 'origin' : (remoteNames[0] ?? null);

  let remoteUrl: string | null = null;
  if (remoteName !== null) {
    const url = await gitIn(dir, ['remote', 'get-url', remoteName]);
    remoteUrl = url.ok && url.value !== '' ? url.value : null;
  }

  let defaultBranch: string | null = null;
  if (remoteName !== null) {
    const headRef = await gitIn(dir, ['symbolic-ref', '--short', `refs/remotes/${remoteName}/HEAD`]);
    if (headRef.ok && headRef.value !== '') {
      defaultBranch = headRef.value.replace(`${remoteName}/`, '');
    }
  }

  return {
    localPath: workTreeRoot,
    exists: true,
    isDirectory: true,
    isGitRepository: true,
    isBare: false,
    workTreeRoot,
    currentBranch: currentBranch ?? defaultBranch,
    detachedHead,
    remoteName,
    remoteUrl,
    provider: providerFromRemoteUrl(remoteUrl),
    reason: null
  };
}

export function repositoryNameFromPath(path: string): string {
  const name = basename(path);
  return name === '' ? path : name;
}

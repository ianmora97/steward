import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';
import type { TerminalProfile } from '@shared/schemas/terminal';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { findCustomProfile, getTerminalSettings, listCustomProfiles } from '../db/terminal-settings.repo';

export function assertShellFile(path: string): void {
  let isFile: boolean;
  try {
    isFile = statSync(path).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    throw new StewardServiceError('SHELL_NOT_FOUND', 'that shell executable does not exist', path);
  }
}

function findOnPath(name: string): string | null {
  const dirs = (process.env['PATH'] ?? '').split(delimiter).filter((dir) => dir.length > 0);
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function firstExisting(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined && existsSync(candidate)) return candidate;
  }
  return null;
}

function detectWindowsProfiles(): TerminalProfile[] {
  const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env['LOCALAPPDATA'];

  // `git.exe` sits in <Git>\cmd or <Git>\mingw64\bin; bash.exe is in <Git>\bin.
  const gitExe = findOnPath('git.exe');
  const gitRoot = gitExe === null ? null : dirname(dirname(gitExe));
  const gitBash = firstExisting([
    gitRoot === null ? null : join(gitRoot, 'bin', 'bash.exe'),
    gitRoot === null ? null : join(dirname(gitRoot), 'bin', 'bash.exe'),
    join(programFiles, 'Git', 'bin', 'bash.exe'),
    programFilesX86 === undefined ? null : join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    localAppData === undefined ? null : join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe')
  ]);

  const entries: Array<{ id: string; name: string; file: string | null; args: string[] }> = [
    {
      id: 'builtin:pwsh',
      name: 'PowerShell',
      file: firstExisting([findOnPath('pwsh.exe'), join(programFiles, 'PowerShell', '7', 'pwsh.exe')]),
      args: []
    },
    {
      id: 'builtin:windows-powershell',
      name: 'Windows PowerShell',
      file: firstExisting([join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')]),
      args: []
    },
    {
      id: 'builtin:cmd',
      name: 'Command Prompt',
      file: firstExisting([join(systemRoot, 'System32', 'cmd.exe')]),
      args: []
    },
    { id: 'builtin:git-bash', name: 'Git Bash', file: gitBash, args: ['--login', '-i'] },
    {
      id: 'builtin:wsl',
      name: 'WSL',
      file: firstExisting([join(systemRoot, 'System32', 'wsl.exe')]),
      args: []
    }
  ];
  return toProfiles(entries);
}

function detectUnixProfiles(): TerminalProfile[] {
  const files: string[] = [];
  const fromEnv = process.env['SHELL'];
  if (fromEnv !== undefined && fromEnv.length > 0) files.push(fromEnv);
  try {
    for (const line of readFileSync('/etc/shells', 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('/')) files.push(trimmed);
    }
  } catch {
    // No /etc/shells: $SHELL (or the /bin/sh fallback below) is enough.
  }
  files.push('/bin/sh');

  const seen = new Set<string>();
  const entries: Array<{ id: string; name: string; file: string | null; args: string[] }> = [];
  for (const file of files) {
    const name = basename(file);
    if (seen.has(file) || seen.has(`name:${name}`)) continue;
    seen.add(file);
    seen.add(`name:${name}`);
    entries.push({ id: `builtin:${name}`, name, file: firstExisting([file]), args: [] });
  }
  return toProfiles(entries);
}

function toProfiles(
  entries: Array<{ id: string; name: string; file: string | null; args: string[] }>
): TerminalProfile[] {
  const profiles: TerminalProfile[] = [];
  for (const entry of entries) {
    if (entry.file !== null) {
      profiles.push({ id: entry.id, name: entry.name, file: entry.file, args: entry.args, kind: 'detected' });
    }
  }
  return profiles;
}

/** Shells found on this machine right now. Cheap file checks, so it is not cached: installs show up without a restart. */
export function detectProfiles(): TerminalProfile[] {
  return process.platform === 'win32' ? detectWindowsProfiles() : detectUnixProfiles();
}

export function listProfiles(db: SqlDatabase): TerminalProfile[] {
  return [...detectProfiles(), ...listCustomProfiles(db)];
}

/**
 * The profile a new terminal opens: the one asked for, else the project's
 * default, else the first detected shell. The executable is re-checked on
 * every launch because it can have been uninstalled since it was saved.
 */
export function resolveProfile(db: SqlDatabase, projectId: string, profileId: string | undefined): TerminalProfile {
  const wanted = profileId ?? getTerminalSettings(db, projectId).defaultProfileId;
  const detected = detectProfiles();

  let profile: TerminalProfile | null = null;
  if (wanted !== null && wanted !== undefined) {
    profile = detected.find((candidate) => candidate.id === wanted) ?? findCustomProfile(db, wanted);
    if (profile === null && profileId !== undefined) {
      throw new StewardServiceError('NOT_FOUND', 'that shell profile no longer exists');
    }
  }
  // A stale default (profile deleted, shell uninstalled) falls back instead of blocking every new terminal.
  profile ??= detected[0] ?? null;
  if (profile === null) {
    throw new StewardServiceError('SHELL_NOT_FOUND', 'no shell was found on this machine; add a custom profile');
  }
  assertShellFile(profile.file);
  return profile;
}

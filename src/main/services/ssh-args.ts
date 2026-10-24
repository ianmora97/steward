import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { StewardServiceError } from '@shared/types/result';

export const SSH = 'ssh';

/**
 * ConPTY (node-pty on Windows) does not search PATH: it needs the full path of
 * the executable, or it fails with "File not found". `spawn` does search PATH,
 * so the two agree when this returns the first `ssh.exe` PATH would find.
 */
export function resolveSshExecutable(): string {
  if (process.platform !== 'win32') return SSH;
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, 'ssh.exe');
    if (existsSync(candidate)) return candidate;
  }
  const builtIn = join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32', 'OpenSSH', 'ssh.exe');
  return existsSync(builtIn) ? builtIn : SSH;
}

export interface SshTarget {
  host: string;
  port: number | null;
  username: string | null;
  identityFile: string | null;
}

export function sshDestination(target: SshTarget): string {
  return target.username === null ? target.host : `${target.username}@${target.host}`;
}

/** ssh parses `-o Key="value with spaces"`; forward slashes survive on every platform. */
function knownHostsOption(file: string): string {
  const path = file.replace(/\\/g, '/');
  return `UserKnownHostsFile=${/\s/.test(path) ? `"${path}"` : path}`;
}

export interface SshArgsOptions {
  knownHostsFile: string;
  /** No password or passphrase prompts: for runs nobody is typing into. */
  batch: boolean;
}

/**
 * Everything before the destination. Host keys are always checked strictly
 * against Steward's own known_hosts, which only the user's explicit "trust"
 * decision writes to, so nothing is ever trusted on first use.
 */
export function sshOptionArgs(target: SshTarget, options: SshArgsOptions): string[] {
  if (target.host.startsWith('-') || (target.username?.startsWith('-') ?? false)) {
    throw new StewardServiceError('VALIDATION_FAILED', 'that host cannot be used');
  }
  return [
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    knownHostsOption(options.knownHostsFile),
    '-o',
    'ServerAliveInterval=30',
    ...(options.batch ? ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'] : []),
    ...(target.port === null ? [] : ['-p', String(target.port)]),
    // IdentitiesOnly: offer just this key instead of every key in the agent, which can exhaust the server's auth attempts.
    ...(target.identityFile === null ? [] : ['-i', target.identityFile, '-o', 'IdentitiesOnly=yes'])
  ];
}

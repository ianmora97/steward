import type { DockerTarget } from '@shared/schemas/docker';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { findEnvironmentById } from '../db/environment.repo';
import { findSshHost, type SshHostRecord } from '../db/ssh-host.repo';
import { runCommand, type RunResult } from '../exec/run';
import { streamCommand, type StreamHandle, type StreamHandlers } from '../exec/stream';
import { classifyDockerFailure } from './docker-errors';
import { remoteCommandLine } from './remote-quote';
import { SSH, sshDestination, sshOptionArgs } from './ssh-args';
import { classifySshFailure } from './ssh-errors';

const DOCKER = 'docker';

/** What runs inside a container for an interactive shell: bash when the image has it, sh otherwise. */
export const CONTAINER_SHELL_ARGS: readonly string[] = ['sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'];
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_OUTPUT_BYTES = 4_000_000;

export type ResolvedTarget =
  | { kind: 'local' }
  | { kind: 'ssh'; host: SshHostRecord; protectedEnvironment: boolean };

export interface DockerRunOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Local runs only (Compose runs in a repository folder). */
  cwd?: string;
}

export interface DockerExecDeps {
  db: SqlDatabase;
  /** Steward's own known_hosts, the same file the SSH service uses. */
  knownHostsFile: string;
}

/**
 * The single place a `docker` command is launched, locally or on an SSH server.
 * Callers pass argument arrays only. Remotely, ssh hands one string to the
 * server's shell, so every word is quoted here and the values were validated by
 * their schemas before getting this far.
 */
export function createDockerExec(deps: DockerExecDeps) {
  const { db } = deps;

  function resolveTarget(projectId: string, target: DockerTarget): ResolvedTarget {
    if (target.kind === 'local') return { kind: 'local' };
    const host = findSshHost(db, target.sshHostId);
    if (host === null || host.projectId !== projectId) {
      throw new StewardServiceError('NOT_FOUND', 'that server is not part of this project');
    }
    const environment = host.environmentId === null ? null : findEnvironmentById(db, host.environmentId);
    return { kind: 'ssh', host, protectedEnvironment: environment?.isProtected === true };
  }

  function sshArgs(host: SshHostRecord, args: readonly string[]): string[] {
    return [
      ...sshOptionArgs(host, { knownHostsFile: deps.knownHostsFile, batch: true }),
      '--',
      sshDestination(host),
      remoteCommandLine([DOCKER, ...args])
    ];
  }

  /** A failed ssh (255) or timeout is the connection's fault, not docker's; it keeps the SSH error codes. */
  function throwIfSshFailed(result: RunResult): void {
    if (!result.timedOut && result.exitCode !== 255) return;
    const failure = classifySshFailure(result.stderr, result.timedOut);
    throw new StewardServiceError(failure.code, failure.message, failure.hint);
  }

  async function run(target: ResolvedTarget, args: readonly string[], options: DockerRunOptions = {}): Promise<RunResult> {
    const limits = {
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
    };

    if (target.kind === 'local') {
      let result: RunResult;
      try {
        result = await runCommand(DOCKER, args, { ...limits, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) });
      } catch (error) {
        if (error instanceof StewardServiceError && error.code === 'NOT_FOUND') {
          throw new StewardServiceError(
            'DOCKER_NOT_FOUND',
            'Docker is not installed on this machine',
            'Install Docker Desktop (or the Docker engine) and make sure `docker` is on your PATH.'
          );
        }
        throw error;
      }
      if (result.timedOut) {
        throw new StewardServiceError('DOCKER_FAILED', 'docker did not answer in time', 'The daemon may be starting or stuck.');
      }
      return result;
    }

    const result = await runCommand(SSH, sshArgs(target.host, args), limits);
    throwIfSshFailed(result);
    return result;
  }

  /** Like `run`, but a non-zero exit becomes an error carrying what the page can act on. */
  async function runChecked(
    target: ResolvedTarget,
    args: readonly string[],
    options: DockerRunOptions = {}
  ): Promise<RunResult> {
    const result = await run(target, args, options);
    if (result.exitCode !== 0) {
      const failure = classifyDockerFailure(result.stderr);
      throw new StewardServiceError(failure.code, failure.message, failure.hint ?? undefined);
    }
    return result;
  }

  function stream(target: ResolvedTarget, args: readonly string[], handlers: StreamHandlers): StreamHandle {
    if (target.kind === 'local') return streamCommand(DOCKER, args, handlers);
    return streamCommand(SSH, sshArgs(target.host, args), handlers);
  }

  /**
   * On a server in a protected environment a destructive action needs the exact
   * name typed in. Main checks it against the real name; locally nothing is protected.
   */
  function requireTypedName(
    target: ResolvedTarget,
    acceptedNames: readonly string[],
    confirmation: { name: string } | undefined,
    thing: string
  ): void {
    if (target.kind !== 'ssh' || !target.protectedEnvironment) return;
    if (confirmation === undefined) {
      throw new StewardServiceError(
        'CONFIRMATION_REQUIRED',
        `${target.host.name} is in a protected environment`,
        `Type the name of the ${thing} to confirm.`
      );
    }
    if (!acceptedNames.includes(confirmation.name)) {
      throw new StewardServiceError('CONFIRMATION_MISMATCH', `that is not the name of the ${thing}`);
    }
  }

  return { resolveTarget, run, runChecked, stream, requireTypedName };
}

export type DockerExec = ReturnType<typeof createDockerExec>;

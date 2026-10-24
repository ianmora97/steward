import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn as spawnPty, type IPty } from 'node-pty';
import {
  TERMINAL_LOG_CAP_BYTES,
  TERMINAL_MAX_SESSIONS,
  TERMINAL_RING_BYTES,
  type TerminalAttachResult,
  type TerminalCreateInput,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type TerminalListInput,
  type TerminalResizeInput,
  type TerminalSession,
  type TerminalSessionIdInput,
  type TerminalWriteInput
} from '@shared/schemas/terminal';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { insertExecution, updateExecutionFinish } from '../db/execution.repo';
import { nowIso, uuidv7 } from '../db/id';
import { findRepositoryById } from '../db/repository.repo';
import { findSshHost } from '../db/ssh-host.repo';
import { resolveExecutable } from '../exec/resolve';
import { runCommand } from '../exec/run';
import { validateExistingDirectory } from '../security/paths';
import { CONTAINER_SHELL_ARGS } from './docker-exec';
import { redactSecrets } from './git-errors';
import { remoteCommandLine } from './remote-quote';
import { resolveSshExecutable, sshDestination, sshOptionArgs } from './ssh-args';
import { resolveProfile } from './terminal-shell';
import { requireProject } from './project.service';

/** Output is coalesced for a few ms so a flooding command does not become thousands of IPC messages. */
const FLUSH_INTERVAL_MS = 8;

export interface TerminalServiceDeps {
  db: SqlDatabase;
  logDirectory: string;
  /** Steward's own known_hosts, shared with the SSH service so a shell trusts exactly what the user approved. */
  knownHostsFile: string;
  emitData: (event: TerminalDataEvent) => void;
  emitExit: (event: TerminalExitEvent) => void;
}

export interface TerminalService {
  create: (input: TerminalCreateInput) => TerminalSession;
  write: (input: TerminalWriteInput) => void;
  resize: (input: TerminalResizeInput) => void;
  close: (input: TerminalSessionIdInput) => void;
  list: (input: TerminalListInput) => TerminalSession[];
  attach: (input: TerminalSessionIdInput) => TerminalAttachResult;
  closeByProject: (projectId: string) => void;
  closeByRepository: (repositoryId: string) => void;
  closeBySshHost: (sshHostId: string) => void;
  shutdown: () => void;
}

interface LiveSession {
  session: TerminalSession;
  pty: IPty;
  ring: string[];
  ringLength: number;
  log: WriteStream | null;
  logBytes: number;
  pending: string;
  totalChars: number;
  flushTimer: NodeJS.Timeout | null;
  startedAtMs: number;
  closing: boolean;
  finished: boolean;
}

export function createTerminalService(deps: TerminalServiceDeps): TerminalService {
  const { db } = deps;
  const sessions = new Map<string, LiveSession>();

  function requireSession(sessionId: string): LiveSession {
    const live = sessions.get(sessionId);
    if (live === undefined) {
      throw new StewardServiceError('NOT_FOUND', 'that terminal session no longer exists');
    }
    return live;
  }

  function runningCount(): number {
    let count = 0;
    for (const live of sessions.values()) {
      if (live.session.status === 'running') count += 1;
    }
    return count;
  }

  function pushRing(live: LiveSession, chunk: string): void {
    live.ring.push(chunk);
    live.ringLength += chunk.length;
    while (live.ringLength > TERMINAL_RING_BYTES && live.ring.length > 1) {
      live.ringLength -= (live.ring.shift() as string).length;
    }
  }

  function writeLog(live: LiveSession, chunk: string): void {
    if (live.log === null) return;
    const text = redactSecrets(chunk);
    const size = Buffer.byteLength(text);
    if (live.logBytes + size > TERMINAL_LOG_CAP_BYTES) {
      live.log.end('\n[steward] log cap reached; further output is not saved\n');
      live.log = null;
      live.session = { ...live.session, truncated: true };
      return;
    }
    live.logBytes += size;
    live.log.write(text);
  }

  function flush(live: LiveSession): void {
    if (live.flushTimer !== null) {
      clearTimeout(live.flushTimer);
      live.flushTimer = null;
    }
    if (live.pending.length === 0) return;
    const data = live.pending;
    live.pending = '';
    deps.emitData({ sessionId: live.session.id, data, offset: live.totalChars - data.length });
  }

  function onData(live: LiveSession, chunk: string): void {
    pushRing(live, chunk);
    writeLog(live, chunk);
    live.pending += chunk;
    live.totalChars += chunk.length;
    live.flushTimer ??= setTimeout(() => flush(live), FLUSH_INTERVAL_MS);
  }

  /** Idempotent: both the pty exit event and app shutdown can reach it. */
  function finish(live: LiveSession, exitCode: number | null): void {
    if (live.finished) return;
    live.finished = true;
    flush(live);
    live.log?.end();
    live.log = null;

    const status = live.closing ? 'cancelled' : exitCode === 0 ? 'succeeded' : 'failed';
    live.session = { ...live.session, status: 'exited', exitCode };
    try {
      updateExecutionFinish(db, live.session.executionId, {
        status,
        exitCode,
        finishedAt: nowIso(),
        durationMs: Date.now() - live.startedAtMs,
        errorCode: null,
        errorMessage: null
      });
    } catch (error) {
      console.error('[steward] could not close terminal execution:', error);
    }
    deps.emitExit({ sessionId: live.session.id, exitCode });
  }

  function killTree(live: LiveSession): void {
    const pid = live.pty.pid;
    try {
      live.pty.kill();
    } catch {
      // Already gone.
    }
    if (process.platform === 'win32' && pid > 0) {
      // ConPTY does not always take grandchildren down with the shell.
      void runCommand('taskkill', ['/pid', String(pid), '/T', '/F'], { timeoutMs: 5000 }).catch(() => undefined);
    }
  }

  interface Launch {
    repositoryId: string | null;
    sshHostId: string | null;
    dockerContainer: string | null;
    file: string;
    args: string[];
    /** The shell or `user@host` shown in the Activity history and the tab. */
    label: string;
    cwd: string;
    profileName: string;
  }

  function resolveLaunch(input: TerminalCreateInput): Launch {
    const containerId = input.docker?.containerId ?? null;
    if (input.sshHostId !== undefined) {
      const host = findSshHost(db, input.sshHostId);
      if (host === null || host.projectId !== input.projectId) {
        throw new StewardServiceError('NOT_FOUND', 'that SSH host is not part of this project');
      }
      const destination = sshDestination(host);
      if (containerId !== null) {
        return {
          repositoryId: null,
          sshHostId: host.id,
          dockerContainer: containerId,
          file: resolveSshExecutable(),
          // -t: with a command, ssh only allocates a terminal when asked, and docker exec -it needs one.
          args: [
            ...sshOptionArgs(host, { knownHostsFile: deps.knownHostsFile, batch: false }),
            '-t',
            '--',
            destination,
            remoteCommandLine(['docker', 'exec', '-it', containerId, ...CONTAINER_SHELL_ARGS])
          ],
          label: `${destination} · ${containerId}`,
          cwd: homedir(),
          profileName: `Docker · ${containerId} @ ${host.name}`
        };
      }
      return {
        repositoryId: null,
        sshHostId: host.id,
        dockerContainer: null,
        file: resolveSshExecutable(),
        // Interactive: no BatchMode, so a password or passphrase can be typed into the terminal itself.
        args: [...sshOptionArgs(host, { knownHostsFile: deps.knownHostsFile, batch: false }), '--', destination],
        label: destination,
        cwd: homedir(),
        profileName: `SSH · ${host.name}`
      };
    }
    if (containerId !== null) {
      return {
        repositoryId: null,
        sshHostId: null,
        dockerContainer: containerId,
        file: resolveExecutable('docker'),
        args: ['exec', '-it', containerId, ...CONTAINER_SHELL_ARGS],
        label: 'docker',
        cwd: homedir(),
        profileName: `Docker · ${containerId}`
      };
    }
    const repository = input.repositoryId === undefined ? null : findRepositoryById(db, input.repositoryId);
    if (repository === null || repository.projectId !== input.projectId) {
      throw new StewardServiceError('NOT_FOUND', 'that repository is not part of this project');
    }
    const shell = resolveProfile(db, input.projectId, input.profileId);
    return {
      repositoryId: repository.id,
      sshHostId: null,
      dockerContainer: null,
      file: shell.file,
      args: shell.args,
      label: shell.file,
      cwd: validateExistingDirectory(repository.localPath).path,
      profileName: shell.name
    };
  }

  function create(input: TerminalCreateInput): TerminalSession {
    requireProject(db, input.projectId);
    if (runningCount() >= TERMINAL_MAX_SESSIONS) {
      throw new StewardServiceError(
        'TERMINAL_LIMIT',
        `at most ${TERMINAL_MAX_SESSIONS} terminals can be open at once; close one first`
      );
    }

    const launch = resolveLaunch(input);
    const { cwd } = launch;
    const shell = { file: launch.file, args: launch.args, name: launch.profileName };

    const id = uuidv7();
    const executionId = uuidv7();
    const startedAt = nowIso();
    const logPath = join(deps.logDirectory, `${executionId}.log`);

    insertExecution(db, {
      id: executionId,
      projectId: input.projectId,
      repositoryId: launch.repositoryId,
      kind: launch.sshHostId === null ? 'local_command' : 'ssh_shell',
      context: launch.sshHostId === null ? 'local' : 'remote',
      command: shell.file,
      // For a remote shell the ssh flags are fixed policy; what matters in the history is where it connected.
      args: launch.sshHostId === null ? shell.args : [launch.label],
      cwd: launch.sshHostId === null ? cwd : null,
      status: 'running',
      exitCode: null,
      confirmedByUser: false,
      startedAt,
      finishedAt: null,
      durationMs: null,
      errorCode: null,
      errorMessage: null,
      logPath,
      sshHostId: launch.sshHostId
    });

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }

    let pty: IPty;
    try {
      pty = spawnPty(shell.file, shell.args, {
        name: 'xterm-256color',
        cols: input.cols,
        rows: input.rows,
        cwd,
        env
      });
    } catch (error) {
      updateExecutionFinish(db, executionId, {
        status: 'failed',
        exitCode: null,
        finishedAt: nowIso(),
        durationMs: 0,
        errorCode: 'SPAWN_FAILED',
        errorMessage: 'the shell could not be started'
      });
      console.error('[steward] terminal spawn failed:', error);
      if (launch.sshHostId !== null) {
        throw new StewardServiceError(
          'SSH_NOT_FOUND',
          'The OpenSSH client could not be started',
          'Install OpenSSH (on Windows: Settings → Optional features → OpenSSH Client) and make sure `ssh` is on your PATH.'
        );
      }
      throw new StewardServiceError('SPAWN_FAILED', 'the shell could not be started', shell.file);
    }

    let log: WriteStream | null = null;
    try {
      mkdirSync(deps.logDirectory, { recursive: true });
      log = createWriteStream(logPath, { flags: 'a' });
      log.on('error', (error) => {
        console.error('[steward] terminal log failed:', error);
        log = null;
      });
    } catch (error) {
      console.error('[steward] could not open terminal log:', error);
    }

    const session: TerminalSession = {
      id,
      projectId: input.projectId,
      repositoryId: launch.repositoryId,
      sshHostId: launch.sshHostId,
      dockerContainer: launch.dockerContainer,
      executionId,
      shell: shell.file,
      profileName: shell.name,
      cwd: launch.sshHostId === null && launch.dockerContainer === null ? cwd : launch.label,
      status: 'running',
      exitCode: null,
      truncated: false,
      startedAt
    };
    const live: LiveSession = {
      session,
      pty,
      ring: [],
      ringLength: 0,
      log,
      logBytes: 0,
      pending: '',
      totalChars: 0,
      flushTimer: null,
      startedAtMs: Date.now(),
      closing: false,
      finished: false
    };
    sessions.set(id, live);

    pty.onData((chunk) => onData(live, chunk));
    pty.onExit(({ exitCode }) => finish(live, exitCode));
    return session;
  }

  function write(input: TerminalWriteInput): void {
    const live = sessions.get(input.sessionId);
    if (live === undefined || live.session.status !== 'running') return;
    live.pty.write(input.data);
  }

  function resize(input: TerminalResizeInput): void {
    const live = sessions.get(input.sessionId);
    if (live === undefined || live.session.status !== 'running') return;
    try {
      live.pty.resize(input.cols, input.rows);
    } catch {
      // The pty died between the check and the call; the exit event will follow.
    }
  }

  function close(input: TerminalSessionIdInput): void {
    const live = sessions.get(input.sessionId);
    if (live === undefined) return;
    sessions.delete(input.sessionId);
    if (live.session.status === 'running') {
      live.closing = true;
      killTree(live);
    }
  }

  function list(input: TerminalListInput): TerminalSession[] {
    return [...sessions.values()]
      .filter((live) => live.session.projectId === input.projectId)
      .map((live) => live.session)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  function attach(input: TerminalSessionIdInput): TerminalAttachResult {
    const live = requireSession(input.sessionId);
    return { session: live.session, buffer: live.ring.join(''), offset: live.totalChars };
  }

  function closeWhere(predicate: (live: LiveSession) => boolean): void {
    for (const [id, live] of [...sessions]) {
      if (predicate(live)) close({ sessionId: id });
    }
  }

  return {
    create,
    write,
    resize,
    close,
    list,
    attach,
    closeByProject: (projectId) => closeWhere((live) => live.session.projectId === projectId),
    closeByRepository: (repositoryId) => closeWhere((live) => live.session.repositoryId === repositoryId),
    closeBySshHost: (sshHostId) => closeWhere((live) => live.session.sshHostId === sshHostId),
    shutdown: () => {
      for (const live of sessions.values()) {
        if (live.session.status === 'running') {
          live.closing = true;
          killTree(live);
          // The app is quitting: do not wait for an exit event that may never be delivered.
          finish(live, null);
        }
      }
      sessions.clear();
    }
  };
}

import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  SshCommandResult,
  SshConnection,
  SshCreateInput,
  SshHost,
  SshHostIdInput,
  SshHostKey,
  SshListExecutionsInput,
  SshListInput,
  SshRunCommandInput,
  SshScanResult,
  SshTrustInput,
  SshUpdateInput
} from '@shared/schemas/ssh';
import type { Execution } from '@shared/schemas/git';
import { StewardServiceError, type StewardErrorCode } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import {
  findLastFinishedExecution,
  insertExecution,
  listExecutionsBySshHost,
  updateExecutionFinish
} from '../db/execution.repo';
import { nowIso, uuidv7 } from '../db/id';
import {
  deleteSshHost,
  findSshHost,
  findSshHostByName,
  insertSshHost,
  listSshHosts,
  updateSshHost,
  type SshHostRecord
} from '../db/ssh-host.repo';
import { runCommand, type RunResult } from '../exec/run';
import { validateExistingFile } from '../security/paths';
import { redactSecrets } from './git-errors';
import { requireProject } from './project.service';
import { findEnvironmentById } from '../db/environment.repo';
import { SSH, sshDestination, sshOptionArgs } from './ssh-args';
import { classifySshFailure, type ClassifiedSshFailure } from './ssh-errors';

const CHECK_TIMEOUT_MS = 15_000;
const SCAN_TIMEOUT_MS = 20_000;
const KIND_COMMAND = 'ssh_command';
const KIND_CHECK = 'ssh_check';
const KIND_DEPLOY = 'deploy';

export interface SshServiceDeps {
  db: SqlDatabase;
  /** Steward's own known_hosts. Only an explicit trust decision writes to it. */
  knownHostsFile: string;
  logDirectory: string;
}

export interface SshDeployInput {
  hostId: string;
  /** The full remote command, already composed by the deploy runner. */
  command: string;
  timeoutSeconds: number;
  /** Called as soon as the execution row exists, so a deployment can point at it while it runs. */
  onExecutionStarted?: (executionId: string) => void;
  /** A line the composed command prints to stderr the moment it begins; seeing it proves the command started. */
  startMarker: string;
}

/**
 * What a deploy needs to judge a remote run, kept apart from `SshCommandResult`
 * because it must tell "the command failed" from "ssh could not tell us" and
 * from "it did not finish in time", which `runCommand` folds into errors.
 */
export interface SshDeployOutcome {
  executionId: string;
  exitCode: number | null;
  timedOut: boolean;
  /**
   * The start marker reached stderr, so the command began on the server. Without it a failure happened
   * before that (connection, authentication, host key, a failed `cd`); with it, an ssh exit of 255 or no
   * exit code at all can also mean the connection died while the command was running.
   */
  commandStarted: boolean;
  /** Set when ssh itself failed (could not connect, authenticate or finish), not when the command exited non-zero. */
  failureCode: StewardErrorCode | null;
  failureMessage: string | null;
}

export interface SshService {
  list: (input: SshListInput) => SshHost[];
  create: (input: SshCreateInput) => SshHost;
  update: (input: SshUpdateInput) => SshHost;
  remove: (input: SshHostIdInput) => { id: string };
  test: (input: SshHostIdInput) => Promise<SshHost>;
  scanHostKey: (input: SshHostIdInput) => Promise<SshScanResult>;
  trustHostKey: (input: SshTrustInput) => Promise<SshHost>;
  runCommand: (input: SshRunCommandInput) => Promise<SshCommandResult>;
  /** Runs a deploy command and records it as a `deploy` execution. Throws only if nothing could be started. */
  runDeploy: (input: SshDeployInput) => Promise<SshDeployOutcome>;
  listExecutions: (input: SshListExecutionsInput) => Execution[];
}

interface RemoteRun {
  executionId: string;
  run: RunResult;
  stdout: string;
  stderr: string;
  /** Set when ssh itself failed (could not connect, authenticate or finish in time), not when the remote command did. */
  failure: ClassifiedSshFailure | null;
}

function unknownConnection(): SshConnection {
  return { state: 'unknown', checkedAt: null, message: null, hint: null };
}

export function createSshService(deps: SshServiceDeps): SshService {
  const { db } = deps;
  // Live, deliberately not persisted: a stored "connected" would go stale the moment the network changes.
  const connections = new Map<string, SshConnection>();

  function requireHost(id: string): SshHostRecord {
    const host = findSshHost(db, id);
    if (host === null) throw new StewardServiceError('NOT_FOUND', 'that SSH host no longer exists');
    return host;
  }

  function toView(record: SshHostRecord): SshHost {
    const last = findLastFinishedExecution(db, record.id, KIND_COMMAND);
    const lastStatus = last?.status;
    const lastCommand =
      last === null ||
      last.finishedAt === null ||
      (lastStatus !== 'succeeded' && lastStatus !== 'failed' && lastStatus !== 'cancelled' && lastStatus !== 'timed_out')
        ? null
        : {
            executionId: last.id,
            command: last.args[1] ?? '',
            status: lastStatus,
            exitCode: last.exitCode,
            finishedAt: last.finishedAt
          };
    return {
      id: record.id,
      projectId: record.projectId,
      name: record.name,
      host: record.host,
      port: record.port,
      username: record.username,
      identityFile: record.identityFile,
      environmentId: record.environmentId,
      environment: record.environmentName,
      provider: record.provider,
      region: record.region,
      domain: record.domain,
      ipAddress: record.ipAddress,
      description: record.description,
      vpcName: record.vpcName,
      vpcId: record.vpcId,
      vpcCidr: record.vpcCidr,
      createdAt: record.createdAt,
      connection: connections.get(record.id) ?? unknownConnection(),
      lastCommand,
      operational: lastCommand === null ? 'none' : lastCommand.status === 'succeeded' ? 'healthy' : 'failing'
    };
  }

  function setConnection(hostId: string, connection: Omit<SshConnection, 'checkedAt'>): void {
    connections.set(hostId, { ...connection, checkedAt: nowIso() });
  }

  function keyPath(path: string | null): string | null {
    return path === null ? null : validateExistingFile(path).path;
  }

  /** The environment's name, only if it belongs to the same project: a mismatch looks like "not found". */
  function environmentNameFor(projectId: string, environmentId: string | null): string | null {
    if (environmentId === null) return null;
    const environment = findEnvironmentById(db, environmentId);
    if (environment === null || environment.projectId !== projectId) {
      throw new StewardServiceError('NOT_FOUND', 'that environment no longer exists');
    }
    return environment.name;
  }

  function assertNameFree(projectId: string, name: string, exceptId: string | null): void {
    const clash = findSshHostByName(db, projectId, name);
    if (clash !== null && clash.id !== exceptId) {
      throw new StewardServiceError('CONFLICT', 'a host with that name already exists in this project');
    }
  }

  function writeLog(path: string, stdout: string, stderr: string): string | null {
    try {
      mkdirSync(deps.logDirectory, { recursive: true });
      writeFileSync(path, `--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`);
      return path;
    } catch (error) {
      console.error('[steward] could not write ssh log:', error);
      return null;
    }
  }

  /** Runs one non-interactive command on the host and records it, whatever the outcome. */
  async function runRemote(
    host: SshHostRecord,
    kind: string,
    remoteCommand: string,
    timeoutMs: number,
    onStarted?: (executionId: string) => void
  ): Promise<RemoteRun> {
    const executionId = uuidv7();
    const startedAt = nowIso();
    const destination = sshDestination(host);
    const logPath = join(deps.logDirectory, `${executionId}.log`);

    insertExecution(db, {
      id: executionId,
      projectId: host.projectId,
      repositoryId: null,
      kind,
      context: 'remote',
      command: SSH,
      args: [destination, remoteCommand],
      cwd: null,
      status: 'running',
      exitCode: null,
      confirmedByUser: true,
      startedAt,
      finishedAt: null,
      durationMs: null,
      errorCode: null,
      errorMessage: null,
      logPath: null,
      sshHostId: host.id
    });
    onStarted?.(executionId);

    let run: RunResult;
    try {
      run = await runCommand(
        SSH,
        [
          ...sshOptionArgs(host, { knownHostsFile: deps.knownHostsFile, batch: true }),
          '--',
          destination,
          remoteCommand
        ],
        { timeoutMs }
      );
    } catch (error) {
      const notFound = error instanceof StewardServiceError && error.code === 'NOT_FOUND';
      updateExecutionFinish(db, executionId, {
        status: 'failed',
        exitCode: null,
        finishedAt: nowIso(),
        durationMs: Date.now() - Date.parse(startedAt),
        errorCode: notFound ? 'SSH_NOT_FOUND' : 'SSH_FAILED',
        errorMessage: notFound ? 'OpenSSH client not found' : 'ssh could not be started'
      });
      if (notFound) {
        throw new StewardServiceError(
          'SSH_NOT_FOUND',
          'The OpenSSH client was not found',
          'Install OpenSSH (on Windows: Settings → Optional features → OpenSSH Client) and make sure `ssh` is on your PATH.'
        );
      }
      throw error;
    }

    const stdout = redactSecrets(run.stdout);
    const stderr = redactSecrets(run.stderr);
    const failure = run.timedOut || run.exitCode === 255 ? classifySshFailure(stderr, run.timedOut) : null;
    const status = run.timedOut ? 'timed_out' : run.exitCode === 0 ? 'succeeded' : 'failed';

    // The log is written first so the row never points at a file that was not created.
    const savedLog = writeLog(logPath, stdout, stderr);
    db.prepare('UPDATE executions SET log_path = :log_path WHERE id = :id').run({ id: executionId, log_path: savedLog });
    updateExecutionFinish(db, executionId, {
      status,
      exitCode: run.exitCode,
      finishedAt: nowIso(),
      durationMs: run.durationMs,
      errorCode: failure?.code ?? null,
      errorMessage: failure?.message ?? null
    });

    if (failure !== null) {
      setConnection(host.id, { state: failure.state, message: failure.message, hint: failure.hint ?? null });
    } else {
      setConnection(host.id, { state: 'connected', message: null, hint: null });
    }
    return { executionId, run, stdout, stderr, failure };
  }

  async function resolveEndpoint(host: SshHostRecord): Promise<{ hostname: string; port: number }> {
    let result: RunResult;
    try {
      result = await runCommand(
        SSH,
        ['-G', ...(host.port === null ? [] : ['-p', String(host.port)]), '--', sshDestination(host)],
        { timeoutMs: 10_000 }
      );
    } catch (error) {
      if (error instanceof StewardServiceError && error.code === 'NOT_FOUND') {
        throw new StewardServiceError('SSH_NOT_FOUND', 'The OpenSSH client was not found');
      }
      throw error;
    }
    const field = (name: string): string | undefined =>
      new RegExp(`^${name}\\s+(\\S+)`, 'im').exec(result.stdout)?.[1];
    const hostname = field('hostname');
    const port = Number(field('port'));
    if (result.exitCode !== 0 || hostname === undefined || !Number.isInteger(port)) {
      throw new StewardServiceError('SSH_FAILED', 'ssh could not resolve that host from its configuration');
    }
    return { hostname, port };
  }

  async function fingerprintsOf(lines: string[]): Promise<SshHostKey[]> {
    // ssh-keygen reads a file, not stdin, on every platform it ships for.
    const scratch = join(dirname(deps.knownHostsFile), `scan-${uuidv7()}.tmp`);
    mkdirSync(dirname(scratch), { recursive: true });
    writeFileSync(scratch, `${lines.join('\n')}\n`);
    try {
      const result = await runCommand('ssh-keygen', ['-l', '-f', scratch], { timeoutMs: 10_000 });
      const keys: SshHostKey[] = [];
      for (const line of result.stdout.split(/\r?\n/)) {
        const match = /^\d+\s+(\S+)\s+.*\(([A-Za-z0-9-]+)\)\s*$/.exec(line.trim());
        if (match?.[1] !== undefined && match[2] !== undefined) {
          keys.push({ type: match[2], fingerprint: match[1] });
        }
      }
      if (keys.length === 0) {
        throw new StewardServiceError('SSH_FAILED', 'the host key could not be read');
      }
      return keys;
    } catch (error) {
      if (error instanceof StewardServiceError && error.code === 'NOT_FOUND') {
        throw new StewardServiceError('SSH_NOT_FOUND', 'The OpenSSH client was not found');
      }
      throw error;
    } finally {
      try {
        unlinkSync(scratch);
      } catch {
        // Scratch file already gone.
      }
    }
  }

  async function fetchHostKeys(
    host: SshHostRecord
  ): Promise<{ hostname: string; port: number; lines: string[]; keys: SshHostKey[] }> {
    const { hostname, port } = await resolveEndpoint(host);
    let scan: RunResult;
    try {
      scan = await runCommand('ssh-keyscan', ['-T', '10', '-p', String(port), '--', hostname], {
        timeoutMs: SCAN_TIMEOUT_MS
      });
    } catch (error) {
      if (error instanceof StewardServiceError && error.code === 'NOT_FOUND') {
        throw new StewardServiceError('SSH_NOT_FOUND', 'The OpenSSH client was not found');
      }
      throw error;
    }
    const lines = scan.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    if (lines.length === 0) {
      throw new StewardServiceError(
        'SSH_UNREACHABLE',
        'Steward could not read a host key from that host',
        'Check the host name and port, your network or VPN, and that the SSH server is running.'
      );
    }
    return { hostname, port, lines, keys: await fingerprintsOf(lines) };
  }

  async function test(input: SshHostIdInput): Promise<SshHost> {
    const host = requireHost(input.id);
    await runRemote(host, KIND_CHECK, 'exit 0', CHECK_TIMEOUT_MS);
    return toView(host);
  }

  return {
    list: (input) => {
      requireProject(db, input.projectId);
      return listSshHosts(db, input.projectId).map(toView);
    },

    create: (input) => {
      requireProject(db, input.projectId);
      assertNameFree(input.projectId, input.name, null);
      const now = nowIso();
      const record: SshHostRecord = {
        id: uuidv7(),
        projectId: input.projectId,
        name: input.name,
        host: input.host,
        port: input.port,
        username: input.username,
        identityFile: keyPath(input.identityFile),
        environmentId: input.environmentId,
        environmentName: environmentNameFor(input.projectId, input.environmentId),
        provider: input.provider,
        region: input.region,
        domain: input.domain,
        ipAddress: input.ipAddress,
        description: input.description,
        vpcName: input.vpcName,
        vpcId: input.vpcId,
        vpcCidr: input.vpcCidr,
        createdAt: now,
        updatedAt: now
      };
      insertSshHost(db, record);
      return toView(record);
    },

    update: (input) => {
      const existing = requireHost(input.id);
      assertNameFree(existing.projectId, input.name, existing.id);
      const next: SshHostRecord = {
        ...existing,
        name: input.name,
        host: input.host,
        port: input.port,
        username: input.username,
        identityFile: keyPath(input.identityFile),
        environmentId: input.environmentId,
        environmentName: environmentNameFor(existing.projectId, input.environmentId),
        provider: input.provider,
        region: input.region,
        domain: input.domain,
        ipAddress: input.ipAddress,
        description: input.description,
        vpcName: input.vpcName,
        vpcId: input.vpcId,
        vpcCidr: input.vpcCidr,
        updatedAt: nowIso()
      };
      updateSshHost(db, next);
      // A changed target is a different machine: what was learned about the old one no longer applies.
      if (next.host !== existing.host || next.port !== existing.port || next.username !== existing.username ||
        next.identityFile !== existing.identityFile
      ) {
        connections.delete(existing.id);
      }
      return toView(next);
    },

    remove: (input) => {
      requireHost(input.id);
      deleteSshHost(db, input.id);
      connections.delete(input.id);
      return { id: input.id };
    },

    test,

    scanHostKey: async (input) => {
      const { hostname, port, keys } = await fetchHostKeys(requireHost(input.id));
      return { hostname, port, keys };
    },

    trustHostKey: async (input) => {
      const host = requireHost(input.id);
      const fetched = await fetchHostKeys(host);
      const shown = new Set(input.fingerprints);
      // The key being trusted must be the one the user looked at, not whatever answers a second later.
      if (!fetched.keys.every((key) => shown.has(key.fingerprint))) {
        throw new StewardServiceError(
          'CONFLICT',
          'The host key changed while you were reviewing it, so nothing was trusted',
          'Open the review again and compare the new fingerprint.'
        );
      }
      mkdirSync(dirname(deps.knownHostsFile), { recursive: true });
      const current = existsSync(deps.knownHostsFile) ? readFileSync(deps.knownHostsFile, 'utf8') : '';
      const fresh = fetched.lines.filter((line) => !current.includes(line));
      if (fresh.length > 0) {
        const separator = current !== '' && !current.endsWith('\n') ? '\n' : '';
        appendFileSync(deps.knownHostsFile, `${separator}${fresh.join('\n')}\n`);
      }
      return await test({ id: host.id });
    },

    runCommand: async (input) => {
      const host = requireHost(input.id);
      const remote = await runRemote(host, KIND_COMMAND, input.command, input.timeoutSeconds * 1000);
      if (remote.failure !== null) {
        throw new StewardServiceError(remote.failure.code, remote.failure.message, remote.failure.hint);
      }
      const exitCode = remote.run.exitCode ?? -1;
      return {
        executionId: remote.executionId,
        exitCode,
        status: exitCode === 0 ? 'succeeded' : 'failed',
        stdout: remote.stdout,
        stderr: remote.stderr,
        truncated: remote.run.truncated,
        durationMs: remote.run.durationMs
      };
    },

    runDeploy: async (input) => {
      const host = requireHost(input.hostId);
      const remote = await runRemote(host, KIND_DEPLOY, input.command, input.timeoutSeconds * 1000, input.onExecutionStarted);
      return {
        executionId: remote.executionId,
        exitCode: remote.run.exitCode,
        timedOut: remote.run.timedOut,
        commandStarted: remote.stderr.includes(input.startMarker),
        failureCode: remote.failure?.code ?? null,
        failureMessage: remote.failure?.message ?? null
      };
    },

    listExecutions: (input) => {
      requireHost(input.id);
      return listExecutionsBySshHost(db, input.id, input.limit);
    }
  };
}

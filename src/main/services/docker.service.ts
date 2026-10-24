import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DOCKER_LOG_TAIL_DEFAULT,
  DOCKER_MAX_LOG_STREAMS,
  type DockerCommandOutput,
  type DockerComposeActionInput,
  type DockerComposeListInput,
  type DockerComposeProject,
  type DockerComposeRepositoryInput,
  type DockerComposeService,
  type DockerContainer,
  type DockerContainerActionInput,
  type DockerContainerDetail,
  type DockerContainerIdInput,
  type DockerContainerStats,
  type DockerImage,
  type DockerImagePullInput,
  type DockerImageRemoveInput,
  type DockerLogEndEvent,
  type DockerLogEvent,
  type DockerLogsStarted,
  type DockerLogsStartInput,
  type DockerLogsStopInput,
  type DockerNetwork,
  type DockerNetworkRemoveInput,
  type DockerPruneInput,
  type DockerStartInput,
  type DockerStartResult,
  type DockerState,
  type DockerStatus,
  type DockerTargetInput,
  type DockerVolume,
  type DockerVolumeRemoveInput
} from '@shared/schemas/docker';
import { StewardServiceError, type StewardErrorCode } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { insertExecution, updateExecutionFinish } from '../db/execution.repo';
import { nowIso, uuidv7 } from '../db/id';
import { findRepositoryById } from '../db/repository.repo';
import { runCommand, type RunOptions, type RunResult } from '../exec/run';
import type { StreamHandle } from '../exec/stream';
import { validateExistingDirectory } from '../security/paths';
import { classifyDockerFailure } from './docker-errors';
import type { DockerExec, ResolvedTarget } from './docker-exec';
import {
  parseComposeServices,
  parseContainers,
  parseImages,
  parseInspect,
  parseNetworks,
  parseStats,
  parseVolumes
} from './docker-parse';
import { redactSecrets } from './git-errors';
import { requireProject } from './project.service';
import { listRepositories } from './repository.service';

const JSON_FORMAT = '{{json .}}';
/** Long enough for `docker stop`'s grace period and a slow `rm`. */
const ACTION_TIMEOUT_MS = 60_000;
const PULL_TIMEOUT_MS = 600_000;
const COMPOSE_TIMEOUT_MS = 300_000;
/** How long a daemon that has not answered yet counts as "starting" after Steward launched Docker Desktop. */
const START_GRACE_MS = 150_000;
const OUTPUT_TAIL_CHARS = 4000;
/** Lines are batched for this long before they cross to the renderer. */
const LOG_FLUSH_MS = 100;

export const COMPOSE_FILE_NAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'] as const;

export interface DockerServiceDeps {
  db: SqlDatabase;
  exec: DockerExec;
  emitLog: (event: DockerLogEvent) => void;
  emitLogEnd: (event: DockerLogEndEvent) => void;
}

interface LogSubscription {
  id: string;
  projectId: string;
  sshHostId: string | null;
  handle: StreamHandle | null;
  stopped: boolean;
}

function stateForCode(code: StewardErrorCode): DockerState {
  if (code === 'DOCKER_NOT_FOUND') return 'not_installed';
  if (code === 'DOCKER_DAEMON_DOWN') return 'daemon_down';
  if (code === 'DOCKER_PERMISSION') return 'permission_denied';
  if (code.startsWith('SSH_')) return 'unreachable';
  return 'error';
}

function tail(text: string): string {
  const redacted = redactSecrets(text).trim();
  return redacted.length > OUTPUT_TAIL_CHARS ? `…${redacted.slice(-OUTPUT_TAIL_CHARS)}` : redacted;
}

export function createDockerService(deps: DockerServiceDeps) {
  const { db, exec } = deps;
  const subscriptions = new Map<string, LogSubscription>();
  // When this app last launched Docker Desktop; null once the daemon answers or the grace window passes.
  let launchedAt: number | null = null;

  /** Resolves the target and makes sure the project exists, so every call is scoped to a real project. */
  function prepare(input: DockerTargetInput): ResolvedTarget {
    requireProject(db, input.projectId);
    return exec.resolveTarget(input.projectId, input.target);
  }

  /** A change (not a read) is recorded in the activity history, whatever the outcome. */
  async function runLogged(
    projectId: string,
    target: ResolvedTarget,
    args: string[],
    options: RunOptions = {}
  ): Promise<RunResult> {
    const executionId = uuidv7();
    const startedAt = nowIso();
    insertExecution(db, {
      id: executionId,
      projectId,
      repositoryId: null,
      kind: 'docker_action',
      context: target.kind === 'local' ? 'local' : 'remote',
      command: 'docker',
      args,
      cwd: options.cwd ?? null,
      status: 'running',
      exitCode: null,
      confirmedByUser: true,
      startedAt,
      finishedAt: null,
      durationMs: null,
      errorCode: null,
      errorMessage: null,
      logPath: null,
      sshHostId: target.kind === 'ssh' ? target.host.id : null
    });
    try {
      const result = await exec.runChecked(target, args, options);
      updateExecutionFinish(db, executionId, {
        status: 'succeeded',
        exitCode: result.exitCode,
        finishedAt: nowIso(),
        durationMs: result.durationMs,
        errorCode: null,
        errorMessage: null
      });
      return result;
    } catch (error) {
      const known = error instanceof StewardServiceError;
      updateExecutionFinish(db, executionId, {
        status: 'failed',
        exitCode: null,
        finishedAt: nowIso(),
        durationMs: Date.now() - Date.parse(startedAt),
        errorCode: known ? error.code : 'UNKNOWN',
        errorMessage: known ? error.message : 'docker could not be run'
      });
      throw error;
    }
  }

  // ── status ────────────────────────────────────────────────────────────────

  /**
   * While Docker Desktop is coming up (we launched it a moment ago) a daemon that does not answer yet is
   * reported as "starting", not as an error. Only this machine: a server's daemon is never started from here.
   */
  function whileStarting(target: ResolvedTarget, current: DockerStatus): DockerStatus {
    if (target.kind !== 'local') return current;
    if (current.state === 'ready') {
      launchedAt = null;
      return current;
    }
    if (current.state === 'daemon_down' && launchedAt !== null && Date.now() - launchedAt < START_GRACE_MS) {
      return {
        ...current,
        state: 'starting',
        message: 'Docker is starting',
        hint: 'Docker Desktop can take a minute or two to come up. This page updates by itself.'
      };
    }
    return current;
  }

  async function status(input: DockerTargetInput): Promise<DockerStatus> {
    const target = prepare(input);
    return whileStarting(target, await readStatus(target));
  }

  async function readStatus(target: ResolvedTarget): Promise<DockerStatus> {
    try {
      const result = await exec.run(target, ['version', '--format', '{{.Client.Version}}|{{.Server.Version}}'], {
        timeoutMs: 10_000
      });
      if (result.exitCode === 0) {
        const [cli, server] = result.stdout.trim().split('|');
        return {
          state: 'ready',
          cliVersion: cli === undefined || cli === '' ? null : cli,
          serverVersion: server === undefined || server === '' ? null : server,
          message: null,
          hint: null
        };
      }
      const failure = classifyDockerFailure(result.stderr);
      return { state: failure.state, cliVersion: null, serverVersion: null, message: failure.message, hint: failure.hint };
    } catch (error) {
      if (error instanceof StewardServiceError) {
        return {
          state: stateForCode(error.code),
          cliVersion: null,
          serverVersion: null,
          message: error.message,
          hint: error.details ?? null
        };
      }
      throw error;
    }
  }

  /**
   * Launches Docker Desktop without waiting for it. `docker desktop start --detach` is the supported way;
   * where that command does not exist (older Desktop) the platform's own launcher is the fallback. Every
   * command here is fixed: nothing the user typed reaches it.
   */
  async function launchDesktop(): Promise<void> {
    const viaCli = await runCommand('docker', ['desktop', 'start', '--detach'], { timeoutMs: 30_000 });
    if (viaCli.exitCode === 0) return;

    let fallback: RunResult | null = null;
    if (process.platform === 'win32') {
      const executable = join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe');
      // `start` hands the app to Windows and returns, so it is not tied to this process (and not killed by a timeout).
      if (existsSync(executable)) fallback = await runCommand('cmd', ['/c', 'start', '', executable], { timeoutMs: 15_000 });
    } else if (process.platform === 'darwin') {
      fallback = await runCommand('open', ['-g', '-a', 'Docker'], { timeoutMs: 15_000 });
    } else {
      fallback = await runCommand('systemctl', ['--user', 'start', 'docker-desktop'], { timeoutMs: 15_000 });
    }
    if (fallback?.exitCode === 0) return;

    throw new StewardServiceError(
      'DOCKER_FAILED',
      'Steward could not start Docker Desktop',
      'Is Docker Desktop installed? On a Linux machine with the plain Docker engine, run `sudo systemctl start docker`.'
    );
  }

  async function startEngine(input: DockerStartInput): Promise<DockerStartResult> {
    requireProject(db, input.projectId);
    const local: ResolvedTarget = { kind: 'local' };
    const current = whileStarting(local, await readStatus(local));
    if (current.state === 'ready') return { launched: false, state: 'ready' };
    if (current.state === 'starting') return { launched: false, state: 'starting' };
    if (current.state !== 'daemon_down') {
      throw new StewardServiceError('DOCKER_FAILED', current.message ?? 'Docker cannot be started from here', current.hint ?? undefined);
    }
    await launchDesktop();
    launchedAt = Date.now();
    return { launched: true, state: 'starting' };
  }

  // ── containers ────────────────────────────────────────────────────────────

  async function fetchContainers(target: ResolvedTarget): Promise<DockerContainer[]> {
    const result = await exec.runChecked(target, ['ps', '-a', '--format', JSON_FORMAT]);
    return parseContainers(result.stdout);
  }

  async function listContainers(input: DockerTargetInput): Promise<DockerContainer[]> {
    return fetchContainers(prepare(input));
  }

  async function containerStats(input: DockerTargetInput): Promise<DockerContainerStats[]> {
    const result = await exec.runChecked(prepare(input), ['stats', '--no-stream', '--format', JSON_FORMAT], {
      timeoutMs: 30_000
    });
    return parseStats(result.stdout);
  }

  async function inspectContainer(input: DockerContainerIdInput): Promise<DockerContainerDetail> {
    const result = await exec.runChecked(prepare(input), ['inspect', '--type', 'container', input.containerId]);
    const detail = parseInspect(result.stdout);
    if (detail === null) throw new StewardServiceError('NOT_FOUND', 'that container no longer exists');
    return detail;
  }

  async function containerAction(input: DockerContainerActionInput): Promise<{ containerId: string }> {
    const target = prepare(input);
    const { containerId, action } = input;

    if (action === 'kill' || action === 'remove') {
      if (target.kind === 'ssh' && target.protectedEnvironment) {
        const named = await exec.runChecked(target, ['inspect', '--type', 'container', '--format', '{{.Name}}', containerId]);
        exec.requireTypedName(target, [named.stdout.trim().replace(/^\//, '')], input.confirmation, 'container');
      }
    }

    const args = action === 'remove' ? ['rm', containerId] : [action, containerId];
    await runLogged(input.projectId, target, args, { timeoutMs: ACTION_TIMEOUT_MS });
    return { containerId };
  }

  // ── images ────────────────────────────────────────────────────────────────

  async function listImages(input: DockerTargetInput): Promise<DockerImage[]> {
    const target = prepare(input);
    const [images, containers] = await Promise.all([
      exec.runChecked(target, ['images', '--format', JSON_FORMAT]),
      fetchContainers(target)
    ]);
    return parseImages(images.stdout, containers);
  }

  async function pullImage(input: DockerImagePullInput): Promise<DockerCommandOutput> {
    const target = prepare(input);
    const result = await runLogged(input.projectId, target, ['pull', input.image], {
      timeoutMs: PULL_TIMEOUT_MS,
      maxOutputBytes: 200_000
    });
    return { output: tail(result.stdout) };
  }

  async function removeImage(input: DockerImageRemoveInput): Promise<{ image: string }> {
    const target = prepare(input);
    exec.requireTypedName(target, [input.image], input.confirmation, 'image');
    await runLogged(input.projectId, target, ['rmi', input.image], { timeoutMs: ACTION_TIMEOUT_MS });
    return { image: input.image };
  }

  async function systemDf(input: DockerTargetInput): Promise<DockerCommandOutput> {
    const result = await exec.runChecked(prepare(input), ['system', 'df']);
    return { output: result.stdout.trim() };
  }

  async function prune(input: DockerPruneInput): Promise<DockerCommandOutput> {
    const target = prepare(input);
    // There is no single object to name, so on a protected server the server's own name is the word to type.
    if (target.kind === 'ssh') exec.requireTypedName(target, [target.host.name], input.confirmation, 'server');
    const args: Record<DockerPruneInput['kind'], string[]> = {
      containers: ['container', 'prune', '-f'],
      images: ['image', 'prune', '-f'],
      volumes: ['volume', 'prune', '-f'],
      networks: ['network', 'prune', '-f'],
      system: ['system', 'prune', '-f']
    };
    const result = await runLogged(input.projectId, target, args[input.kind], { timeoutMs: ACTION_TIMEOUT_MS });
    return { output: tail(result.stdout) };
  }

  // ── volumes and networks ──────────────────────────────────────────────────

  async function listVolumes(input: DockerTargetInput): Promise<DockerVolume[]> {
    const result = await exec.runChecked(prepare(input), ['volume', 'ls', '--format', JSON_FORMAT]);
    return parseVolumes(result.stdout);
  }

  async function removeVolume(input: DockerVolumeRemoveInput): Promise<{ name: string }> {
    const target = prepare(input);
    exec.requireTypedName(target, [input.name], input.confirmation, 'volume');
    await runLogged(input.projectId, target, ['volume', 'rm', input.name], { timeoutMs: ACTION_TIMEOUT_MS });
    return { name: input.name };
  }

  async function listNetworks(input: DockerTargetInput): Promise<DockerNetwork[]> {
    const result = await exec.runChecked(prepare(input), ['network', 'ls', '--format', JSON_FORMAT]);
    return parseNetworks(result.stdout);
  }

  async function removeNetwork(input: DockerNetworkRemoveInput): Promise<{ name: string }> {
    const target = prepare(input);
    exec.requireTypedName(target, [input.name], input.confirmation, 'network');
    await runLogged(input.projectId, target, ['network', 'rm', input.name], { timeoutMs: ACTION_TIMEOUT_MS });
    return { name: input.name };
  }

  // ── logs ──────────────────────────────────────────────────────────────────

  function startLogs(input: DockerLogsStartInput): DockerLogsStarted {
    const target = prepare(input);
    if (subscriptions.size >= DOCKER_MAX_LOG_STREAMS) {
      throw new StewardServiceError(
        'DOCKER_TOO_MANY_STREAMS',
        `at most ${DOCKER_MAX_LOG_STREAMS} log views can be open at once`,
        'Close one first.'
      );
    }

    const id = uuidv7();
    const subscription: LogSubscription = {
      id,
      projectId: input.projectId,
      sshHostId: target.kind === 'ssh' ? target.host.id : null,
      handle: null,
      stopped: false
    };
    subscriptions.set(id, subscription);

    const partial = { out: '', err: '' };
    const queued: { out: string[]; err: string[] } = { out: [], err: [] };
    let timer: NodeJS.Timeout | null = null;

    const flush = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      for (const stream of ['out', 'err'] as const) {
        if (queued[stream].length === 0) continue;
        const lines = queued[stream].map((line) => redactSecrets(line));
        queued[stream] = [];
        deps.emitLog({ subscriptionId: id, stream, lines });
      }
    };

    try {
      subscription.handle = exec.stream(
        target,
        ['logs', '--tail', String(input.tail ?? DOCKER_LOG_TAIL_DEFAULT), '--timestamps', '--follow', input.containerId],
        {
          onData: (stream, text) => {
            const pieces = (partial[stream] + text).split('\n');
            partial[stream] = pieces.pop() ?? '';
            for (const piece of pieces) queued[stream].push(piece.replace(/\r$/, ''));
            timer ??= setTimeout(flush, LOG_FLUSH_MS);
          },
          onExit: (result) => {
            for (const stream of ['out', 'err'] as const) {
              if (partial[stream] !== '') queued[stream].push(partial[stream]);
              partial[stream] = '';
            }
            flush();
            subscriptions.delete(id);
            const message =
              result.error ??
              (!subscription.stopped && result.exitCode !== 0 ? `docker exited with code ${result.exitCode ?? 'unknown'}` : null);
            deps.emitLogEnd({
              subscriptionId: id,
              reason: subscription.stopped ? 'stopped' : message === null ? 'exited' : 'error',
              message
            });
          }
        }
      );
    } catch (error) {
      subscriptions.delete(id);
      throw error;
    }
    return { subscriptionId: id };
  }

  function stopLogs(input: DockerLogsStopInput): { subscriptionId: string } {
    const subscription = subscriptions.get(input.subscriptionId);
    if (subscription !== undefined) {
      subscription.stopped = true;
      subscription.handle?.kill();
    }
    return { subscriptionId: input.subscriptionId };
  }

  function closeWhere(predicate: (subscription: LogSubscription) => boolean): void {
    for (const subscription of subscriptions.values()) {
      if (predicate(subscription)) {
        subscription.stopped = true;
        subscription.handle?.kill();
      }
    }
  }

  // ── compose (local) ───────────────────────────────────────────────────────

  function composeFileIn(directory: string): string | null {
    return COMPOSE_FILE_NAMES.find((name) => existsSync(join(directory, name))) ?? null;
  }

  function listComposeProjects(input: DockerComposeListInput): DockerComposeProject[] {
    requireProject(db, input.projectId);
    const found: DockerComposeProject[] = [];
    for (const repository of listRepositories(db, input.projectId)) {
      const file = composeFileIn(repository.localPath);
      if (file !== null) found.push({ repositoryId: repository.id, repositoryName: repository.name, file });
    }
    return found;
  }

  function composeContext(input: DockerComposeRepositoryInput): { cwd: string; file: string } {
    requireProject(db, input.projectId);
    const repository = findRepositoryById(db, input.repositoryId);
    if (repository === null || repository.projectId !== input.projectId) {
      throw new StewardServiceError('NOT_FOUND', 'that repository is not part of this project');
    }
    const cwd = validateExistingDirectory(repository.localPath).path;
    const file = composeFileIn(cwd);
    if (file === null) throw new StewardServiceError('NOT_FOUND', 'that repository has no Compose file');
    return { cwd, file };
  }

  async function composeServices(input: DockerComposeRepositoryInput): Promise<DockerComposeService[]> {
    const { cwd, file } = composeContext(input);
    const result = await exec.runChecked({ kind: 'local' }, ['compose', '-f', file, 'ps', '-a', '--format', 'json'], { cwd });
    return parseComposeServices(result.stdout);
  }

  async function composeAction(input: DockerComposeActionInput): Promise<DockerCommandOutput> {
    const { cwd, file } = composeContext(input);
    const base = ['compose', '-f', file];
    const args: Record<DockerComposeActionInput['action'], string[]> = {
      up: [...base, 'up', '-d'],
      down: [...base, 'down', ...(input.removeVolumes === true ? ['-v'] : [])],
      restart: [...base, 'restart'],
      stop: [...base, 'stop'],
      pull: [...base, 'pull']
    };
    const result = await runLogged(input.projectId, { kind: 'local' }, args[input.action], {
      cwd,
      timeoutMs: COMPOSE_TIMEOUT_MS,
      maxOutputBytes: 200_000
    });
    // Compose reports progress on stderr.
    return { output: tail(`${result.stdout}\n${result.stderr}`) };
  }

  return {
    status,
    startEngine,
    listContainers,
    containerStats,
    inspectContainer,
    containerAction,
    listImages,
    pullImage,
    removeImage,
    systemDf,
    prune,
    listVolumes,
    removeVolume,
    listNetworks,
    removeNetwork,
    startLogs,
    stopLogs,
    listComposeProjects,
    composeServices,
    composeAction,
    closeByProject: (projectId: string): void => closeWhere((subscription) => subscription.projectId === projectId),
    closeBySshHost: (sshHostId: string): void => closeWhere((subscription) => subscription.sshHostId === sshHostId),
    shutdown: (): void => closeWhere(() => true)
  };
}

export type DockerService = ReturnType<typeof createDockerService>;

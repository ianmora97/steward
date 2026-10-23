import type { Execution } from '@shared/schemas/git';
import type { Repository } from '@shared/schemas/repository';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { insertExecution } from '../db/execution.repo';
import { nowIso, uuidv7 } from '../db/id';
import { runCommand, type RunResult } from '../exec/run';
import { validateExistingDirectory } from '../security/paths';
import { classifyGitFailure, redact } from './git-errors';

const GIT = 'git';

/**
 * Environment for every Git child process.
 *
 *  - `GIT_TERMINAL_PROMPT=0` makes a missing credential fail fast instead of
 *    hanging on a prompt nobody can see.
 *  - `LC_ALL=C` keeps Git's messages in English, which error classification
 *    depends on.
 *  - `GIT_LITERAL_PATHSPECS=1` makes every path a literal file name, so a file
 *    called `*` or `:(top)x` cannot widen what an operation touches.
 *  - `GIT_OPTIONAL_LOCKS=0` stops background status polling from taking the
 *    index lock and blocking the user's own commands.
 */
function gitEnvironment(): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) base[key] = value;
  }
  return {
    ...base,
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_OPTIONAL_LOCKS: '0'
  };
}

export interface GitExecOptions {
  timeoutMs?: number;
  /** Writes an `executions` row. Reads (status, diff, branch list) are not recorded; actions are. */
  record?: boolean;
  /** The user explicitly confirmed a destructive step. Recorded for the audit trail. */
  confirmed?: boolean;
  /** Exit codes that are not failures (e.g. `git diff --no-index` exits 1 when files differ). */
  okExitCodes?: readonly number[];
  maxOutputBytes?: number;
}

export interface GitSession {
  db: SqlDatabase;
  repository: Repository;
}

export interface GitOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}

/**
 * Runs one Git command inside a registered repository.
 *
 * The working directory is `-C <repository path>` in the argument array, the
 * path having been confirmed to still be a directory. A non-zero exit becomes a
 * classified `StewardServiceError`; the raw process result never leaves main.
 */
export async function execGit(
  session: GitSession,
  args: readonly string[],
  options: GitExecOptions = {}
): Promise<GitOutput> {
  const { repository } = session;
  const { path: cwd } = validateExistingDirectory(repository.localPath);
  const fullArgs = ['-C', cwd, ...args];
  const startedAt = nowIso();
  const started = Date.now();

  let result: RunResult;
  try {
    const runOptions = {
      timeoutMs: options.timeoutMs ?? 30_000,
      env: gitEnvironment(),
      ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes })
    };
    result = await runCommand(GIT, fullArgs, runOptions);
  } catch (error) {
    const notFound = error instanceof StewardServiceError && error.code === 'NOT_FOUND';
    const failure = notFound
      ? new StewardServiceError(
          'GIT_NOT_FOUND',
          'Git was not found on this system',
          'Steward uses the installed Git executable for all repository operations. Install Git and retry.'
        )
      : error;
    if (options.record === true) {
      record(session, args, options, {
        startedAt,
        durationMs: Date.now() - started,
        status: 'failed',
        exitCode: null,
        errorCode: failure instanceof StewardServiceError ? failure.code : 'UNKNOWN',
        errorMessage: failure instanceof Error ? failure.message : 'failed to start git'
      });
    }
    throw failure;
  }

  const okExit = options.okExitCodes ?? [0];
  const succeeded = result.exitCode !== null && okExit.includes(result.exitCode) && !result.timedOut;

  if (succeeded) {
    if (options.record === true) {
      record(session, args, options, {
        startedAt,
        durationMs: result.durationMs,
        status: 'succeeded',
        exitCode: result.exitCode,
        errorCode: null,
        errorMessage: null
      });
    }
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 0,
      truncated: result.truncated
    };
  }

  const classified = result.timedOut
    ? {
        code: 'GIT_TIMEOUT' as const,
        message: 'Git took too long and was stopped',
        hint: 'A slow or unreachable remote is the usual cause. Check the connection and retry.'
      }
    : classifyGitFailure(result.stdout, result.stderr);

  const detail = redact([classified.hint, result.stderr || result.stdout].filter(Boolean).join('\n\n'));

  if (options.record === true) {
    record(session, args, options, {
      startedAt,
      durationMs: result.durationMs,
      status: result.timedOut ? 'timed_out' : 'failed',
      exitCode: result.exitCode,
      errorCode: classified.code,
      errorMessage: redact(result.stderr || result.stdout || classified.message).slice(0, 500)
    });
  }

  throw new StewardServiceError(classified.code, classified.message, detail === '' ? undefined : detail);
}

function record(
  session: GitSession,
  args: readonly string[],
  options: GitExecOptions,
  outcome: {
    startedAt: string;
    durationMs: number;
    status: Execution['status'];
    exitCode: number | null;
    errorCode: string | null;
    errorMessage: string | null;
  }
): void {
  const { repository, db } = session;
  try {
    insertExecution(db, {
      id: uuidv7(),
      projectId: repository.projectId,
      repositoryId: repository.id,
      kind: 'git_op',
      context: 'local',
      command: GIT,
      args: args.map((arg) => redact(arg)),
      cwd: repository.localPath,
      status: outcome.status,
      exitCode: outcome.exitCode,
      confirmedByUser: options.confirmed === true,
      startedAt: outcome.startedAt,
      finishedAt: nowIso(),
      durationMs: outcome.durationMs,
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
      logPath: null
    });
  } catch (error) {
    // History is an audit aid. Failing to write it must not turn a Git
    // operation that succeeded into one reported as failed.
    console.error('[steward] could not record execution:', error);
  }
}

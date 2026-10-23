import { spawn } from 'node:child_process';
import { StewardServiceError } from '@shared/types/result';

/**
 * The only way main-process code starts a child process.
 *
 * Rules enforced here, not left to callers:
 *  - never `shell: true`, and never a command string: an executable plus an
 *    argument array, so a branch named `$(rm -rf ~)` is data, not syntax;
 *  - output is capped, so a flooding command cannot exhaust memory;
 *  - every run has a timeout and is killable.
 *
 * There is no IPC channel that reaches this function with a caller-supplied
 * executable. Milestone 1 uses it only for `git`.
 */
export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Replaces the environment entirely when given. Secrets are never passed here in M1. */
  env?: Record<string, string>;
}

export interface RunResult {
  file: string;
  args: readonly string[];
  cwd: string | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

export async function runCommand(
  file: string,
  args: readonly string[],
  options: RunOptions = {}
): Promise<RunResult> {
  if (typeof file !== 'string' || file.trim().length === 0) {
    throw new StewardServiceError('VALIDATION_FAILED', 'an executable is required');
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new StewardServiceError('VALIDATION_FAILED', 'command arguments must be an array of strings');
  }
  if (file.includes('\0') || args.some((arg) => arg.includes('\0'))) {
    throw new StewardServiceError('VALIDATION_FAILED', 'command arguments must not contain null bytes');
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startedAt = Date.now();

  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Escalate if the process ignores SIGTERM.
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 2000).unref();
    }, timeoutMs);
    timer.unref();

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= maxOutputBytes) {
        stdout += chunk.toString('utf8');
      } else {
        truncated = true;
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= maxOutputBytes) {
        stderr += chunk.toString('utf8');
      } else {
        truncated = true;
      }
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      settled = true;
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        // Callers translate this into something the user can act on; the Git
        // service turns a missing `git` into GIT_NOT_FOUND with setup guidance.
        reject(new StewardServiceError('NOT_FOUND', `${file} was not found on this system`));
        return;
      }
      reject(new StewardServiceError('UNKNOWN', `failed to start ${file}`, error.message));
    });

    child.on('close', (code, signal) => {
      settled = true;
      clearTimeout(timer);
      resolve({
        file,
        args: [...args],
        cwd: options.cwd ?? null,
        exitCode: code,
        signal,
        stdout,
        stderr,
        truncated,
        timedOut,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

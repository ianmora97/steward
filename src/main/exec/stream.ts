import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { StewardServiceError } from '@shared/types/result';

/**
 * The streaming twin of `run.ts`, for output that never ends on its own (logs).
 * Same rules: an executable plus an argument array, never a shell, no null bytes.
 * Nothing is buffered here; the caller decides what to keep, and `kill()` stops it.
 */
export interface StreamHandlers {
  onData: (stream: 'out' | 'err', text: string) => void;
  /** Called exactly once, after the process is gone and its output has been delivered. */
  onExit: (result: { exitCode: number | null; signal: NodeJS.Signals | null; error: string | null }) => void;
}

export interface StreamHandle {
  kill: () => void;
}

export function streamCommand(file: string, args: readonly string[], handlers: StreamHandlers): StreamHandle {
  if (typeof file !== 'string' || file.trim().length === 0) {
    throw new StewardServiceError('VALIDATION_FAILED', 'an executable is required');
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new StewardServiceError('VALIDATION_FAILED', 'command arguments must be an array of strings');
  }
  if (file.includes('\0') || args.some((arg) => arg.includes('\0'))) {
    throw new StewardServiceError('VALIDATION_FAILED', 'command arguments must not contain null bytes');
  }

  const child = spawn(file, [...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  // A multi-byte character can straddle two chunks; each stream needs its own decoder.
  const decoders = { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') };
  let spawnError: string | null = null;
  let done = false;

  const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
    if (done) return;
    done = true;
    for (const stream of ['out', 'err'] as const) {
      const rest = decoders[stream].end();
      if (rest !== '') handlers.onData(stream, rest);
    }
    handlers.onExit({ exitCode, signal, error: spawnError });
  };

  child.stdout?.on('data', (chunk: Buffer) => handlers.onData('out', decoders.out.write(chunk)));
  child.stderr?.on('data', (chunk: Buffer) => handlers.onData('err', decoders.err.write(chunk)));

  child.on('error', (error: NodeJS.ErrnoException) => {
    spawnError = error.code === 'ENOENT' ? `${file} was not found on this system` : `failed to start ${file}`;
    finish(null, null);
  });
  child.on('close', (code, signal) => finish(code, signal));

  return {
    kill: () => {
      if (done) return;
      child.kill('SIGTERM');
      // Escalate if the process ignores SIGTERM.
      setTimeout(() => {
        if (!done) child.kill('SIGKILL');
      }, 2000).unref();
    }
  };
}

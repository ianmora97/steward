import { describe, expect, it } from 'vitest';
import { runCommand } from '@main/exec/run';

/**
 * The process runner is the only route to a child process, so its guarantees
 * are tested directly: argument arrays, capped output, enforced timeouts.
 */
describe('runCommand', () => {
  it('captures stdout, stderr and the exit code', async () => {
    const result = await runCommand(process.execPath, [
      '-e',
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'
    ]);

    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('passes arguments as data, so shell metacharacters are never interpreted', async () => {
    const hostile = '$(echo pwned) && echo pwned; `echo pwned`';
    const result = await runCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', hostile]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(hostile);
    expect(result.stdout).not.toContain('pwned\n');
  });

  it('truncates output instead of growing without bound', async () => {
    const result = await runCommand(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(200000))'],
      { maxOutputBytes: 1000 }
    );

    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(1000);
  });

  it('terminates a command that outlives its timeout', async () => {
    const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      timeoutMs: 400
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);
  });

  it('reports a missing executable as NOT_FOUND', async () => {
    await expect(
      runCommand('steward-executable-that-does-not-exist', ['--version'])
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects malformed arguments before spawning anything', async () => {
    await expect(runCommand('', [])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      runCommand(process.execPath, [42 as unknown as string])
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      runCommand(process.execPath, ['-e', 'null\u0000'])
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

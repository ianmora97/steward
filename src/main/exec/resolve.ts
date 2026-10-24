import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * ConPTY (node-pty on Windows) does not search PATH: it needs the full path of
 * the executable. `spawn` does, so this returns the first `<name>.exe` PATH would
 * find on Windows, and the bare name elsewhere (where node-pty does search).
 */
export function resolveExecutable(name: string): string {
  if (process.platform !== 'win32') return name;
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, `${name}.exe`);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

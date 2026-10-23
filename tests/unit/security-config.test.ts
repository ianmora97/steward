import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from '@shared/types/ipc';

const root = join(__dirname, '..', '..');

/** Comments describe the rules; only executable code can break them. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const mainSource = readFileSync(join(root, 'src', 'main', 'index.ts'), 'utf8');
const preloadSource = readFileSync(join(root, 'src', 'preload', 'index.ts'), 'utf8');
const mainCode = stripComments(mainSource);
const preloadCode = stripComments(preloadSource);

/**
 * These assertions guard the process boundary against regression. They read the
 * source rather than a running app, so a weakened window option or a widened
 * bridge fails the suite on the commit that introduces it.
 */
describe('renderer isolation', () => {
  it('creates windows with isolation on and Node off', () => {
    expect(mainCode).toMatch(/contextIsolation:\s*true/);
    expect(mainCode).toMatch(/nodeIntegration:\s*false/);
    expect(mainCode).toMatch(/nodeIntegrationInWorker:\s*false/);
    expect(mainCode).toMatch(/nodeIntegrationInSubFrames:\s*false/);
    expect(mainCode).toMatch(/sandbox:\s*true/);
    expect(mainCode).toMatch(/webSecurity:\s*true/);
    expect(mainCode).toMatch(/webviewTag:\s*false/);
    expect(mainCode).toMatch(/allowRunningInsecureContent:\s*false/);
  });

  it('never enables the options that would open the renderer up', () => {
    expect(mainCode).not.toMatch(/contextIsolation:\s*false/);
    expect(mainCode).not.toMatch(/nodeIntegration:\s*true/);
    expect(mainCode).not.toMatch(/sandbox:\s*false/);
    expect(mainCode).not.toMatch(/webSecurity:\s*false/);
  });

  it('applies a Content Security Policy and guards navigation', () => {
    expect(mainCode).toContain('Content-Security-Policy');
    expect(mainCode).toContain("default-src 'self'");
    expect(mainCode).toContain('will-navigate');
    expect(mainCode).toContain('setWindowOpenHandler');
    expect(mainCode).toContain('will-attach-webview');
  });
});

describe('preload bridge', () => {
  it('exposes exactly one namespaced API object', () => {
    const exposures = preloadCode.match(/exposeInMainWorld\(/g) ?? [];
    expect(exposures).toHaveLength(1);
    expect(preloadCode).toContain("exposeInMainWorld('steward', api)");
  });

  it('does not hand the renderer Node or Electron internals', () => {
    for (const forbidden of [
      'child_process',
      'node:fs',
      'node:child_process',
      'require(',
      'shell.',
      'exposeInMainWorld(\'ipcRenderer\'',
      'webFrame'
    ]) {
      expect(preloadCode).not.toContain(forbidden);
    }
  });

  it('exposes no generic channel passthrough', () => {
    // A public `invoke` would make every present and future channel reachable
    // from the renderer, which is the failure this boundary exists to prevent.
    expect(preloadCode).not.toMatch(/^\s*invoke[:,]/m);
    expect(preloadCode).not.toMatch(/\binvoke:\s*\(/);
    expect(preloadCode).not.toMatch(/send:\s*\(/);
    expect(preloadCode).not.toMatch(/on:\s*\(/);
  });

  it('maps every declared channel exactly once', () => {
    for (const channel of Object.values(IPC_CHANNELS)) {
      const key = Object.entries(IPC_CHANNELS).find(([, value]) => value === channel)?.[0];
      const references = preloadCode.match(new RegExp(`IPC_CHANNELS\\.${key as string}\\b`, 'g')) ?? [];
      expect(references, `channel ${channel} must be used once in the preload`).toHaveLength(1);
    }
  });
});

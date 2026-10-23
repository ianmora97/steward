/**
 * End-to-end smoke test for Milestone 1.
 *
 * Launches the built application twice and drives the real renderer over the
 * Chrome DevTools Protocol, so the claims that matter are verified against a
 * running app rather than inferred from source:
 *
 *   - the renderer has no Node.js access;
 *   - `window.steward` exposes only the declared namespaces and no passthrough;
 *   - a project created through the bridge is still there after a restart.
 *
 * Deliberately dependency-free: Node 22 ships a global WebSocket, so no CDP
 * client is needed. Run it with `npm run test:e2e` after `npm run build`.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const projectRoot = join(import.meta.dirname, '..', '..');
const debugPort = 9333;

const workDirectory = mkdtempSync(join(tmpdir(), 'steward-e2e-'));
const databasePath = join(workDirectory, 'steward.sqlite');

let failures = 0;

function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (!pass) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function launch() {
  const args = ['.', `--remote-debugging-port=${debugPort}`];
  // Chromium's own sandbox usually cannot start in a CI container; this does
  // not relax the application's webPreferences.sandbox setting.
  if (process.env.CI !== undefined && process.platform === 'linux') args.push('--no-sandbox');

  const child = spawn(electronPath, args, {
    cwd: projectRoot,
    env: { ...process.env, STEWARD_DB_PATH: databasePath },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let log = '';
  child.stdout.on('data', (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    log += chunk.toString();
  });

  return { child, readLog: () => log };
}

async function findPageTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page !== undefined) return page;
    } catch {
      // The debugging endpoint is not up yet.
    }
    await sleep(500);
  }
  throw new Error('the renderer never exposed a debuggable page');
}

async function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true });
  });

  let nextId = 1;
  const pending = new Map();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const resolver = pending.get(message.id);
    if (resolver !== undefined) {
      pending.delete(message.id);
      resolver(message);
    }
  });

  async function evaluate(expression) {
    const id = nextId++;
    const result = new Promise((resolve) => pending.set(id, resolve));
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true }
      })
    );

    const message = await result;
    if (message.error !== undefined) throw new Error(message.error.message);
    if (message.result?.exceptionDetails !== undefined) {
      throw new Error(`renderer threw: ${message.result.exceptionDetails.text}`);
    }
    return message.result.result.value;
  }

  return { evaluate, close: () => socket.close() };
}

async function waitForApi(evaluate) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await evaluate('typeof window.steward')) === 'object') return;
    await sleep(250);
  }
  throw new Error('window.steward never appeared');
}

async function run() {
  console.log(`database: ${databasePath}`);

  // ---- First launch -----------------------------------------------------
  let app = launch();
  let page = await findPageTarget();
  let cdp = await connect(page.webSocketDebuggerUrl);
  await waitForApi(cdp.evaluate);

  check('renderer has no require()', await cdp.evaluate('typeof window.require'), 'undefined');
  check('renderer has no process', await cdp.evaluate('typeof window.process'), 'undefined');
  check('renderer has no module', await cdp.evaluate('typeof window.module'), 'undefined');
  check('renderer has no Buffer', await cdp.evaluate('typeof window.Buffer'), 'undefined');
  check('renderer has no ipcRenderer', await cdp.evaluate('typeof window.ipcRenderer'), 'undefined');
  check(
    'bridge exposes only the declared namespaces',
    await cdp.evaluate('Object.keys(window.steward).sort()'),
    ['app', 'projects', 'repositories', 'tabs']
  );
  check(
    'bridge exposes no generic passthrough',
    await cdp.evaluate(
      '[typeof window.steward.invoke, typeof window.steward.send, typeof window.steward.on].join(",")'
    ),
    'undefined,undefined,undefined'
  );

  const info = await cdp.evaluate('window.steward.app.getInfo()');
  check('app info succeeds', info.success, true);
  check('schema version is applied', info.data.schemaVersion >= 1, true);
  check('database path is the one under test', info.data.databasePath, databasePath);
  check('git is detected', info.data.gitAvailable, true);

  const created = await cdp.evaluate(
    'window.steward.projects.create({ name: "Smoke Project" })'
  );
  check('project creation succeeds', created.success, true);
  check('project slug is derived', created.data.slug, 'smoke-project');

  const tabs = await cdp.evaluate(
    `window.steward.tabs.list({ projectId: ${JSON.stringify(created.data.id)} })`
  );
  check('git tab is seeded first', tabs.data[0].tabKey, 'git');
  check('git tab is at position 0', tabs.data[0].position, 0);

  const hideGit = await cdp.evaluate(
    `window.steward.tabs.setVisibility({ projectId: ${JSON.stringify(created.data.id)}, tabKey: "git", visible: false })`
  );
  check('git tab cannot be hidden', hideGit.success, false);
  check('refusal is reported as a conflict', hideGit.error.code, 'CONFLICT');

  const reordered = await cdp.evaluate(
    `window.steward.tabs.reorder({ projectId: ${JSON.stringify(created.data.id)}, orderedTabKeys: ["settings", "git", "terminal"] })`
  );
  check('tabs can be reordered', reordered.data.map((tab) => tab.tabKey), [
    'settings',
    'git',
    'terminal'
  ]);

  const malformed = await cdp.evaluate('window.steward.projects.create({ name: "" })');
  check('malformed payload is rejected', malformed.success, false);
  check('rejection is a validation failure', malformed.error.code, 'VALIDATION_FAILED');

  const notARepository = await cdp.evaluate(
    `window.steward.repositories.validatePath({ localPath: ${JSON.stringify(workDirectory)} })`
  );
  check('a plain folder is reported, not accepted', notARepository.data.isGitRepository, false);

  const thisRepository = await cdp.evaluate(
    `window.steward.repositories.validatePath({ localPath: ${JSON.stringify(projectRoot)} })`
  );
  check('a real work tree is recognised', thisRepository.data.isGitRepository, true);

  cdp.close();
  app.child.kill();
  await sleep(1500);

  check('database file was written', existsSync(databasePath), true);

  // ---- Second launch: does the state survive a restart? -----------------
  app = launch();
  page = await findPageTarget();
  cdp = await connect(page.webSocketDebuggerUrl);
  await waitForApi(cdp.evaluate);

  const afterRestart = await cdp.evaluate('window.steward.projects.list({})');
  check('project survives a restart', afterRestart.data.map((project) => project.name), [
    'Smoke Project'
  ]);

  const tabsAfterRestart = await cdp.evaluate(
    `window.steward.tabs.list({ projectId: ${JSON.stringify(created.data.id)} })`
  );
  check('tab order survives a restart', tabsAfterRestart.data.map((tab) => tab.tabKey), [
    'settings',
    'git',
    'terminal'
  ]);

  cdp.close();
  app.child.kill();
  await sleep(1000);

  rmSync(workDirectory, { recursive: true, force: true });

  console.log(failures === 0 ? '\nsmoke test passed' : `\nsmoke test failed: ${failures} check(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(`smoke test error: ${error.message}`);
  rmSync(workDirectory, { recursive: true, force: true });
  process.exit(1);
});

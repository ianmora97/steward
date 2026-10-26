import { join } from 'node:path';
import { BrowserWindow, app, dialog, safeStorage, shell } from 'electron';
import { DOCKER_EVENTS, REDIS_EVENTS, TERMINAL_EVENTS, UI_EVENTS, type AppInfo, type DirectoryPick } from '@shared/types/ipc';
import { openStewardDatabase, type StewardDatabase } from './db/connection';
import { registerIpcHandlers } from './ipc/register';
import { validateExistingDirectory, validateExistingFile } from './security/paths';
import { getGitVersion } from './services/git.service';
import { createDeploymentService } from './services/deployment.service';
import { createDockerExec } from './services/docker-exec';
import { createDockerService, type DockerService } from './services/docker.service';
import { createMongoService, type MongoService } from './services/mongo.service';
import { createRedisService, type RedisService } from './services/redis.service';
import { createGithubActionsService } from './services/github-actions.service';
import { createGithubApi } from './services/github-api';
import { createGithubIntegrationService } from './services/github-integration.service';
import { createGithubPullsService } from './services/github-pulls.service';
import { createSecretStore } from './security/secret-store';
import { createSshService } from './services/ssh.service';
import { createTerminalService, type TerminalService } from './services/terminal.service';
import { createUiSettingsService, type UiSettingsService } from './services/ui-settings.service';

const isDev = !app.isPackaged;
const rendererDevUrl = process.env['ELECTRON_RENDERER_URL'];

let mainWindow: BrowserWindow | null = null;
let database: StewardDatabase | null = null;
let terminal: TerminalService | null = null;
let docker: DockerService | null = null;
let mongo: MongoService | null = null;
let redis: RedisService | null = null;
let ui: UiSettingsService | null = null;

function databaseFilePath(): string {
  // An override keeps development and manual testing off the real database.
  const override = process.env['STEWARD_DB_PATH'];
  if (override !== undefined && override.trim() !== '') return override;
  return join(app.getPath('userData'), 'steward.sqlite');
}

/**
 * Content Security Policy is applied as a response header rather than a meta
 * tag so it also covers responses the renderer did not author. Development
 * needs the inline styles and websocket that Vite's dev server uses; the
 * packaged app gets the strict policy.
 */
function applyContentSecurityPolicy(): void {
  const policy = isDev
    ? [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self' ws: http://localhost:* http://127.0.0.1:*",
        "object-src 'none'",
        "frame-src 'none'"
      ]
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "frame-src 'none'",
        "base-uri 'none'",
        "form-action 'none'"
      ];

  const session = mainWindow?.webContents.session;
  session?.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy.join('; ')]
      }
    });
  });
}

/**
 * Keeps the renderer inside the application.
 *
 * Navigation to any other origin is cancelled, new windows are never opened in
 * Electron, and an external link is handed to the OS browser only when it is
 * plain https. A renderer that is tricked into navigating cannot become a
 * window with different privileges.
 */
function hardenNavigation(window: BrowserWindow): void {
  const allowedOrigin = rendererDevUrl === undefined ? null : new URL(rendererDevUrl).origin;

  window.webContents.on('will-navigate', (event, url) => {
    const isAppUrl = url.startsWith('file://') || (allowedOrigin !== null && url.startsWith(allowedOrigin));
    if (!isAppUrl) event.preventDefault();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

async function readAppInfo(): Promise<AppInfo> {
  const gitVersion = await getGitVersion();
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    chromeVersion: process.versions.chrome ?? 'unknown',
    nodeVersion: process.versions.node,
    platform: process.platform,
    databasePath: database?.filePath ?? 'not opened',
    schemaVersion: database?.schemaVersion ?? 0,
    databaseDriver: database?.db.driverName ?? 'unknown',
    gitAvailable: gitVersion !== null,
    gitVersion
  };
}

async function pickDirectory(): Promise<DirectoryPick> {
  const options = {
    title: 'Choose a repository folder',
    properties: ['openDirectory' as const, 'dontAddToRecent' as const]
  };

  const result =
    mainWindow === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options);

  const chosen = result.filePaths[0];
  if (result.canceled || chosen === undefined) {
    return { cancelled: true, localPath: null };
  }
  // The OS dialog is trusted to return a real path, but it still goes through
  // the same validator as any renderer-supplied path.
  return { cancelled: false, localPath: validateExistingDirectory(chosen).path };
}

async function pickKeyFile(): Promise<DirectoryPick> {
  const options = {
    title: 'Choose a private key (.pem)',
    // Keys usually live in ~/.ssh, which a file dialog hides unless it starts there.
    defaultPath: join(app.getPath('home'), '.ssh'),
    properties: ['openFile' as const, 'dontAddToRecent' as const],
    filters: [
      { name: 'Private keys', extensions: ['pem', 'key'] },
      { name: 'All files', extensions: ['*'] }
    ]
  };

  const result =
    mainWindow === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options);

  const chosen = result.filePaths[0];
  if (result.canceled || chosen === undefined) {
    return { cancelled: true, localPath: null };
  }
  return { cancelled: false, localPath: validateExistingFile(chosen).path };
}

/** The file dialogs MongoDB needs: TLS certificates, and a file to import. Only paths leave this function. */
async function pickMongoFile(purpose: 'tlsCa' | 'tlsCertificate' | 'import'): Promise<string | null> {
  const titles = {
    tlsCa: 'Choose the CA certificate file',
    tlsCertificate: 'Choose the client certificate / key file',
    import: 'Choose a file to import'
  } as const;
  const filters =
    purpose === 'import'
      ? [
          { name: 'JSON, JSON Lines or CSV', extensions: ['json', 'ndjson', 'jsonl', 'csv'] },
          { name: 'All files', extensions: ['*'] }
        ]
      : [
          { name: 'Certificates and keys', extensions: ['pem', 'crt', 'cer', 'key', 'p12'] },
          { name: 'All files', extensions: ['*'] }
        ];
  const options = { title: titles[purpose], properties: ['openFile' as const, 'dontAddToRecent' as const], filters };
  const result =
    mainWindow === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(mainWindow, options);
  const chosen = result.filePaths[0];
  return result.canceled || chosen === undefined ? null : chosen;
}

/** The file dialogs Redis needs: the TLS CA, client certificate and client key. Only paths leave this function. */
async function pickRedisFile(purpose: 'tlsCa' | 'tlsCert' | 'tlsKey'): Promise<string | null> {
  const titles = {
    tlsCa: 'Choose the CA certificate file',
    tlsCert: 'Choose the client certificate file',
    tlsKey: 'Choose the client key file'
  } as const;
  const options = {
    title: titles[purpose],
    properties: ['openFile' as const, 'dontAddToRecent' as const],
    filters: [
      { name: 'Certificates and keys', extensions: ['pem', 'crt', 'cer', 'key'] },
      { name: 'All files', extensions: ['*'] }
    ]
  };
  const result =
    mainWindow === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(mainWindow, options);
  const chosen = result.filePaths[0];
  return result.canceled || chosen === undefined ? null : chosen;
}

async function chooseSavePath(defaultName: string, label: string, extensions: string[]): Promise<string | null> {
  const options = {
    title: 'Export to…',
    defaultPath: join(app.getPath('documents'), defaultName),
    filters: [{ name: label, extensions }]
  };
  const result =
    mainWindow === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(mainWindow, options);
  return result.canceled || result.filePath === '' ? null : result.filePath;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0e13',
    title: 'Steward',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer is presentation only: no Node, no direct filesystem,
      // no shell. Everything it can do is a named IPC channel.
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      spellcheck: false
    }
  });

  window.once('ready-to-show', () => window.show());
  // A reload resets the page's zoom, so the stored one goes back on every load.
  window.webContents.on('did-finish-load', () => ui?.applyCurrent());
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    if (input.key === '+' || input.key === '=') ui?.stepZoom(1);
    else if (input.key === '-' || input.key === '_') ui?.stepZoom(-1);
    else if (input.key === '0') ui?.resetZoom();
    else return;
    event.preventDefault();
  });
  // A reload leaves the page with no memory of its Pub/Sub subscriptions, so they would hold a slot for nothing.
  window.webContents.on('did-start-loading', () => void redis?.endSubscriptions());
  hardenNavigation(window);

  if (isDev && rendererDevUrl !== undefined) {
    void window.loadURL(rendererDevUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}

function startup(): void {
  const filePath = databaseFilePath();

  try {
    database = openStewardDatabase(filePath);
  } catch (error) {
    // Without a database Steward has no projects, so this is fatal and is
    // reported to the user rather than failing silently into an empty window.
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      'Steward could not open its database',
      `${filePath}\n\n${message}\n\nSteward will close. The previous database was left untouched.`
    );
    app.exit(1);
    return;
  }

  const { migration, schemaVersion } = database;
  console.log(
    `[steward] database ${filePath} (driver ${database.db.driverName}) at schema v${schemaVersion}` +
      (migration.applied.length > 0 ? `, applied ${migration.applied.join(', ')}` : '')
  );

  const sendToWindow = (channel: string, payload: unknown): void => {
    const target = mainWindow;
    if (target !== null && !target.isDestroyed() && !target.webContents.isDestroyed()) {
      target.webContents.send(channel, payload);
    }
  };
  const knownHostsFile = join(app.getPath('userData'), 'ssh', 'known_hosts');
  const ssh = createSshService({
    db: database.db,
    knownHostsFile,
    logDirectory: join(app.getPath('userData'), 'ssh-logs')
  });
  terminal = createTerminalService({
    db: database.db,
    logDirectory: join(app.getPath('userData'), 'terminal-logs'),
    knownHostsFile,
    emitData: (event) => sendToWindow(TERMINAL_EVENTS.data, event),
    emitExit: (event) => sendToWindow(TERMINAL_EVENTS.exit, event)
  });

  // One encrypted store for every secret: GitHub tokens and database connections each live under their own id.
  const secrets = createSecretStore({ directory: join(app.getPath('userData'), 'secrets'), safeStorage });
  const githubApi = createGithubApi();
  const github = createGithubIntegrationService({
    db: database.db,
    secrets,
    api: githubApi
  });
  const githubPulls = createGithubPullsService({
    db: database.db,
    github,
    api: githubApi,
    openExternal: (url) => shell.openExternal(url)
  });

  const githubActions = createGithubActionsService({ db: database.db, github, api: githubApi });

  const deployments = createDeploymentService({ db: database.db, ssh, github, api: githubApi });
  // Deployments a previous run of the app left open cannot be trusted to have finished.
  deployments.resumeOnStartup();

  docker = createDockerService({
    db: database.db,
    exec: createDockerExec({ db: database.db, knownHostsFile }),
    emitLog: (event) => sendToWindow(DOCKER_EVENTS.log, event),
    emitLogEnd: (event) => sendToWindow(DOCKER_EVENTS.logEnd, event)
  });

  mongo = createMongoService({
    db: database.db,
    secrets,
    dialogs: { pickFile: pickMongoFile, chooseSavePath }
  });

  redis = createRedisService({
    db: database.db,
    secrets,
    dialogs: { pickFile: pickRedisFile },
    emitMessage: (event) => sendToWindow(REDIS_EVENTS.message, event),
    emitSubscriptionEnd: (event) => sendToWindow(REDIS_EVENTS.subscriptionEnd, event)
  });

  ui = createUiSettingsService({
    db: database.db,
    apply: (zoom) => mainWindow?.webContents.setZoomFactor(zoom / 100),
    emit: (event) => sendToWindow(UI_EVENTS.zoomChanged, event)
  });

  registerIpcHandlers({
    database,
    terminal,
    ssh,
    github,
    githubPulls,
    githubActions,
    deployments,
    docker,
    mongo,
    redis,
    ui,
    readAppInfo,
    pickDirectory,
    pickKeyFile
  });

  mainWindow = createWindow();
  applyContentSecurityPolicy();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    startup();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
        applyContentSecurityPolicy();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    terminal?.shutdown();
    docker?.shutdown();
    void mongo?.shutdown();
    void redis?.shutdown();
    try {
      database?.db.close();
    } catch (error) {
      console.error('[steward] failed to close the database cleanly:', error);
    }
  });
}

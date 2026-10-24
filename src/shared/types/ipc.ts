import type { StewardResult } from './result';
import type {
  CreateProjectInput,
  ListProjectsInput,
  Project,
  UpdateProjectInput
} from '../schemas/project';
import type {
  AddRepositoryInput,
  ListRepositoriesInput,
  Repository,
  RepositoryProbe
} from '../schemas/repository';
import type {
  GitCommitDetail,
  GitCommitDetailInput,
  GitCommitDiffInput,
  GitHistory,
  GitHistoryInput
} from '../schemas/graph';
import type {
  Execution,
  GitBranchList,
  GitCheckoutInput,
  GitCommitInput,
  GitCommitResult,
  GitCreateBranchInput,
  GitDeleteBranchInput,
  GitDiff,
  GitDiffInput,
  GitDiscardInput,
  GitPullInput,
  GitStageInput,
  GitStatus,
  GitSyncResult,
  ListExecutionsInput
} from '../schemas/git';
import type {
  TerminalAttachResult,
  TerminalCreateInput,
  TerminalDeleteProfileInput,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalGetSettingsInput,
  TerminalListInput,
  TerminalProfile,
  TerminalResizeInput,
  TerminalSaveProfileInput,
  TerminalSession,
  TerminalSessionIdInput,
  TerminalSetSettingsInput,
  TerminalSettings,
  TerminalWriteInput
} from '../schemas/terminal';
import type {
  GithubBranchList,
  GithubConnectInput,
  GithubCreatePullInput,
  GithubCreatedPull,
  GithubIntegration,
  GithubListBranchesInput,
  GithubListPullsInput,
  GithubOpenUrlInput,
  GithubProjectInput,
  GithubPullPage
} from '../schemas/github';
import type {
  SshCommandResult,
  SshCreateInput,
  SshHost,
  SshHostIdInput,
  SshListExecutionsInput,
  SshListInput,
  SshRunCommandInput,
  SshScanResult,
  SshTrustInput,
  SshUpdateInput
} from '../schemas/ssh';
import type {
  ReorderTabsInput,
  SetTabVisibilityInput,
  WorkspaceTab
} from '../schemas/tabs';

/**
 * Every channel Steward exposes, enumerated.
 *
 * There is deliberately no generic `invoke(channel, payload)` and no
 * `runCommand(string)`: a generic channel would re-create arbitrary code
 * execution through a boundary that is supposed to prevent it. Adding a
 * capability means adding a named channel with its own schema.
 */
export const IPC_CHANNELS = {
  appGetInfo: 'app:getInfo',

  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsUpdate: 'projects:update',
  projectsArchive: 'projects:archive',
  projectsUnarchive: 'projects:unarchive',
  projectsDelete: 'projects:delete',

  repositoriesList: 'repositories:list',
  repositoriesAdd: 'repositories:add',
  repositoriesRemove: 'repositories:remove',
  repositoriesValidatePath: 'repositories:validatePath',
  repositoriesPickDirectory: 'repositories:pickDirectory',

  tabsList: 'tabs:list',
  tabsReorder: 'tabs:reorder',
  tabsSetVisibility: 'tabs:setVisibility',
  tabsRestoreDefaults: 'tabs:restoreDefaults',

  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitDiscard: 'git:discard',
  gitCommit: 'git:commit',
  gitListBranches: 'git:listBranches',
  gitCreateBranch: 'git:createBranch',
  gitCheckout: 'git:checkout',
  gitDeleteBranch: 'git:deleteBranch',
  gitFetch: 'git:fetch',
  gitPull: 'git:pull',
  gitPush: 'git:push',
  gitAbortMerge: 'git:abortMerge',
  gitListExecutions: 'git:listExecutions',
  gitHistory: 'git:history',
  gitCommitDetail: 'git:commitDetail',
  gitCommitDiff: 'git:commitDiff',

  terminalCreate: 'terminal:create',
  terminalWrite: 'terminal:write',
  terminalResize: 'terminal:resize',
  terminalClose: 'terminal:close',
  terminalList: 'terminal:list',
  terminalAttach: 'terminal:attach',
  terminalGetSettings: 'terminal:getSettings',
  terminalSetSettings: 'terminal:setSettings',
  terminalListProfiles: 'terminal:listProfiles',
  terminalSaveProfile: 'terminal:saveProfile',
  terminalDeleteProfile: 'terminal:deleteProfile',

  sshList: 'ssh:list',
  sshCreate: 'ssh:create',
  sshUpdate: 'ssh:update',
  sshRemove: 'ssh:remove',
  sshTest: 'ssh:test',
  sshScanHostKey: 'ssh:scanHostKey',
  sshTrustHostKey: 'ssh:trustHostKey',
  sshRunCommand: 'ssh:runCommand',
  sshListExecutions: 'ssh:listExecutions',
  sshPickKeyFile: 'ssh:pickKeyFile',

  githubConnect: 'github:connect',
  githubImportFromGh: 'github:importFromGh',
  githubDisconnect: 'github:disconnect',
  githubStatus: 'github:status',
  githubListPulls: 'github:listPulls',
  githubListBranches: 'github:listBranches',
  githubCreatePull: 'github:createPull',
  githubOpenUrl: 'github:openUrl'
} as const;

/**
 * Push channels (main → renderer). Kept out of IPC_CHANNELS, which require a
 * request handler. They live here, not in the Zod schema modules, because the
 * sandboxed preload can only bundle this file: importing zod there breaks it.
 */
export const TERMINAL_EVENTS = {
  data: 'terminal:data',
  exit: 'terminal:exit'
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface AppInfo {
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
  /** Shown in the UI so the user always knows which database file is in use. */
  databasePath: string;
  schemaVersion: number;
  /** Which SQLite driver is active. See src/main/db/driver.ts. */
  databaseDriver: string;
  gitAvailable: boolean;
  gitVersion: string | null;
}

/** A directory choice. `cancelled` is a normal outcome, not an error. */
export interface DirectoryPick {
  cancelled: boolean;
  localPath: string | null;
}

/**
 * The exact surface exposed on `window.steward` by the preload script.
 * Only named functions. No module objects, no event emitters, no passthrough.
 */
export interface StewardApi {
  app: {
    getInfo: () => Promise<StewardResult<AppInfo>>;
  };
  projects: {
    list: (input?: ListProjectsInput) => Promise<StewardResult<Project[]>>;
    create: (input: CreateProjectInput) => Promise<StewardResult<Project>>;
    update: (input: UpdateProjectInput) => Promise<StewardResult<Project>>;
    archive: (input: { id: string }) => Promise<StewardResult<Project>>;
    unarchive: (input: { id: string }) => Promise<StewardResult<Project>>;
    remove: (input: { id: string }) => Promise<StewardResult<{ id: string }>>;
  };
  repositories: {
    list: (input: ListRepositoriesInput) => Promise<StewardResult<Repository[]>>;
    add: (input: AddRepositoryInput) => Promise<StewardResult<Repository>>;
    remove: (input: { id: string }) => Promise<StewardResult<{ id: string }>>;
    validatePath: (input: { localPath: string }) => Promise<StewardResult<RepositoryProbe>>;
    pickDirectory: () => Promise<StewardResult<DirectoryPick>>;
  };
  tabs: {
    list: (input: { projectId: string }) => Promise<StewardResult<WorkspaceTab[]>>;
    reorder: (input: ReorderTabsInput) => Promise<StewardResult<WorkspaceTab[]>>;
    setVisibility: (input: SetTabVisibilityInput) => Promise<StewardResult<WorkspaceTab[]>>;
    restoreDefaults: (input: { projectId: string }) => Promise<StewardResult<WorkspaceTab[]>>;
  };
  git: {
    status: (input: { repositoryId: string }) => Promise<StewardResult<GitStatus>>;
    diff: (input: GitDiffInput) => Promise<StewardResult<GitDiff>>;
    stage: (input: GitStageInput) => Promise<StewardResult<GitStatus>>;
    unstage: (input: GitStageInput) => Promise<StewardResult<GitStatus>>;
    discard: (input: GitDiscardInput) => Promise<StewardResult<GitStatus>>;
    commit: (input: GitCommitInput) => Promise<StewardResult<GitCommitResult>>;
    listBranches: (input: { repositoryId: string }) => Promise<StewardResult<GitBranchList>>;
    createBranch: (input: GitCreateBranchInput) => Promise<StewardResult<GitBranchList>>;
    checkout: (input: GitCheckoutInput) => Promise<StewardResult<GitStatus>>;
    deleteBranch: (input: GitDeleteBranchInput) => Promise<StewardResult<GitBranchList>>;
    fetch: (input: { repositoryId: string }) => Promise<StewardResult<GitSyncResult>>;
    pull: (input: GitPullInput) => Promise<StewardResult<GitSyncResult>>;
    push: (input: { repositoryId: string }) => Promise<StewardResult<GitSyncResult>>;
    abortMerge: (input: { repositoryId: string }) => Promise<StewardResult<GitStatus>>;
    listExecutions: (input: ListExecutionsInput) => Promise<StewardResult<Execution[]>>;
    history: (input: GitHistoryInput) => Promise<StewardResult<GitHistory>>;
    commitDetail: (input: GitCommitDetailInput) => Promise<StewardResult<GitCommitDetail>>;
    commitDiff: (input: GitCommitDiffInput) => Promise<StewardResult<GitDiff>>;
  };
  terminal: {
    create: (input: TerminalCreateInput) => Promise<StewardResult<TerminalSession>>;
    write: (input: TerminalWriteInput) => Promise<StewardResult<null>>;
    resize: (input: TerminalResizeInput) => Promise<StewardResult<null>>;
    close: (input: TerminalSessionIdInput) => Promise<StewardResult<null>>;
    list: (input: TerminalListInput) => Promise<StewardResult<TerminalSession[]>>;
    attach: (input: TerminalSessionIdInput) => Promise<StewardResult<TerminalAttachResult>>;
    getSettings: (input: TerminalGetSettingsInput) => Promise<StewardResult<TerminalSettings>>;
    setSettings: (input: TerminalSetSettingsInput) => Promise<StewardResult<TerminalSettings>>;
    listProfiles: () => Promise<StewardResult<TerminalProfile[]>>;
    saveProfile: (input: TerminalSaveProfileInput) => Promise<StewardResult<TerminalProfile>>;
    deleteProfile: (input: TerminalDeleteProfileInput) => Promise<StewardResult<null>>;
    /** Returns an unsubscribe function. The Electron event object never reaches the renderer. */
    onData: (listener: (event: TerminalDataEvent) => void) => () => void;
    onExit: (listener: (event: TerminalExitEvent) => void) => () => void;
  };
  ssh: {
    list: (input: SshListInput) => Promise<StewardResult<SshHost[]>>;
    create: (input: SshCreateInput) => Promise<StewardResult<SshHost>>;
    update: (input: SshUpdateInput) => Promise<StewardResult<SshHost>>;
    remove: (input: SshHostIdInput) => Promise<StewardResult<{ id: string }>>;
    /** Connects without prompts and reports the connection state; never throws a connection problem as an error. */
    test: (input: SshHostIdInput) => Promise<StewardResult<SshHost>>;
    scanHostKey: (input: SshHostIdInput) => Promise<StewardResult<SshScanResult>>;
    trustHostKey: (input: SshTrustInput) => Promise<StewardResult<SshHost>>;
    runCommand: (input: SshRunCommandInput) => Promise<StewardResult<SshCommandResult>>;
    listExecutions: (input: SshListExecutionsInput) => Promise<StewardResult<Execution[]>>;
    /** Opens the OS file picker for a private key. Only the chosen path comes back, never the file's content. */
    pickKeyFile: () => Promise<StewardResult<DirectoryPick>>;
  };
  github: {
    /** The token goes in once and never comes back: the result describes the connection only. */
    connect: (input: GithubConnectInput) => Promise<StewardResult<GithubIntegration>>;
    /** Reads the token from `gh auth token`. Only ever called from an explicit user action. */
    importFromGh: (input: GithubProjectInput) => Promise<StewardResult<GithubIntegration>>;
    disconnect: (input: GithubProjectInput) => Promise<StewardResult<GithubIntegration>>;
    /** Re-validates the stored token against GitHub and reports the connection state. */
    status: (input: GithubProjectInput) => Promise<StewardResult<GithubIntegration>>;
    listPulls: (input: GithubListPullsInput) => Promise<StewardResult<GithubPullPage>>;
    listBranches: (input: GithubListBranchesInput) => Promise<StewardResult<GithubBranchList>>;
    /** Publishes to GitHub, so the input must carry `confirmed: true`. */
    createPull: (input: GithubCreatePullInput) => Promise<StewardResult<GithubCreatedPull>>;
    /** Opens a github.com link in the browser; main rejects any other host. */
    openUrl: (input: GithubOpenUrlInput) => Promise<StewardResult<null>>;
  };
}

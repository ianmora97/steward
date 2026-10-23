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
  gitListExecutions: 'git:listExecutions'
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
  };
}

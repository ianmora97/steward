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
  GithubGetJobLogInput,
  GithubHealth,
  GithubIntegration,
  GithubJob,
  GithubJobLog,
  GithubListJobsInput,
  GithubListRunsInput,
  GithubRepositoryInput,
  GithubRunPage,
  GithubWorkflow,
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
import type {
  DeployTarget,
  DeployTargetCreateInput,
  DeployTargetIdInput,
  DeployTargetListInput,
  DeployTargetUpdateInput
} from '../schemas/deploy-targets';
import type {
  Deployment,
  DeploymentIdInput,
  DeploymentListInput,
  DeploymentLog,
  DeploymentStartInput,
  DeploymentWorkflowInputsInput,
  WorkflowInputSpec
} from '../schemas/deployments';
import type {
  Environment,
  EnvironmentCreateInput,
  EnvironmentIdInput,
  EnvironmentListInput,
  EnvironmentReorderInput,
  EnvironmentUpdateInput
} from '../schemas/environments';
import type {
  DockerCommandOutput,
  DockerComposeActionInput,
  DockerComposeListInput,
  DockerComposeProject,
  DockerComposeRepositoryInput,
  DockerComposeService,
  DockerContainer,
  DockerContainerActionInput,
  DockerContainerDetail,
  DockerContainerIdInput,
  DockerContainerStats,
  DockerImage,
  DockerImagePullInput,
  DockerImageRemoveInput,
  DockerLogEndEvent,
  DockerLogEvent,
  DockerLogsStarted,
  DockerLogsStartInput,
  DockerLogsStopInput,
  DockerNetwork,
  DockerNetworkRemoveInput,
  DockerPruneInput,
  DockerStartInput,
  DockerStartResult,
  DockerStatus,
  DockerTargetInput,
  DockerVolume,
  DockerVolumeRemoveInput
} from '../schemas/docker';
import type {
  MongoAggregateExplainInput,
  MongoAggregateInput,
  MongoAggregateResult,
  MongoCollectionInfo,
  MongoCollectionStats,
  MongoConnection,
  MongoConnectionCreateInput,
  MongoConnectionDraftInput,
  MongoConnectionIdInput,
  MongoConnectionListInput,
  MongoConnectionUpdateInput,
  MongoCountInput,
  MongoCountResult,
  MongoCreateCollectionInput,
  MongoDatabaseInfo,
  MongoDatabaseInput,
  MongoDeleteManyInput,
  MongoDeleteOneInput,
  MongoDropCollectionInput,
  MongoDropDatabaseInput,
  MongoExplainInput,
  MongoExplainSummary,
  MongoExportInput,
  MongoExportResult,
  MongoFindInput,
  MongoFindResult,
  MongoImportInput,
  MongoImportResult,
  MongoIndex,
  MongoIndexCreateInput,
  MongoIndexDropInput,
  MongoInsertInput,
  MongoInsertResult,
  MongoNamespaceInput,
  MongoPickedFile,
  MongoPickFileInput,
  MongoReplaceInput,
  MongoSavedQuery,
  MongoSavedQueryDeleteInput,
  MongoSavedQueryListInput,
  MongoSavedQuerySaveInput,
  MongoSchemaInput,
  MongoSchemaResult,
  MongoTestResult,
  MongoUpdateManyInput,
  MongoValidation,
  MongoValidationSetInput,
  MongoWriteResult
} from '../schemas/mongodb';

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
  githubOpenUrl: 'github:openUrl',
  githubListWorkflows: 'github:listWorkflows',
  githubListRuns: 'github:listRuns',
  githubListJobs: 'github:listJobs',
  githubGetJobLog: 'github:getJobLog',
  githubGetHealth: 'github:getHealth',

  environmentsList: 'environments:list',
  environmentsCreate: 'environments:create',
  environmentsUpdate: 'environments:update',
  environmentsReorder: 'environments:reorder',
  environmentsDelete: 'environments:delete',

  deployTargetsList: 'deployTargets:list',
  deployTargetsCreate: 'deployTargets:create',
  deployTargetsUpdate: 'deployTargets:update',
  deployTargetsDelete: 'deployTargets:delete',

  deploymentsStart: 'deployments:start',
  deploymentsList: 'deployments:list',
  deploymentsGet: 'deployments:get',
  deploymentsLog: 'deployments:log',
  deploymentsWorkflowInputs: 'deployments:workflowInputs',

  dockerStatus: 'docker:status',
  dockerStart: 'docker:start',
  dockerContainersList: 'docker:containers:list',
  dockerContainersStats: 'docker:containers:stats',
  dockerContainerInspect: 'docker:containers:inspect',
  dockerContainerAction: 'docker:containers:action',
  dockerImagesList: 'docker:images:list',
  dockerImagePull: 'docker:images:pull',
  dockerImageRemove: 'docker:images:remove',
  dockerSystemDf: 'docker:systemDf',
  dockerPrune: 'docker:prune',
  dockerVolumesList: 'docker:volumes:list',
  dockerVolumeRemove: 'docker:volumes:remove',
  dockerNetworksList: 'docker:networks:list',
  dockerNetworkRemove: 'docker:networks:remove',
  dockerLogsStart: 'docker:logs:start',
  dockerLogsStop: 'docker:logs:stop',
  dockerComposeList: 'docker:compose:list',
  dockerComposeServices: 'docker:compose:services',
  dockerComposeAction: 'docker:compose:action',

  mongoConnectionsList: 'mongo:connections:list',
  mongoConnectionsCreate: 'mongo:connections:create',
  mongoConnectionsUpdate: 'mongo:connections:update',
  mongoConnectionsDelete: 'mongo:connections:delete',
  mongoConnectionsTest: 'mongo:connections:test',
  mongoConnectionsTestDraft: 'mongo:connections:testDraft',
  mongoPickFile: 'mongo:pickFile',
  mongoDatabasesList: 'mongo:databases:list',
  mongoCollectionsList: 'mongo:collections:list',
  mongoCollectionStats: 'mongo:collections:stats',
  mongoFind: 'mongo:find',
  mongoCount: 'mongo:count',
  mongoExplain: 'mongo:explain',
  mongoInsert: 'mongo:insert',
  mongoReplace: 'mongo:replace',
  mongoDeleteOne: 'mongo:deleteOne',
  mongoDeleteMany: 'mongo:deleteMany',
  mongoUpdateMany: 'mongo:updateMany',
  mongoCreateCollection: 'mongo:createCollection',
  mongoDropCollection: 'mongo:dropCollection',
  mongoDropDatabase: 'mongo:dropDatabase',
  mongoAggregate: 'mongo:aggregate',
  mongoAggregateExplain: 'mongo:aggregateExplain',
  mongoIndexesList: 'mongo:indexes:list',
  mongoIndexCreate: 'mongo:indexes:create',
  mongoIndexDrop: 'mongo:indexes:drop',
  mongoSchemaAnalyze: 'mongo:schema:analyze',
  mongoValidationGet: 'mongo:validation:get',
  mongoValidationSet: 'mongo:validation:set',
  mongoExport: 'mongo:export',
  mongoImport: 'mongo:import',
  mongoSavedList: 'mongo:saved:list',
  mongoSavedSave: 'mongo:saved:save',
  mongoSavedDelete: 'mongo:saved:delete'
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

export const DOCKER_EVENTS = {
  log: 'docker:log',
  logEnd: 'docker:log-end'
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
    listWorkflows: (input: GithubRepositoryInput) => Promise<StewardResult<GithubWorkflow[]>>;
    listRuns: (input: GithubListRunsInput) => Promise<StewardResult<GithubRunPage>>;
    listJobs: (input: GithubListJobsInput) => Promise<StewardResult<GithubJob[]>>;
    /** The end of a job log, already stripped of colour codes and secrets. */
    getJobLog: (input: GithubGetJobLogInput) => Promise<StewardResult<GithubJobLog>>;
    /** Workflow health derived from recent runs; separate from whether the token works. */
    getHealth: (input: GithubRepositoryInput) => Promise<StewardResult<GithubHealth>>;
  };
  environments: {
    list: (input: EnvironmentListInput) => Promise<StewardResult<Environment[]>>;
    create: (input: EnvironmentCreateInput) => Promise<StewardResult<Environment>>;
    /** Lowering a protected environment's protection needs `confirmed: true`. */
    update: (input: EnvironmentUpdateInput) => Promise<StewardResult<Environment>>;
    reorder: (input: EnvironmentReorderInput) => Promise<StewardResult<Environment[]>>;
    /** Refused while deploy targets or deployment history refer to it. */
    remove: (input: EnvironmentIdInput) => Promise<StewardResult<{ id: string }>>;
  };
  deployTargets: {
    list: (input: DeployTargetListInput) => Promise<StewardResult<DeployTarget[]>>;
    create: (input: DeployTargetCreateInput) => Promise<StewardResult<DeployTarget>>;
    update: (input: DeployTargetUpdateInput) => Promise<StewardResult<DeployTarget>>;
    /** Its deployment history stays. */
    remove: (input: DeployTargetIdInput) => Promise<StewardResult<{ id: string }>>;
  };
  deployments: {
    /**
     * Deploys for real, so main checks the confirmation itself. Returns as soon as the
     * deployment is recorded; poll `get` or `list` to follow it.
     */
    start: (input: DeploymentStartInput) => Promise<StewardResult<Deployment>>;
    list: (input: DeploymentListInput) => Promise<StewardResult<Deployment[]>>;
    get: (input: DeploymentIdInput) => Promise<StewardResult<Deployment>>;
    /** The end of the output of a command deploy, already redacted. Workflow deploys keep their logs on GitHub. */
    log: (input: DeploymentIdInput) => Promise<StewardResult<DeploymentLog>>;
    /** What a workflow asks for on a manual run, read from its file on GitHub at the given ref. */
    workflowInputs: (input: DeploymentWorkflowInputsInput) => Promise<StewardResult<WorkflowInputSpec[]>>;
  };
  docker: {
    /** Reports "Docker is off" as a state to explain, not as an error. */
    status: (input: DockerTargetInput) => Promise<StewardResult<DockerStatus>>;
    /**
     * Starts Docker Desktop on this machine (never on a server) and returns at once; poll `status`, which
     * reports `starting` until the daemon answers.
     */
    startEngine: (input: DockerStartInput) => Promise<StewardResult<DockerStartResult>>;
    listContainers: (input: DockerTargetInput) => Promise<StewardResult<DockerContainer[]>>;
    containerStats: (input: DockerTargetInput) => Promise<StewardResult<DockerContainerStats[]>>;
    /** Environment values whose names look like secrets come back without their value. */
    inspectContainer: (input: DockerContainerIdInput) => Promise<StewardResult<DockerContainerDetail>>;
    /** `kill` and `remove` need `confirmed: true`; on a protected server also the container's name. */
    containerAction: (input: DockerContainerActionInput) => Promise<StewardResult<{ containerId: string }>>;
    listImages: (input: DockerTargetInput) => Promise<StewardResult<DockerImage[]>>;
    pullImage: (input: DockerImagePullInput) => Promise<StewardResult<DockerCommandOutput>>;
    removeImage: (input: DockerImageRemoveInput) => Promise<StewardResult<{ image: string }>>;
    /** What `docker system df` says, shown before a prune. */
    systemDf: (input: DockerTargetInput) => Promise<StewardResult<DockerCommandOutput>>;
    prune: (input: DockerPruneInput) => Promise<StewardResult<DockerCommandOutput>>;
    listVolumes: (input: DockerTargetInput) => Promise<StewardResult<DockerVolume[]>>;
    removeVolume: (input: DockerVolumeRemoveInput) => Promise<StewardResult<{ name: string }>>;
    listNetworks: (input: DockerTargetInput) => Promise<StewardResult<DockerNetwork[]>>;
    removeNetwork: (input: DockerNetworkRemoveInput) => Promise<StewardResult<{ name: string }>>;
    /** Lines arrive through `onLog` until `stopLogs` or the container ends (`onLogEnd`). */
    startLogs: (input: DockerLogsStartInput) => Promise<StewardResult<DockerLogsStarted>>;
    stopLogs: (input: DockerLogsStopInput) => Promise<StewardResult<{ subscriptionId: string }>>;
    composeList: (input: DockerComposeListInput) => Promise<StewardResult<DockerComposeProject[]>>;
    composeServices: (input: DockerComposeRepositoryInput) => Promise<StewardResult<DockerComposeService[]>>;
    composeAction: (input: DockerComposeActionInput) => Promise<StewardResult<DockerCommandOutput>>;
    onLog: (listener: (event: DockerLogEvent) => void) => () => void;
    onLogEnd: (listener: (event: DockerLogEndEvent) => void) => () => void;
  };
  mongo: {
    list: (input: MongoConnectionListInput) => Promise<StewardResult<MongoConnection[]>>;
    /** The URI and credentials go in once, are stored encrypted and never come back. */
    create: (input: MongoConnectionCreateInput) => Promise<StewardResult<MongoConnection>>;
    update: (input: MongoConnectionUpdateInput) => Promise<StewardResult<MongoConnection>>;
    remove: (input: MongoConnectionIdInput) => Promise<StewardResult<{ id: string }>>;
    test: (input: MongoConnectionIdInput) => Promise<StewardResult<MongoTestResult>>;
    /** Tries a connection that is not saved yet. */
    testDraft: (input: MongoConnectionDraftInput) => Promise<StewardResult<MongoTestResult>>;
    /** Opens the OS file picker. Only the chosen path (or, for an import, an opaque token) comes back. */
    pickFile: (input: MongoPickFileInput) => Promise<StewardResult<MongoPickedFile>>;
    listDatabases: (input: MongoConnectionIdInput) => Promise<StewardResult<MongoDatabaseInfo[]>>;
    listCollections: (input: MongoDatabaseInput) => Promise<StewardResult<MongoCollectionInfo[]>>;
    collectionStats: (input: MongoNamespaceInput) => Promise<StewardResult<MongoCollectionStats>>;
    /** Documents come back as canonical Extended JSON text; see shared/mongo/shell-format. */
    find: (input: MongoFindInput) => Promise<StewardResult<MongoFindResult>>;
    count: (input: MongoCountInput) => Promise<StewardResult<MongoCountResult>>;
    explain: (input: MongoExplainInput) => Promise<StewardResult<MongoExplainSummary>>;
    /** Every write below fails with CONNECTION_READ_ONLY on a read-only connection. */
    insert: (input: MongoInsertInput) => Promise<StewardResult<MongoInsertResult>>;
    replace: (input: MongoReplaceInput) => Promise<StewardResult<MongoWriteResult>>;
    deleteOne: (input: MongoDeleteOneInput) => Promise<StewardResult<MongoWriteResult>>;
    deleteMany: (input: MongoDeleteManyInput) => Promise<StewardResult<MongoWriteResult>>;
    updateMany: (input: MongoUpdateManyInput) => Promise<StewardResult<MongoWriteResult>>;
    createCollection: (input: MongoCreateCollectionInput) => Promise<StewardResult<{ collection: string }>>;
    dropCollection: (input: MongoDropCollectionInput) => Promise<StewardResult<{ collection: string }>>;
    dropDatabase: (input: MongoDropDatabaseInput) => Promise<StewardResult<{ db: string }>>;
    aggregate: (input: MongoAggregateInput) => Promise<StewardResult<MongoAggregateResult>>;
    explainAggregate: (input: MongoAggregateExplainInput) => Promise<StewardResult<MongoExplainSummary>>;
    listIndexes: (input: MongoNamespaceInput) => Promise<StewardResult<MongoIndex[]>>;
    createIndex: (input: MongoIndexCreateInput) => Promise<StewardResult<{ name: string }>>;
    dropIndex: (input: MongoIndexDropInput) => Promise<StewardResult<{ name: string }>>;
    analyzeSchema: (input: MongoSchemaInput) => Promise<StewardResult<MongoSchemaResult>>;
    getValidation: (input: MongoNamespaceInput) => Promise<StewardResult<MongoValidation>>;
    setValidation: (input: MongoValidationSetInput) => Promise<StewardResult<MongoValidation>>;
    /** Asks where to save in a native dialog, then writes the file from the main process. */
    exportQuery: (input: MongoExportInput) => Promise<StewardResult<MongoExportResult>>;
    importFile: (input: MongoImportInput) => Promise<StewardResult<MongoImportResult>>;
    listSavedQueries: (input: MongoSavedQueryListInput) => Promise<StewardResult<MongoSavedQuery[]>>;
    saveQuery: (input: MongoSavedQuerySaveInput) => Promise<StewardResult<MongoSavedQuery>>;
    deleteSavedQuery: (input: MongoSavedQueryDeleteInput) => Promise<StewardResult<{ id: string }>>;
  };
}

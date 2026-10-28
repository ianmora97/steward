import { contextBridge, ipcRenderer } from 'electron';
import type { DockerLogEndEvent, DockerLogEvent } from '@shared/schemas/docker';
import type { CheckFinishedEvent } from '@shared/schemas/cloud';
import type { LiveLogsEndEvent, LiveLogsEvent } from '@shared/schemas/observability';
import type { RedisMessageEvent, RedisSubscriptionEndEvent } from '@shared/schemas/redis';
import type { TerminalDataEvent, TerminalExitEvent } from '@shared/schemas/terminal';
import type { ZoomState } from '@shared/schemas/ui';
import { CLOUD_EVENTS, DOCKER_EVENTS, IPC_CHANNELS, OBSERVABILITY_EVENTS, REDIS_EVENTS, TERMINAL_EVENTS, UI_EVENTS, type StewardApi } from '@shared/types/ipc';

/**
 * The entire bridge between the renderer and the main process.
 *
 * Only named functions are exposed. `ipcRenderer`, `child_process`, `fs`,
 * `require` and `process` are deliberately absent, and there is no generic
 * `invoke(channel, payload)`: a passthrough would hand the renderer every
 * channel at once, including ones added later, which is the failure mode
 * context isolation exists to prevent.
 *
 * Adding a capability means adding a named function here, a channel, and a
 * schema in the main process. All three, or it does not exist.
 */
function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload ?? {}) as Promise<T>;
}

/**
 * Subscribes to a push channel. The Electron event object is dropped so the
 * renderer never holds a reference into ipcRenderer, and the returned function
 * removes exactly this listener.
 */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: unknown, payload: T): void => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: StewardApi = {
  app: {
    getInfo: () => invoke(IPC_CHANNELS.appGetInfo)
  },
  ui: {
    getZoom: () => invoke(IPC_CHANNELS.uiGetZoom),
    setZoom: (input) => invoke(IPC_CHANNELS.uiSetZoom, input),
    onZoomChanged: (listener) => subscribe<ZoomState>(UI_EVENTS.zoomChanged, listener)
  },
  overview: {
    summary: () => invoke(IPC_CHANNELS.overviewSummary),
    activity: () => invoke(IPC_CHANNELS.overviewActivity)
  },
  projects: {
    list: (input) => invoke(IPC_CHANNELS.projectsList, input ?? {}),
    create: (input) => invoke(IPC_CHANNELS.projectsCreate, input),
    update: (input) => invoke(IPC_CHANNELS.projectsUpdate, input),
    archive: (input) => invoke(IPC_CHANNELS.projectsArchive, input),
    unarchive: (input) => invoke(IPC_CHANNELS.projectsUnarchive, input),
    remove: (input) => invoke(IPC_CHANNELS.projectsDelete, input)
  },
  repositories: {
    list: (input) => invoke(IPC_CHANNELS.repositoriesList, input),
    add: (input) => invoke(IPC_CHANNELS.repositoriesAdd, input),
    remove: (input) => invoke(IPC_CHANNELS.repositoriesRemove, input),
    validatePath: (input) => invoke(IPC_CHANNELS.repositoriesValidatePath, input),
    pickDirectory: () => invoke(IPC_CHANNELS.repositoriesPickDirectory)
  },
  tabs: {
    list: (input) => invoke(IPC_CHANNELS.tabsList, input),
    reorder: (input) => invoke(IPC_CHANNELS.tabsReorder, input),
    setVisibility: (input) => invoke(IPC_CHANNELS.tabsSetVisibility, input),
    restoreDefaults: (input) => invoke(IPC_CHANNELS.tabsRestoreDefaults, input)
  },
  git: {
    status: (input) => invoke(IPC_CHANNELS.gitStatus, input),
    diff: (input) => invoke(IPC_CHANNELS.gitDiff, input),
    stage: (input) => invoke(IPC_CHANNELS.gitStage, input),
    unstage: (input) => invoke(IPC_CHANNELS.gitUnstage, input),
    discard: (input) => invoke(IPC_CHANNELS.gitDiscard, input),
    commit: (input) => invoke(IPC_CHANNELS.gitCommit, input),
    listBranches: (input) => invoke(IPC_CHANNELS.gitListBranches, input),
    createBranch: (input) => invoke(IPC_CHANNELS.gitCreateBranch, input),
    checkout: (input) => invoke(IPC_CHANNELS.gitCheckout, input),
    deleteBranch: (input) => invoke(IPC_CHANNELS.gitDeleteBranch, input),
    fetch: (input) => invoke(IPC_CHANNELS.gitFetch, input),
    pull: (input) => invoke(IPC_CHANNELS.gitPull, input),
    push: (input) => invoke(IPC_CHANNELS.gitPush, input),
    abortMerge: (input) => invoke(IPC_CHANNELS.gitAbortMerge, input),
    listExecutions: (input) => invoke(IPC_CHANNELS.gitListExecutions, input),
    history: (input) => invoke(IPC_CHANNELS.gitHistory, input),
    commitDetail: (input) => invoke(IPC_CHANNELS.gitCommitDetail, input),
    commitDiff: (input) => invoke(IPC_CHANNELS.gitCommitDiff, input)
  },
  terminal: {
    create: (input) => invoke(IPC_CHANNELS.terminalCreate, input),
    write: (input) => invoke(IPC_CHANNELS.terminalWrite, input),
    resize: (input) => invoke(IPC_CHANNELS.terminalResize, input),
    close: (input) => invoke(IPC_CHANNELS.terminalClose, input),
    list: (input) => invoke(IPC_CHANNELS.terminalList, input),
    attach: (input) => invoke(IPC_CHANNELS.terminalAttach, input),
    getSettings: (input) => invoke(IPC_CHANNELS.terminalGetSettings, input),
    setSettings: (input) => invoke(IPC_CHANNELS.terminalSetSettings, input),
    listProfiles: () => invoke(IPC_CHANNELS.terminalListProfiles),
    saveProfile: (input) => invoke(IPC_CHANNELS.terminalSaveProfile, input),
    deleteProfile: (input) => invoke(IPC_CHANNELS.terminalDeleteProfile, input),
    onData: (listener) => subscribe<TerminalDataEvent>(TERMINAL_EVENTS.data, listener),
    onExit: (listener) => subscribe<TerminalExitEvent>(TERMINAL_EVENTS.exit, listener)
  },
  ssh: {
    list: (input) => invoke(IPC_CHANNELS.sshList, input),
    create: (input) => invoke(IPC_CHANNELS.sshCreate, input),
    update: (input) => invoke(IPC_CHANNELS.sshUpdate, input),
    remove: (input) => invoke(IPC_CHANNELS.sshRemove, input),
    test: (input) => invoke(IPC_CHANNELS.sshTest, input),
    scanHostKey: (input) => invoke(IPC_CHANNELS.sshScanHostKey, input),
    trustHostKey: (input) => invoke(IPC_CHANNELS.sshTrustHostKey, input),
    runCommand: (input) => invoke(IPC_CHANNELS.sshRunCommand, input),
    listExecutions: (input) => invoke(IPC_CHANNELS.sshListExecutions, input),
    pickKeyFile: () => invoke(IPC_CHANNELS.sshPickKeyFile)
  },
  github: {
    connect: (input) => invoke(IPC_CHANNELS.githubConnect, input),
    importFromGh: (input) => invoke(IPC_CHANNELS.githubImportFromGh, input),
    disconnect: (input) => invoke(IPC_CHANNELS.githubDisconnect, input),
    status: (input) => invoke(IPC_CHANNELS.githubStatus, input),
    listPulls: (input) => invoke(IPC_CHANNELS.githubListPulls, input),
    listBranches: (input) => invoke(IPC_CHANNELS.githubListBranches, input),
    createPull: (input) => invoke(IPC_CHANNELS.githubCreatePull, input),
    openUrl: (input) => invoke(IPC_CHANNELS.githubOpenUrl, input),
    listWorkflows: (input) => invoke(IPC_CHANNELS.githubListWorkflows, input),
    listRuns: (input) => invoke(IPC_CHANNELS.githubListRuns, input),
    listJobs: (input) => invoke(IPC_CHANNELS.githubListJobs, input),
    getJobLog: (input) => invoke(IPC_CHANNELS.githubGetJobLog, input),
    getHealth: (input) => invoke(IPC_CHANNELS.githubGetHealth, input)
  },
  environments: {
    list: (input) => invoke(IPC_CHANNELS.environmentsList, input),
    create: (input) => invoke(IPC_CHANNELS.environmentsCreate, input),
    update: (input) => invoke(IPC_CHANNELS.environmentsUpdate, input),
    reorder: (input) => invoke(IPC_CHANNELS.environmentsReorder, input),
    remove: (input) => invoke(IPC_CHANNELS.environmentsDelete, input)
  },
  deployTargets: {
    list: (input) => invoke(IPC_CHANNELS.deployTargetsList, input),
    create: (input) => invoke(IPC_CHANNELS.deployTargetsCreate, input),
    update: (input) => invoke(IPC_CHANNELS.deployTargetsUpdate, input),
    remove: (input) => invoke(IPC_CHANNELS.deployTargetsDelete, input)
  },
  deployments: {
    start: (input) => invoke(IPC_CHANNELS.deploymentsStart, input),
    list: (input) => invoke(IPC_CHANNELS.deploymentsList, input),
    get: (input) => invoke(IPC_CHANNELS.deploymentsGet, input),
    log: (input) => invoke(IPC_CHANNELS.deploymentsLog, input),
    workflowInputs: (input) => invoke(IPC_CHANNELS.deploymentsWorkflowInputs, input)
  },
  docker: {
    status: (input) => invoke(IPC_CHANNELS.dockerStatus, input),
    startEngine: (input) => invoke(IPC_CHANNELS.dockerStart, input),
    listContainers: (input) => invoke(IPC_CHANNELS.dockerContainersList, input),
    containerStats: (input) => invoke(IPC_CHANNELS.dockerContainersStats, input),
    inspectContainer: (input) => invoke(IPC_CHANNELS.dockerContainerInspect, input),
    containerAction: (input) => invoke(IPC_CHANNELS.dockerContainerAction, input),
    listImages: (input) => invoke(IPC_CHANNELS.dockerImagesList, input),
    pullImage: (input) => invoke(IPC_CHANNELS.dockerImagePull, input),
    removeImage: (input) => invoke(IPC_CHANNELS.dockerImageRemove, input),
    systemDf: (input) => invoke(IPC_CHANNELS.dockerSystemDf, input),
    prune: (input) => invoke(IPC_CHANNELS.dockerPrune, input),
    listVolumes: (input) => invoke(IPC_CHANNELS.dockerVolumesList, input),
    removeVolume: (input) => invoke(IPC_CHANNELS.dockerVolumeRemove, input),
    listNetworks: (input) => invoke(IPC_CHANNELS.dockerNetworksList, input),
    removeNetwork: (input) => invoke(IPC_CHANNELS.dockerNetworkRemove, input),
    startLogs: (input) => invoke(IPC_CHANNELS.dockerLogsStart, input),
    stopLogs: (input) => invoke(IPC_CHANNELS.dockerLogsStop, input),
    composeList: (input) => invoke(IPC_CHANNELS.dockerComposeList, input),
    composeServices: (input) => invoke(IPC_CHANNELS.dockerComposeServices, input),
    composeAction: (input) => invoke(IPC_CHANNELS.dockerComposeAction, input),
    onLog: (listener) => subscribe<DockerLogEvent>(DOCKER_EVENTS.log, listener),
    onLogEnd: (listener) => subscribe<DockerLogEndEvent>(DOCKER_EVENTS.logEnd, listener)
  },
  mongo: {
    list: (input) => invoke(IPC_CHANNELS.mongoConnectionsList, input),
    create: (input) => invoke(IPC_CHANNELS.mongoConnectionsCreate, input),
    update: (input) => invoke(IPC_CHANNELS.mongoConnectionsUpdate, input),
    remove: (input) => invoke(IPC_CHANNELS.mongoConnectionsDelete, input),
    test: (input) => invoke(IPC_CHANNELS.mongoConnectionsTest, input),
    testDraft: (input) => invoke(IPC_CHANNELS.mongoConnectionsTestDraft, input),
    pickFile: (input) => invoke(IPC_CHANNELS.mongoPickFile, input),
    listDatabases: (input) => invoke(IPC_CHANNELS.mongoDatabasesList, input),
    listCollections: (input) => invoke(IPC_CHANNELS.mongoCollectionsList, input),
    collectionStats: (input) => invoke(IPC_CHANNELS.mongoCollectionStats, input),
    find: (input) => invoke(IPC_CHANNELS.mongoFind, input),
    count: (input) => invoke(IPC_CHANNELS.mongoCount, input),
    explain: (input) => invoke(IPC_CHANNELS.mongoExplain, input),
    insert: (input) => invoke(IPC_CHANNELS.mongoInsert, input),
    replace: (input) => invoke(IPC_CHANNELS.mongoReplace, input),
    deleteOne: (input) => invoke(IPC_CHANNELS.mongoDeleteOne, input),
    deleteMany: (input) => invoke(IPC_CHANNELS.mongoDeleteMany, input),
    updateMany: (input) => invoke(IPC_CHANNELS.mongoUpdateMany, input),
    createCollection: (input) => invoke(IPC_CHANNELS.mongoCreateCollection, input),
    dropCollection: (input) => invoke(IPC_CHANNELS.mongoDropCollection, input),
    dropDatabase: (input) => invoke(IPC_CHANNELS.mongoDropDatabase, input),
    aggregate: (input) => invoke(IPC_CHANNELS.mongoAggregate, input),
    explainAggregate: (input) => invoke(IPC_CHANNELS.mongoAggregateExplain, input),
    listIndexes: (input) => invoke(IPC_CHANNELS.mongoIndexesList, input),
    createIndex: (input) => invoke(IPC_CHANNELS.mongoIndexCreate, input),
    dropIndex: (input) => invoke(IPC_CHANNELS.mongoIndexDrop, input),
    analyzeSchema: (input) => invoke(IPC_CHANNELS.mongoSchemaAnalyze, input),
    getValidation: (input) => invoke(IPC_CHANNELS.mongoValidationGet, input),
    setValidation: (input) => invoke(IPC_CHANNELS.mongoValidationSet, input),
    exportQuery: (input) => invoke(IPC_CHANNELS.mongoExport, input),
    importFile: (input) => invoke(IPC_CHANNELS.mongoImport, input),
    listSavedQueries: (input) => invoke(IPC_CHANNELS.mongoSavedList, input),
    saveQuery: (input) => invoke(IPC_CHANNELS.mongoSavedSave, input),
    deleteSavedQuery: (input) => invoke(IPC_CHANNELS.mongoSavedDelete, input)
  },
  redis: {
    list: (input) => invoke(IPC_CHANNELS.redisConnectionsList, input),
    create: (input) => invoke(IPC_CHANNELS.redisConnectionsCreate, input),
    update: (input) => invoke(IPC_CHANNELS.redisConnectionsUpdate, input),
    remove: (input) => invoke(IPC_CHANNELS.redisConnectionsDelete, input),
    test: (input) => invoke(IPC_CHANNELS.redisConnectionsTest, input),
    testDraft: (input) => invoke(IPC_CHANNELS.redisConnectionsTestDraft, input),
    pickFile: (input) => invoke(IPC_CHANNELS.redisPickFile, input),
    scan: (input) => invoke(IPC_CHANNELS.redisKeysScan, input),
    getKey: (input) => invoke(IPC_CHANNELS.redisKeysGet, input),
    keyMemory: (input) => invoke(IPC_CHANNELS.redisKeysMemory, input),
    streamInfo: (input) => invoke(IPC_CHANNELS.redisKeysStreamInfo, input),
    writeKey: (input) => invoke(IPC_CHANNELS.redisKeysWrite, input),
    deleteKey: (input) => invoke(IPC_CHANNELS.redisKeysDelete, input),
    countPattern: (input) => invoke(IPC_CHANNELS.redisKeysCountPattern, input),
    deletePattern: (input) => invoke(IPC_CHANNELS.redisKeysDeletePattern, input),
    execute: (input) => invoke(IPC_CHANNELS.redisExecute, input),
    listCommands: (input) => invoke(IPC_CHANNELS.redisCommandsList, input),
    listSavedCommands: (input) => invoke(IPC_CHANNELS.redisSavedList, input),
    saveCommand: (input) => invoke(IPC_CHANNELS.redisSavedSave, input),
    deleteSavedCommand: (input) => invoke(IPC_CHANNELS.redisSavedDelete, input),
    info: (input) => invoke(IPC_CHANNELS.redisInfo, input),
    slowlog: (input) => invoke(IPC_CHANNELS.redisSlowlogGet, input),
    resetSlowlog: (input) => invoke(IPC_CHANNELS.redisSlowlogReset, input),
    clients: (input) => invoke(IPC_CHANNELS.redisClientsList, input),
    config: (input) => invoke(IPC_CHANNELS.redisConfigGet, input),
    analyzeMemory: (input) => invoke(IPC_CHANNELS.redisMemoryAnalyze, input),
    subscribe: (input) => invoke(IPC_CHANNELS.redisPubsubSubscribe, input),
    unsubscribe: (input) => invoke(IPC_CHANNELS.redisPubsubUnsubscribe, input),
    publish: (input) => invoke(IPC_CHANNELS.redisPubsubPublish, input),
    onMessage: (listener) => subscribe<RedisMessageEvent>(REDIS_EVENTS.message, listener),
    onSubscriptionEnd: (listener) => subscribe<RedisSubscriptionEndEvent>(REDIS_EVENTS.subscriptionEnd, listener)
  },
  observability: {
    listSources: (input) => invoke(IPC_CHANNELS.observabilitySourcesList, input),
    createSource: (input) => invoke(IPC_CHANNELS.observabilitySourcesCreate, input),
    updateSource: (input) => invoke(IPC_CHANNELS.observabilitySourcesUpdate, input),
    removeSource: (input) => invoke(IPC_CHANNELS.observabilitySourcesDelete, input),
    testSource: (input) => invoke(IPC_CHANNELS.observabilitySourcesTest, input),
    testDraft: (input) => invoke(IPC_CHANNELS.observabilitySourcesTestDraft, input),
    pickFile: (input) => invoke(IPC_CHANNELS.observabilityPickFile, input),
    openUrl: (input) => invoke(IPC_CHANNELS.observabilityOpenUrl, input),
    grafanaDashboards: (input) => invoke(IPC_CHANNELS.observabilityGrafanaDashboards, input),
    grafanaDatasources: (input) => invoke(IPC_CHANNELS.observabilityGrafanaDatasources, input),
    grafanaAlerts: (input) => invoke(IPC_CHANNELS.observabilityGrafanaAlerts, input),
    prometheusQuery: (input) => invoke(IPC_CHANNELS.observabilityPrometheusQuery, input),
    prometheusRange: (input) => invoke(IPC_CHANNELS.observabilityPrometheusRange, input),
    prometheusTargets: (input) => invoke(IPC_CHANNELS.observabilityPrometheusTargets, input),
    prometheusAlerts: (input) => invoke(IPC_CHANNELS.observabilityPrometheusAlerts, input),
    prometheusMetricNames: (input) => invoke(IPC_CHANNELS.observabilityPrometheusMetricNames, input),
    lokiLabels: (input) => invoke(IPC_CHANNELS.observabilityLokiLabels, input),
    lokiLabelValues: (input) => invoke(IPC_CHANNELS.observabilityLokiLabelValues, input),
    lokiQuery: (input) => invoke(IPC_CHANNELS.observabilityLokiQuery, input),
    lokiVolume: (input) => invoke(IPC_CHANNELS.observabilityLokiVolume, input),
    lokiStartLive: (input) => invoke(IPC_CHANNELS.observabilityLokiStartLive, input),
    lokiStopLive: (input) => invoke(IPC_CHANNELS.observabilityLokiStopLive, input),
    onLiveLogs: (listener) => subscribe<LiveLogsEvent>(OBSERVABILITY_EVENTS.logs, listener),
    onLiveLogsEnd: (listener) => subscribe<LiveLogsEndEvent>(OBSERVABILITY_EVENTS.logsEnd, listener),
    listServices: (input) => invoke(IPC_CHANNELS.observabilityServicesList, input),
    createService: (input) => invoke(IPC_CHANNELS.observabilityServicesCreate, input),
    updateService: (input) => invoke(IPC_CHANNELS.observabilityServicesUpdate, input),
    removeService: (input) => invoke(IPC_CHANNELS.observabilityServicesDelete, input),
    listSignals: (input) => invoke(IPC_CHANNELS.observabilitySignalsList, input),
    createSignal: (input) => invoke(IPC_CHANNELS.observabilitySignalsCreate, input),
    updateSignal: (input) => invoke(IPC_CHANNELS.observabilitySignalsUpdate, input),
    removeSignal: (input) => invoke(IPC_CHANNELS.observabilitySignalsDelete, input),
    reorderSignals: (input) => invoke(IPC_CHANNELS.observabilitySignalsReorder, input),
    previewSignal: (input) => invoke(IPC_CHANNELS.observabilitySignalsPreview, input),
    investigate: (input) => invoke(IPC_CHANNELS.observabilityInvestigate, input),
    sentryIssues: (input) => invoke(IPC_CHANNELS.observabilitySentryIssues, input),
    sentryEvent: (input) => invoke(IPC_CHANNELS.observabilitySentryEvent, input)
  },
  cloud: {
    listDomains: (input) => invoke(IPC_CHANNELS.domainsList, input),
    createDomain: (input) => invoke(IPC_CHANNELS.domainsCreate, input),
    updateDomain: (input) => invoke(IPC_CHANNELS.domainsUpdate, input),
    removeDomain: (input) => invoke(IPC_CHANNELS.domainsDelete, input),
    listChecks: (input) => invoke(IPC_CHANNELS.checksList, input),
    createCheck: (input) => invoke(IPC_CHANNELS.checksCreate, input),
    updateCheck: (input) => invoke(IPC_CHANNELS.checksUpdate, input),
    removeCheck: (input) => invoke(IPC_CHANNELS.checksDelete, input),
    runCheck: (input) => invoke(IPC_CHANNELS.checksRunNow, input),
    checkResults: (input) => invoke(IPC_CHANNELS.checksResults, input),
    onCheckFinished: (listener) => subscribe<CheckFinishedEvent>(CLOUD_EVENTS.checkFinished, listener)
  }
};

contextBridge.exposeInMainWorld('steward', api);

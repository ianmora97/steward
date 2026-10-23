import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type StewardApi } from '@shared/types/ipc';

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

const api: StewardApi = {
  app: {
    getInfo: () => invoke(IPC_CHANNELS.appGetInfo)
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
  }
};

contextBridge.exposeInMainWorld('steward', api);

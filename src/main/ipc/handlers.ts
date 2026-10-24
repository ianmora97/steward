import type { z } from 'zod';
import { emptyPayloadSchema } from '@shared/schemas/common';
import {
  createProjectInputSchema,
  listProjectsInputSchema,
  projectIdPayloadSchema,
  updateProjectInputSchema
} from '@shared/schemas/project';
import {
  gitCheckoutInputSchema,
  gitCommitInputSchema,
  gitCreateBranchInputSchema,
  gitDeleteBranchInputSchema,
  gitDiffInputSchema,
  gitDiscardInputSchema,
  gitPullInputSchema,
  gitStageInputSchema,
  gitStatusInputSchema,
  listExecutionsInputSchema
} from '@shared/schemas/git';
import {
  gitCommitDetailInputSchema,
  gitCommitDiffInputSchema,
  gitHistoryInputSchema
} from '@shared/schemas/graph';
import {
  addRepositoryInputSchema,
  listRepositoriesInputSchema,
  repositoryIdPayloadSchema,
  validateRepositoryPathInputSchema
} from '@shared/schemas/repository';
import {
  githubConnectInputSchema,
  githubCreatePullInputSchema,
  githubGetJobLogInputSchema,
  githubListJobsInputSchema,
  githubListRunsInputSchema,
  githubRepositoryInputSchema,
  githubListBranchesInputSchema,
  githubListPullsInputSchema,
  githubOpenUrlInputSchema,
  githubProjectInputSchema
} from '@shared/schemas/github';
import {
  sshCreateInputSchema,
  sshHostIdInputSchema,
  sshListExecutionsInputSchema,
  sshListInputSchema,
  sshRunCommandInputSchema,
  sshTrustInputSchema,
  sshUpdateInputSchema
} from '@shared/schemas/ssh';
import {
  terminalCreateInputSchema,
  terminalGetSettingsInputSchema,
  terminalDeleteProfileInputSchema,
  terminalListInputSchema,
  terminalResizeInputSchema,
  terminalSaveProfileInputSchema,
  terminalSessionIdInputSchema,
  terminalSetSettingsInputSchema,
  terminalWriteInputSchema
} from '@shared/schemas/terminal';
import {
  listTabsInputSchema,
  reorderTabsInputSchema,
  restoreTabsInputSchema,
  setTabVisibilityInputSchema
} from '@shared/schemas/tabs';
import { IPC_CHANNELS, type AppInfo, type DirectoryPick, type IpcChannel } from '@shared/types/ipc';
import { fail, ok, StewardServiceError, type StewardResult } from '@shared/types/result';
import type { StewardDatabase } from '../db/connection';
import {
  createProject,
  deleteProject,
  getProjects,
  setProjectArchived,
  updateProject
} from '../services/project.service';
import { getCommitDetail, getCommitDiff, getHistory } from '../services/git-history.service';
import {
  abortMerge,
  checkoutBranch,
  commit,
  createBranch,
  deleteBranch,
  discardPaths,
  fetchRemote,
  getDiff,
  getStatus,
  listBranches,
  listExecutions,
  pull,
  push,
  stagePaths,
  unstagePaths
} from '../services/git-ops.service';
import {
  addRepository,
  listRepositories,
  removeRepository,
  validateRepositoryPath
} from '../services/repository.service';
import {
  deleteProfile,
  getSettings,
  listProfiles,
  saveProfile,
  setSettings
} from '../services/terminal-settings.service';
import type { GithubIntegrationService } from '../services/github-integration.service';
import type { GithubActionsService } from '../services/github-actions.service';
import type { GithubPullsService } from '../services/github-pulls.service';
import type { SshService } from '../services/ssh.service';
import type { TerminalService } from '../services/terminal.service';
import { listTabs, reorderTabs, restoreDefaultTabs, setTabVisibility } from '../services/tab.service';

/**
 * Channel definitions and the validate/normalize boundary.
 *
 * This module deliberately does not import Electron. Anything that needs the
 * Electron runtime (app metadata, the folder dialog) is supplied by the caller
 * through `IpcContext`, which keeps the whole contract testable in plain Node
 * and keeps the dependency pointing one way: Electron wires up services, never
 * the reverse.
 */
export interface IpcHandlerDefinition<Input = unknown, Output = unknown> {
  channel: IpcChannel;
  schema: z.ZodType<Input>;
  handle: (input: Input) => Output | Promise<Output>;
}

export interface IpcContext {
  database: StewardDatabase;
  terminal: TerminalService;
  ssh: SshService;
  github: GithubIntegrationService;
  githubPulls: GithubPullsService;
  githubActions: GithubActionsService;
  /** Supplied by the Electron layer; see src/main/index.ts. */
  readAppInfo: () => Promise<AppInfo>;
  /** Opens the OS folder picker. Cancelling is a normal outcome, not an error. */
  pickDirectory: () => Promise<DirectoryPick>;
  /** Opens the OS file picker for an SSH private key. */
  pickKeyFile: () => Promise<DirectoryPick>;
}

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path === '' ? issue.message : `${path}: ${issue.message}`;
    })
    .join('; ');
}

/**
 * Parses the payload, runs the handler, and converts everything into a
 * `StewardResult`.
 *
 * Expected failures are thrown by services as `StewardServiceError` and keep
 * their code and message. Anything else is logged in the main process and
 * reported generically, because raw error text can carry paths, command output
 * or credentials.
 */
export async function runHandler<Input, Output>(
  definition: IpcHandlerDefinition<Input, Output>,
  rawPayload: unknown
): Promise<StewardResult<Output>> {
  const parsed = definition.schema.safeParse(rawPayload ?? {});
  if (!parsed.success) {
    return fail('VALIDATION_FAILED', 'that request was rejected', formatIssues(parsed.error));
  }

  try {
    return ok(await definition.handle(parsed.data));
  } catch (error) {
    if (error instanceof StewardServiceError) {
      return fail(error.code, error.message, error.details);
    }
    console.error(`[steward] unhandled error on ${definition.channel}:`, error);
    return fail('UNKNOWN', 'something went wrong while handling that request');
  }
}

function defineHandler<Input, Output>(
  definition: IpcHandlerDefinition<Input, Output>
): IpcHandlerDefinition {
  return definition as unknown as IpcHandlerDefinition;
}

export function buildHandlerDefinitions(context: IpcContext): IpcHandlerDefinition[] {
  const { db } = context.database;

  return [
    defineHandler({
      channel: IPC_CHANNELS.appGetInfo,
      schema: emptyPayloadSchema,
      handle: () => context.readAppInfo()
    }),

    defineHandler({
      channel: IPC_CHANNELS.projectsList,
      schema: listProjectsInputSchema,
      handle: (input) => getProjects(db, input.includeArchived ?? false)
    }),
    defineHandler({
      channel: IPC_CHANNELS.projectsCreate,
      schema: createProjectInputSchema,
      handle: (input) => createProject(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.projectsUpdate,
      schema: updateProjectInputSchema,
      handle: (input) => updateProject(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.projectsArchive,
      schema: projectIdPayloadSchema,
      handle: (input) => setProjectArchived(db, input.id, true)
    }),
    defineHandler({
      channel: IPC_CHANNELS.projectsUnarchive,
      schema: projectIdPayloadSchema,
      handle: (input) => setProjectArchived(db, input.id, false)
    }),
    defineHandler({
      channel: IPC_CHANNELS.projectsDelete,
      schema: projectIdPayloadSchema,
      handle: (input) => {
        context.terminal.closeByProject(input.id);
        // The row would cascade away, but the encrypted token file would stay behind.
        context.github.purgeProject(input.id);
        return deleteProject(db, input.id);
      }
    }),

    defineHandler({
      channel: IPC_CHANNELS.repositoriesList,
      schema: listRepositoriesInputSchema,
      handle: (input) => listRepositories(db, input.projectId)
    }),
    defineHandler({
      channel: IPC_CHANNELS.repositoriesAdd,
      schema: addRepositoryInputSchema,
      handle: (input) => addRepository(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.repositoriesRemove,
      schema: repositoryIdPayloadSchema,
      handle: (input) => {
        context.terminal.closeByRepository(input.id);
        return removeRepository(db, input.id);
      }
    }),
    defineHandler({
      channel: IPC_CHANNELS.repositoriesValidatePath,
      schema: validateRepositoryPathInputSchema,
      handle: (input) => validateRepositoryPath(input.localPath)
    }),
    defineHandler({
      channel: IPC_CHANNELS.repositoriesPickDirectory,
      schema: emptyPayloadSchema,
      handle: () => context.pickDirectory()
    }),

    defineHandler({
      channel: IPC_CHANNELS.tabsList,
      schema: listTabsInputSchema,
      handle: (input) => listTabs(db, input.projectId)
    }),
    defineHandler({
      channel: IPC_CHANNELS.tabsReorder,
      schema: reorderTabsInputSchema,
      handle: (input) => reorderTabs(db, input.projectId, [...input.orderedTabKeys])
    }),
    defineHandler({
      channel: IPC_CHANNELS.tabsSetVisibility,
      schema: setTabVisibilityInputSchema,
      handle: (input) => setTabVisibility(db, input.projectId, input.tabKey, input.visible)
    }),
    defineHandler({
      channel: IPC_CHANNELS.tabsRestoreDefaults,
      schema: restoreTabsInputSchema,
      handle: (input) => restoreDefaultTabs(db, input.projectId)
    }),

    defineHandler({
      channel: IPC_CHANNELS.gitStatus,
      schema: gitStatusInputSchema,
      handle: (input) => getStatus(db, input.repositoryId)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitDiff,
      schema: gitDiffInputSchema,
      handle: (input) => getDiff(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitStage,
      schema: gitStageInputSchema,
      handle: (input) => stagePaths(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitUnstage,
      schema: gitStageInputSchema,
      handle: (input) => unstagePaths(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitDiscard,
      schema: gitDiscardInputSchema,
      handle: (input) => discardPaths(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitCommit,
      schema: gitCommitInputSchema,
      handle: (input) => commit(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitListBranches,
      schema: gitStatusInputSchema,
      handle: (input) => listBranches(db, input.repositoryId)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitCreateBranch,
      schema: gitCreateBranchInputSchema,
      handle: (input) => createBranch(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitCheckout,
      schema: gitCheckoutInputSchema,
      handle: (input) => checkoutBranch(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitDeleteBranch,
      schema: gitDeleteBranchInputSchema,
      handle: (input) => deleteBranch(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitFetch,
      schema: gitStatusInputSchema,
      handle: (input) => fetchRemote(db, input.repositoryId)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitPull,
      schema: gitPullInputSchema,
      handle: (input) => pull(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitPush,
      schema: gitStatusInputSchema,
      handle: (input) => push(db, input.repositoryId)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitAbortMerge,
      schema: gitStatusInputSchema,
      handle: (input) => abortMerge(db, input.repositoryId)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitListExecutions,
      schema: listExecutionsInputSchema,
      handle: (input) => listExecutions(db, input.repositoryId, input.limit)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitHistory,
      schema: gitHistoryInputSchema,
      handle: (input) => getHistory(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitCommitDetail,
      schema: gitCommitDetailInputSchema,
      handle: (input) => getCommitDetail(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.gitCommitDiff,
      schema: gitCommitDiffInputSchema,
      handle: (input) => getCommitDiff(db, input)
    }),

    defineHandler({
      channel: IPC_CHANNELS.terminalCreate,
      schema: terminalCreateInputSchema,
      handle: (input) => context.terminal.create(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.terminalWrite,
      schema: terminalWriteInputSchema,
      handle: (input) => {
        context.terminal.write(input);
        return null;
      }
    }),
    defineHandler({
      channel: IPC_CHANNELS.terminalResize,
      schema: terminalResizeInputSchema,
      handle: (input) => {
        context.terminal.resize(input);
        return null;
      }
    }),
    defineHandler({
      channel: IPC_CHANNELS.terminalClose,
      schema: terminalSessionIdInputSchema,
      handle: (input) => {
        context.terminal.close(input);
        return null;
      }
    }),
    defineHandler({
      channel: IPC_CHANNELS.terminalList,
      schema: terminalListInputSchema,
      handle: (input) => context.terminal.list(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.terminalAttach,
      schema: terminalSessionIdInputSchema,
      handle: (input) => context.terminal.attach(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.terminalGetSettings,
      schema: terminalGetSettingsInputSchema,
      handle: (input) => getSettings(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.terminalSetSettings,
      schema: terminalSetSettingsInputSchema,
      handle: (input) => setSettings(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.terminalListProfiles,
      schema: emptyPayloadSchema,
      handle: () => listProfiles(db)
    }),
    defineHandler({
      channel: IPC_CHANNELS.terminalSaveProfile,
      schema: terminalSaveProfileInputSchema,
      handle: (input) => saveProfile(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.terminalDeleteProfile,
      schema: terminalDeleteProfileInputSchema,
      handle: (input) => deleteProfile(db, input)
    }),

    defineHandler({
      channel: IPC_CHANNELS.sshList,
      schema: sshListInputSchema,
      handle: (input) => context.ssh.list(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.sshCreate,
      schema: sshCreateInputSchema,
      handle: (input) => context.ssh.create(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.sshUpdate,
      schema: sshUpdateInputSchema,
      handle: (input) => context.ssh.update(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.sshRemove,
      schema: sshHostIdInputSchema,
      handle: (input) => {
        context.terminal.closeBySshHost(input.id);
        return context.ssh.remove(input);
      }
    }),
    defineHandler({
      channel: IPC_CHANNELS.sshTest,
      schema: sshHostIdInputSchema,
      handle: (input) => context.ssh.test(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.sshScanHostKey,
      schema: sshHostIdInputSchema,
      handle: (input) => context.ssh.scanHostKey(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.sshTrustHostKey,
      schema: sshTrustInputSchema,
      handle: (input) => context.ssh.trustHostKey(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.sshRunCommand,
      schema: sshRunCommandInputSchema,
      handle: (input) => context.ssh.runCommand(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.sshListExecutions,
      schema: sshListExecutionsInputSchema,
      handle: (input) => context.ssh.listExecutions(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.sshPickKeyFile,
      schema: emptyPayloadSchema,
      handle: () => context.pickKeyFile()
    }),

    defineHandler({
      channel: IPC_CHANNELS.githubConnect,
      schema: githubConnectInputSchema,
      handle: (input) => context.github.connect(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.githubImportFromGh,
      schema: githubProjectInputSchema,
      handle: (input) => context.github.importFromGh(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.githubDisconnect,
      schema: githubProjectInputSchema,
      handle: (input) => context.github.disconnect(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.githubStatus,
      schema: githubProjectInputSchema,
      handle: (input) => context.github.status(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.githubListPulls,
      schema: githubListPullsInputSchema,
      handle: (input) => context.githubPulls.listPulls(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.githubListBranches,
      schema: githubListBranchesInputSchema,
      handle: (input) => context.githubPulls.listBranches(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.githubCreatePull,
      schema: githubCreatePullInputSchema,
      handle: (input) => context.githubPulls.createPull(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.githubOpenUrl,
      schema: githubOpenUrlInputSchema,
      handle: (input) => context.githubPulls.openUrl(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.githubListWorkflows,
      schema: githubRepositoryInputSchema,
      handle: (input) => context.githubActions.listWorkflows(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.githubListRuns,
      schema: githubListRunsInputSchema,
      handle: (input) => context.githubActions.listRuns(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.githubListJobs,
      schema: githubListJobsInputSchema,
      handle: (input) => context.githubActions.listJobs(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.githubGetJobLog,
      schema: githubGetJobLogInputSchema,
      handle: (input) => context.githubActions.getJobLog(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.githubGetHealth,
      schema: githubRepositoryInputSchema,
      handle: (input) => context.githubActions.getHealth(input)
    })
  ];
}

/**
 * Every declared channel must have exactly one handler, and no handler may
 * serve an undeclared channel. Called at startup and asserted in tests, so a
 * channel can never be added on one side of the boundary only.
 */
export function assertChannelCoverage(definitions: readonly IpcHandlerDefinition[]): void {
  const declared = new Set<string>(Object.values(IPC_CHANNELS));
  const seen = new Set<string>();

  for (const definition of definitions) {
    if (!declared.has(definition.channel)) {
      throw new Error(`[steward] handler for undeclared channel: ${definition.channel}`);
    }
    if (seen.has(definition.channel)) {
      throw new Error(`[steward] duplicate handler for channel: ${definition.channel}`);
    }
    if (typeof definition.schema?.safeParse !== 'function') {
      throw new Error(`[steward] channel without a schema: ${definition.channel}`);
    }
    seen.add(definition.channel);
  }

  const missing = [...declared].filter((channel) => !seen.has(channel));
  if (missing.length > 0) {
    throw new Error(`[steward] declared channels without handlers: ${missing.join(', ')}`);
  }
}

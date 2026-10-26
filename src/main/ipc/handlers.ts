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
  deployTargetCreateInputSchema,
  deployTargetIdInputSchema,
  deployTargetListInputSchema,
  deployTargetUpdateInputSchema
} from '@shared/schemas/deploy-targets';
import {
  deploymentIdInputSchema,
  deploymentListInputSchema,
  deploymentStartInputSchema,
  deploymentWorkflowInputsInputSchema
} from '@shared/schemas/deployments';
import {
  dockerComposeActionInputSchema,
  dockerComposeListInputSchema,
  dockerComposeRepositoryInputSchema,
  dockerContainerActionInputSchema,
  dockerContainerIdInputSchema,
  dockerImagePullInputSchema,
  dockerImageRemoveInputSchema,
  dockerLogsStartInputSchema,
  dockerLogsStopInputSchema,
  dockerNetworkRemoveInputSchema,
  dockerPruneInputSchema,
  dockerStartInputSchema,
  dockerTargetInputSchema,
  dockerVolumeRemoveInputSchema
} from '@shared/schemas/docker';
import {
  mongoAggregateExplainInputSchema,
  mongoAggregateInputSchema,
  mongoConnectionCreateInputSchema,
  mongoConnectionDraftInputSchema,
  mongoConnectionIdInputSchema,
  mongoConnectionListInputSchema,
  mongoConnectionUpdateInputSchema,
  mongoCountInputSchema,
  mongoCreateCollectionInputSchema,
  mongoDatabaseInputSchema,
  mongoDeleteManyInputSchema,
  mongoDeleteOneInputSchema,
  mongoDropCollectionInputSchema,
  mongoDropDatabaseInputSchema,
  mongoExplainInputSchema,
  mongoExportInputSchema,
  mongoFindInputSchema,
  mongoImportInputSchema,
  mongoIndexCreateInputSchema,
  mongoIndexDropInputSchema,
  mongoInsertInputSchema,
  mongoNamespaceInputSchema,
  mongoPickFileInputSchema,
  mongoReplaceInputSchema,
  mongoSavedQueryDeleteInputSchema,
  mongoSavedQueryListInputSchema,
  mongoSavedQuerySaveInputSchema,
  mongoSchemaInputSchema,
  mongoUpdateManyInputSchema,
  mongoValidationSetInputSchema
} from '@shared/schemas/mongodb';
import {
  redisConnectionCreateInputSchema,
  redisConnectionDraftInputSchema,
  redisConnectionIdInputSchema,
  redisConnectionListInputSchema,
  redisConnectionUpdateInputSchema,
  redisExecuteInputSchema,
  redisKeyDeleteInputSchema,
  redisKeyGetInputSchema,
  redisKeyInputSchema,
  redisKeyWriteInputSchema,
  redisMemoryAnalyzeInputSchema,
  redisPatternDeleteInputSchema,
  redisPatternInputSchema,
  redisPickFileInputSchema,
  redisPubsubPublishInputSchema,
  redisPubsubSubscribeInputSchema,
  redisPubsubUnsubscribeInputSchema,
  redisSavedDeleteInputSchema,
  redisSavedListInputSchema,
  redisSavedSaveInputSchema,
  redisScanInputSchema,
  redisSlowlogResetInputSchema
} from '@shared/schemas/redis';
import {
  environmentCreateInputSchema,
  environmentIdInputSchema,
  environmentListInputSchema,
  environmentReorderInputSchema,
  environmentUpdateInputSchema
} from '@shared/schemas/environments';
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
import {
  createDeployTarget,
  deleteDeployTarget,
  listDeployTargets,
  updateDeployTarget
} from '../services/deploy-target.service';
import {
  createEnvironment,
  deleteEnvironment,
  listEnvironments,
  reorderEnvironments,
  updateEnvironment
} from '../services/environment.service';
import type { DeploymentService } from '../services/deployment.service';
import type { DockerService } from '../services/docker.service';
import type { MongoService } from '../services/mongo.service';
import type { RedisService } from '../services/redis.service';
import { createOverviewService } from '../services/overview.service';
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
  deployments: DeploymentService;
  docker: DockerService;
  mongo: MongoService;
  redis: RedisService;
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
  const overview = createOverviewService({ db, ssh: context.ssh });

  return [
    defineHandler({
      channel: IPC_CHANNELS.appGetInfo,
      schema: emptyPayloadSchema,
      handle: () => context.readAppInfo()
    }),
    defineHandler({
      channel: IPC_CHANNELS.overviewSummary,
      schema: emptyPayloadSchema,
      handle: () => overview.summary()
    }),
    defineHandler({
      channel: IPC_CHANNELS.overviewActivity,
      schema: emptyPayloadSchema,
      handle: () => overview.activity()
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
      handle: async (input) => {
        context.terminal.closeByProject(input.id);
        context.docker.closeByProject(input.id);
        // Connections cascade away with the project, but their encrypted secrets and open clients would stay.
        await context.mongo.purgeProject(input.id);
        await context.redis.purgeProject(input.id);
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
        context.docker.closeBySshHost(input.id);
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
    }),

    defineHandler({
      channel: IPC_CHANNELS.environmentsList,
      schema: environmentListInputSchema,
      handle: (input) => listEnvironments(db, input.projectId)
    }),
    defineHandler({
      channel: IPC_CHANNELS.environmentsCreate,
      schema: environmentCreateInputSchema,
      handle: (input) => createEnvironment(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.environmentsUpdate,
      schema: environmentUpdateInputSchema,
      handle: (input) => updateEnvironment(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.environmentsReorder,
      schema: environmentReorderInputSchema,
      handle: (input) => reorderEnvironments(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.environmentsDelete,
      schema: environmentIdInputSchema,
      handle: (input) => deleteEnvironment(db, input)
    }),

    defineHandler({
      channel: IPC_CHANNELS.deployTargetsList,
      schema: deployTargetListInputSchema,
      handle: (input) => listDeployTargets(db, input.projectId)
    }),
    defineHandler({
      channel: IPC_CHANNELS.deployTargetsCreate,
      schema: deployTargetCreateInputSchema,
      handle: (input) => createDeployTarget(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.deployTargetsUpdate,
      schema: deployTargetUpdateInputSchema,
      handle: (input) => updateDeployTarget(db, input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.deployTargetsDelete,
      schema: deployTargetIdInputSchema,
      handle: (input) => deleteDeployTarget(db, input)
    }),

    defineHandler({
      channel: IPC_CHANNELS.deploymentsStart,
      schema: deploymentStartInputSchema,
      handle: (input) => context.deployments.start(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.deploymentsList,
      schema: deploymentListInputSchema,
      handle: (input) => context.deployments.list(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.deploymentsGet,
      schema: deploymentIdInputSchema,
      handle: (input) => context.deployments.get(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.deploymentsLog,
      schema: deploymentIdInputSchema,
      handle: (input) => context.deployments.readLog(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.deploymentsWorkflowInputs,
      schema: deploymentWorkflowInputsInputSchema,
      handle: (input) => context.deployments.listWorkflowInputs(input)
    }),

    defineHandler({
      channel: IPC_CHANNELS.dockerStatus,
      schema: dockerTargetInputSchema,
      handle: (input) => context.docker.status(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerStart,
      schema: dockerStartInputSchema,
      handle: (input) => context.docker.startEngine(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerContainersList,
      schema: dockerTargetInputSchema,
      handle: (input) => context.docker.listContainers(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerContainersStats,
      schema: dockerTargetInputSchema,
      handle: (input) => context.docker.containerStats(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerContainerInspect,
      schema: dockerContainerIdInputSchema,
      handle: (input) => context.docker.inspectContainer(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerContainerAction,
      schema: dockerContainerActionInputSchema,
      handle: (input) => context.docker.containerAction(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerImagesList,
      schema: dockerTargetInputSchema,
      handle: (input) => context.docker.listImages(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerImagePull,
      schema: dockerImagePullInputSchema,
      handle: (input) => context.docker.pullImage(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerImageRemove,
      schema: dockerImageRemoveInputSchema,
      handle: (input) => context.docker.removeImage(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerSystemDf,
      schema: dockerTargetInputSchema,
      handle: (input) => context.docker.systemDf(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerPrune,
      schema: dockerPruneInputSchema,
      handle: (input) => context.docker.prune(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerVolumesList,
      schema: dockerTargetInputSchema,
      handle: (input) => context.docker.listVolumes(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerVolumeRemove,
      schema: dockerVolumeRemoveInputSchema,
      handle: (input) => context.docker.removeVolume(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerNetworksList,
      schema: dockerTargetInputSchema,
      handle: (input) => context.docker.listNetworks(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerNetworkRemove,
      schema: dockerNetworkRemoveInputSchema,
      handle: (input) => context.docker.removeNetwork(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerLogsStart,
      schema: dockerLogsStartInputSchema,
      handle: (input) => context.docker.startLogs(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerLogsStop,
      schema: dockerLogsStopInputSchema,
      handle: (input) => context.docker.stopLogs(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerComposeList,
      schema: dockerComposeListInputSchema,
      handle: (input) => context.docker.listComposeProjects(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerComposeServices,
      schema: dockerComposeRepositoryInputSchema,
      handle: (input) => context.docker.composeServices(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.dockerComposeAction,
      schema: dockerComposeActionInputSchema,
      handle: (input) => context.docker.composeAction(input)
    }),

    defineHandler({
      channel: IPC_CHANNELS.mongoConnectionsList,
      schema: mongoConnectionListInputSchema,
      handle: (input) => context.mongo.listConnections(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoConnectionsCreate,
      schema: mongoConnectionCreateInputSchema,
      handle: (input) => context.mongo.createConnection(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoConnectionsUpdate,
      schema: mongoConnectionUpdateInputSchema,
      handle: (input) => context.mongo.updateConnection(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoConnectionsDelete,
      schema: mongoConnectionIdInputSchema,
      handle: (input) => context.mongo.removeConnection(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoConnectionsTest,
      schema: mongoConnectionIdInputSchema,
      handle: (input) => context.mongo.testConnection(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoConnectionsTestDraft,
      schema: mongoConnectionDraftInputSchema,
      handle: (input) => context.mongo.testDraft(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoPickFile,
      schema: mongoPickFileInputSchema,
      handle: (input) => context.mongo.pickFile(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoDatabasesList,
      schema: mongoConnectionIdInputSchema,
      handle: (input) => context.mongo.listDatabases(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoCollectionsList,
      schema: mongoDatabaseInputSchema,
      handle: (input) => context.mongo.listCollections(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoCollectionStats,
      schema: mongoNamespaceInputSchema,
      handle: (input) => context.mongo.collectionStats(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoFind,
      schema: mongoFindInputSchema,
      handle: (input) => context.mongo.find(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoCount,
      schema: mongoCountInputSchema,
      handle: (input) => context.mongo.count(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoExplain,
      schema: mongoExplainInputSchema,
      handle: (input) => context.mongo.explain(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoInsert,
      schema: mongoInsertInputSchema,
      handle: (input) => context.mongo.insert(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoReplace,
      schema: mongoReplaceInputSchema,
      handle: (input) => context.mongo.replace(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoDeleteOne,
      schema: mongoDeleteOneInputSchema,
      handle: (input) => context.mongo.deleteOne(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoDeleteMany,
      schema: mongoDeleteManyInputSchema,
      handle: (input) => context.mongo.deleteMany(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoUpdateMany,
      schema: mongoUpdateManyInputSchema,
      handle: (input) => context.mongo.updateMany(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoCreateCollection,
      schema: mongoCreateCollectionInputSchema,
      handle: (input) => context.mongo.createCollection(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoDropCollection,
      schema: mongoDropCollectionInputSchema,
      handle: (input) => context.mongo.dropCollection(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoDropDatabase,
      schema: mongoDropDatabaseInputSchema,
      handle: (input) => context.mongo.dropDatabase(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoAggregate,
      schema: mongoAggregateInputSchema,
      handle: (input) => context.mongo.aggregate(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoAggregateExplain,
      schema: mongoAggregateExplainInputSchema,
      handle: (input) => context.mongo.explainAggregate(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoIndexesList,
      schema: mongoNamespaceInputSchema,
      handle: (input) => context.mongo.listIndexes(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoIndexCreate,
      schema: mongoIndexCreateInputSchema,
      handle: (input) => context.mongo.createIndex(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoIndexDrop,
      schema: mongoIndexDropInputSchema,
      handle: (input) => context.mongo.dropIndex(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoSchemaAnalyze,
      schema: mongoSchemaInputSchema,
      handle: (input) => context.mongo.analyzeSchema(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoValidationGet,
      schema: mongoNamespaceInputSchema,
      handle: (input) => context.mongo.getValidation(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoValidationSet,
      schema: mongoValidationSetInputSchema,
      handle: (input) => context.mongo.setValidation(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoExport,
      schema: mongoExportInputSchema,
      handle: (input) => context.mongo.exportQuery(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoImport,
      schema: mongoImportInputSchema,
      handle: (input) => context.mongo.importFile(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoSavedList,
      schema: mongoSavedQueryListInputSchema,
      handle: (input) => context.mongo.listSavedQueries(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoSavedSave,
      schema: mongoSavedQuerySaveInputSchema,
      handle: (input) => context.mongo.saveQuery(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.mongoSavedDelete,
      schema: mongoSavedQueryDeleteInputSchema,
      handle: (input) => context.mongo.deleteSavedQuery(input)
    }),

    defineHandler({
      channel: IPC_CHANNELS.redisConnectionsList,
      schema: redisConnectionListInputSchema,
      handle: (input) => context.redis.listConnections(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisConnectionsCreate,
      schema: redisConnectionCreateInputSchema,
      handle: (input) => context.redis.createConnection(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisConnectionsUpdate,
      schema: redisConnectionUpdateInputSchema,
      handle: (input) => context.redis.updateConnection(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisConnectionsDelete,
      schema: redisConnectionIdInputSchema,
      handle: (input) => context.redis.removeConnection(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisConnectionsTest,
      schema: redisConnectionIdInputSchema,
      handle: (input) => context.redis.testConnection(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisConnectionsTestDraft,
      schema: redisConnectionDraftInputSchema,
      handle: (input) => context.redis.testDraft(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisPickFile,
      schema: redisPickFileInputSchema,
      handle: (input) => context.redis.pickFile(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisKeysScan,
      schema: redisScanInputSchema,
      handle: (input) => context.redis.scan(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisKeysGet,
      schema: redisKeyGetInputSchema,
      handle: (input) => context.redis.getKey(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisKeysMemory,
      schema: redisKeyInputSchema,
      handle: (input) => context.redis.keyMemory(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisKeysStreamInfo,
      schema: redisKeyInputSchema,
      handle: (input) => context.redis.streamInfo(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisKeysWrite,
      schema: redisKeyWriteInputSchema,
      handle: (input) => context.redis.writeKey(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisKeysDelete,
      schema: redisKeyDeleteInputSchema,
      handle: (input) => context.redis.deleteKey(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisKeysCountPattern,
      schema: redisPatternInputSchema,
      handle: (input) => context.redis.countPattern(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisKeysDeletePattern,
      schema: redisPatternDeleteInputSchema,
      handle: (input) => context.redis.deletePattern(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisExecute,
      schema: redisExecuteInputSchema,
      handle: (input) => context.redis.execute(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisCommandsList,
      schema: redisConnectionIdInputSchema,
      handle: (input) => context.redis.listCommands(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisSavedList,
      schema: redisSavedListInputSchema,
      handle: (input) => context.redis.listSavedCommands(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisSavedSave,
      schema: redisSavedSaveInputSchema,
      handle: (input) => context.redis.saveCommand(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisSavedDelete,
      schema: redisSavedDeleteInputSchema,
      handle: (input) => context.redis.deleteSavedCommand(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisInfo,
      schema: redisConnectionIdInputSchema,
      handle: (input) => context.redis.info(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisSlowlogGet,
      schema: redisConnectionIdInputSchema,
      handle: (input) => context.redis.slowlog(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisSlowlogReset,
      schema: redisSlowlogResetInputSchema,
      handle: (input) => context.redis.resetSlowlog(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisClientsList,
      schema: redisConnectionIdInputSchema,
      handle: (input) => context.redis.clients(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisConfigGet,
      schema: redisConnectionIdInputSchema,
      handle: (input) => context.redis.config(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisMemoryAnalyze,
      schema: redisMemoryAnalyzeInputSchema,
      handle: (input) => context.redis.analyzeMemory(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisPubsubSubscribe,
      schema: redisPubsubSubscribeInputSchema,
      handle: (input) => context.redis.subscribe(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisPubsubUnsubscribe,
      schema: redisPubsubUnsubscribeInputSchema,
      handle: (input) => context.redis.unsubscribe(input)
    }),
    defineHandler({
      channel: IPC_CHANNELS.redisPubsubPublish,
      schema: redisPubsubPublishInputSchema,
      handle: (input) => context.redis.publish(input)
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

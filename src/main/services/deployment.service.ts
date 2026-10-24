import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import type { DeployTarget } from '@shared/schemas/deploy-targets';
import type { Environment } from '@shared/schemas/environments';
import type {
  Deployment,
  DeploymentIdInput,
  DeploymentListInput,
  DeploymentLog,
  DeploymentStartInput,
  DeploymentWorkflowInputsInput,
  WorkflowInputSpec
} from '@shared/schemas/deployments';
import { StewardServiceError } from '@shared/types/result';
import {
  closeInterruptedExecution,
  findActiveDeploymentForTarget,
  findDeploymentById,
  findExecutionLogPath,
  insertDeployment,
  listActiveDeployments,
  listDeploymentsByProject,
  settleDeployment,
  updateDeployment
} from '../db/deployment.repo';
import type { SqlDatabase } from '../db/driver';
import { nowIso, uuidv7 } from '../db/id';
import { requireProject } from './project.service';
import { requireDeployTarget } from './deploy-target.service';
import type { DeploymentContext, DeploymentLaunch, DeploymentRunner } from './deployment-runner';
import { createDispatchRunner } from './deployment-dispatch';
import { createSshRunner } from './deployment-ssh';
import { requireEnvironment } from './environment.service';
import type { GithubApi } from './github-api';
import type { GithubIntegrationService } from './github-integration.service';
import { resolveGithubRepo } from './github-repo';
import type { SshService } from './ssh.service';
import { parseWorkflowInputs } from './workflow-inputs';

const MAX_LOG_TAIL_BYTES = 200 * 1024;

export interface DeploymentServiceDeps {
  db: SqlDatabase;
  ssh: SshService;
  github: GithubIntegrationService;
  api: GithubApi;
}

/**
 * The one place a deployment changes state. Runners execute and report; this
 * service validates, confirms, records and is the only thing that closes a
 * deployment, so "never succeeded without evidence" has a single home.
 */
export interface DeploymentService {
  /** Validates, records and starts a deployment; it keeps running in the background after this returns. */
  start: (input: DeploymentStartInput) => Promise<Deployment>;
  list: (input: DeploymentListInput) => Deployment[];
  get: (input: DeploymentIdInput) => Deployment;
  readLog: (input: DeploymentIdInput) => Promise<DeploymentLog>;
  /** The inputs a workflow declares for a manual run, read from its file at `ref`. */
  listWorkflowInputs: (input: DeploymentWorkflowInputsInput) => Promise<WorkflowInputSpec[]>;
  /** Settles or resumes whatever a previous run of the app left open. Call once at startup. */
  resumeOnStartup: () => void;
}

/** The end of a log file; the file was already redacted when it was written. */
function readLogTail(path: string): DeploymentLog {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, 'r');
    const size = fstatSync(descriptor).size;
    if (size <= MAX_LOG_TAIL_BYTES) return { text: readFileSync(descriptor, 'utf8'), truncated: false };
    const buffer = Buffer.alloc(MAX_LOG_TAIL_BYTES);
    readSync(descriptor, buffer, 0, MAX_LOG_TAIL_BYTES, size - MAX_LOG_TAIL_BYTES);
    const text = buffer.toString('utf8');
    // The cut can land mid-line (or mid-character); start at the next whole line.
    const newline = text.indexOf('\n');
    return { text: newline === -1 ? text : text.slice(newline + 1), truncated: true };
  } catch {
    return { text: '', truncated: false };
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

/**
 * The confirmation is checked here, in main, whatever the renderer showed: a
 * protected environment needs its name typed exactly (no trimming, no case
 * folding); any other target that asks needs an explicit yes.
 */
function assertConfirmed(environment: Environment, target: DeployTarget, input: DeploymentStartInput): void {
  if (environment.isProtected) {
    if (input.confirmation === null) {
      throw new StewardServiceError(
        'CONFIRMATION_REQUIRED',
        `${environment.name} is protected: type its name to deploy`
      );
    }
    if (input.confirmation.environmentName !== environment.name) {
      throw new StewardServiceError(
        'CONFIRMATION_MISMATCH',
        'what you typed is not the name of this environment',
        'It has to match exactly, including capitals and spaces.'
      );
    }
    return;
  }
  if (target.requiresConfirmation && !input.confirmed) {
    throw new StewardServiceError('CONFIRMATION_REQUIRED', 'this target needs your confirmation before it deploys');
  }
}

export function createDeploymentService(deps: DeploymentServiceDeps): DeploymentService {
  const { db } = deps;
  const runners: Partial<Record<DeployTarget['kind'], DeploymentRunner>> = {
    ssh_command: createSshRunner({ db, ssh: deps.ssh }),
    github_workflow_dispatch: createDispatchRunner({ db, github: deps.github, api: deps.api })
  };

  function requireDeployment(id: string): Deployment {
    const deployment = findDeploymentById(db, id);
    if (deployment === null) throw new StewardServiceError('NOT_FOUND', 'that deployment no longer exists');
    return deployment;
  }

  function contextFor(deployment: Deployment): DeploymentContext {
    return {
      deployment,
      update: (patch) => updateDeployment(db, deployment.id, patch),
      settle: (outcome) => {
        settleDeployment(db, deployment.id, outcome);
      }
    };
  }

  /** A runner that throws still leaves an honest record: it did not report an outcome, so the outcome is unknown. */
  function guard(context: DeploymentContext, work: Promise<void>): void {
    void work.catch((error: unknown) => {
      console.error(
        '[steward] a deployment runner failed unexpectedly:',
        error instanceof StewardServiceError ? error.code : error instanceof Error ? error.name : 'unknown'
      );
      context.settle({
        status: 'unknown',
        notes: 'Steward lost track of this deployment after an unexpected error. Check the target directly.'
      });
    });
  }

  async function start(input: DeploymentStartInput): Promise<Deployment> {
    const target = requireDeployTarget(db, input.targetId);
    if (target.broken) {
      throw new StewardServiceError('TARGET_BROKEN', `${target.name} points at something that no longer exists`, 'Edit the target first.');
    }
    const environment = requireEnvironment(db, target.environmentId);
    assertConfirmed(environment, target, input);

    const runner = runners[target.kind];
    if (runner === undefined) {
      throw new StewardServiceError('VALIDATION_FAILED', 'that kind of target cannot be deployed yet');
    }
    const busy = (): StewardServiceError =>
      new StewardServiceError('TARGET_BUSY', `${target.name} already has a deployment in progress`);
    if (findActiveDeploymentForTarget(db, target.id) !== null) throw busy();

    const launch: DeploymentLaunch = await runner.prepare(target, input);

    // The check and the insert share one synchronous block, so two requests cannot both pass.
    if (findActiveDeploymentForTarget(db, target.id) !== null) throw busy();
    const id = uuidv7();
    insertDeployment(db, {
      id,
      projectId: target.projectId,
      environmentId: environment.id,
      deployTargetId: target.id,
      targetName: target.name,
      targetKind: target.kind,
      repositoryId: target.kind === 'github_workflow_dispatch' ? target.repositoryId : null,
      ref: launch.ref,
      requestedAt: nowIso()
    });

    const deployment = requireDeployment(id);
    const context = contextFor(deployment);
    guard(context, launch.execute(context));
    return deployment;
  }

  return {
    start,

    list: (input) => {
      requireProject(db, input.projectId);
      return listDeploymentsByProject(db, input.projectId, input.limit);
    },

    get: (input) => requireDeployment(input.id),

    listWorkflowInputs: async (input) => {
      const { owner, name } = resolveGithubRepo(db, input);
      const text = await deps.github.withToken(input.projectId, (token) =>
        deps.api.getWorkflowFile(token, owner, name, input.workflowPath, input.ref)
      );
      return parseWorkflowInputs(text);
    },

    readLog: (input) => {
      const deployment = requireDeployment(input.id);
      const path = deployment.executionId === null ? null : findExecutionLogPath(db, deployment.executionId);
      return Promise.resolve(path === null ? { text: '', truncated: false } : readLogTail(path));
    },

    resumeOnStartup: () => {
      for (const deployment of listActiveDeployments(db)) {
        const context = contextFor(deployment);
        const runner = runners[deployment.targetKind];
        if (runner?.resume !== undefined && deployment.runId !== null) {
          guard(context, runner.resume(deployment, context));
          continue;
        }
        const notes =
          deployment.targetKind === 'ssh_command'
            ? 'Steward closed before the command finished. Check the server.'
            : 'Steward closed before the run could be found. Check the Actions tab on GitHub.';
        context.settle({ status: 'unknown', notes });
        if (deployment.executionId !== null) closeInterruptedExecution(db, deployment.executionId, notes);
      }
    }
  };
}

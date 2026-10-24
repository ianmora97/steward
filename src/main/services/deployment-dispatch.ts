import type { GithubRun } from '@shared/schemas/github';
import { StewardServiceError } from '@shared/types/result';
import { isRunClaimed, linkExecutionToDeploy, type SettleOutcome } from '../db/deployment.repo';
import type { SqlDatabase } from '../db/driver';
import { insertExecution, updateExecutionFinish } from '../db/execution.repo';
import { nowIso, uuidv7 } from '../db/id';
import type { DeploymentContext, DeploymentRunner } from './deployment-runner';
import type { GithubApi } from './github-api';
import type { GithubIntegrationService } from './github-integration.service';
import { resolveGithubRepo } from './github-repo';
import { parseWorkflowInputs, validateWorkflowInputs } from './workflow-inputs';

/** How often and for how long the run that a dispatch created is looked for. */
const FIND_INTERVAL_MS = 3_000;
const FIND_TIMEOUT_MS = 45_000;
/** When GitHub's answer to the dispatch was ambiguous (no answer, or a server error), a run that exists anyway shows up quickly or not at all. */
const FIND_AFTER_ERROR_MS = 12_000;
/** Once found, the run is read this often until it completes; it backs off up to the longer one while GitHub is unreachable. */
const WATCH_INTERVAL_MS = 10_000;
const MAX_WATCH_BACKOFF_MS = 120_000;
/** Consecutive reads that fail for a reason that will not fix itself (token, permissions, run gone) before giving up. */
const MAX_WATCH_FAILURES = 5;
/** Longest Steward keeps following one run. */
const MAX_WATCH_MS = 6 * 60 * 60 * 1000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface DispatchRunnerDeps {
  db: SqlDatabase;
  github: GithubIntegrationService;
  api: GithubApi;
}

interface RepoRef {
  projectId: string;
  owner: string;
  name: string;
}

/**
 * Trouble that says nothing about the run and goes away by itself: no network, a rate limit, a GitHub
 * server error. Anything else (a revoked token, missing permission, a run that is gone) will not.
 */
function isTransient(error: unknown): boolean {
  if (!(error instanceof StewardServiceError)) return false;
  return (
    error.code === 'GITHUB_UNREACHABLE' ||
    error.code === 'GITHUB_RATE_LIMITED' ||
    (error.code === 'GITHUB_FAILED' && error.details?.startsWith('HTTP 5') === true)
  );
}

/** Whether a failed dispatch may still have started a run: no answer, or a server error that does not say. */
function isAmbiguousDispatchError(error: StewardServiceError): boolean {
  return (
    error.code === 'GITHUB_UNREACHABLE' ||
    (error.code === 'GITHUB_FAILED' && error.details?.startsWith('HTTP 5') === true)
  );
}

/** Only well-formed conclusions are quoted: the value comes from GitHub and ends up in a note. */
function describeConclusion(conclusion: string | null): string {
  return conclusion !== null && /^[a-z_]{1,30}$/.test(conclusion) ? `"${conclusion}"` : 'no recognisable conclusion';
}

/**
 * Only `success` counts as success. Anything GitHub reports that Steward cannot
 * classify (skipped, neutral, action_required…) stays `unknown` rather than being
 * rounded to a result.
 */
function settleFromRun(settle: (outcome: SettleOutcome) => void, run: GithubRun): void {
  switch (run.conclusion) {
    case 'success':
      settle({ status: 'succeeded', source: 'provider' });
      return;
    case 'failure':
    case 'startup_failure':
      settle({ status: 'failed', source: 'provider', notes: 'The workflow run failed.' });
      return;
    case 'timed_out':
      settle({ status: 'failed', source: 'provider', notes: 'The workflow run timed out.' });
      return;
    case 'cancelled':
      settle({ status: 'cancelled', source: 'provider', notes: 'The run was cancelled on GitHub.' });
      return;
    default:
      settle({
        status: 'unknown',
        notes: `GitHub finished the run with ${describeConclusion(run.conclusion)}, which Steward cannot count as a success or a failure.`
      });
  }
}

/**
 * Reads a run until it completes. Network trouble, rate limits and GitHub server
 * errors are waited out with a growing pause, so a laptop that sleeps or a VPN
 * that reconnects does not lose the result. Trouble that will not fix itself
 * (token, permissions, run gone) ends in `unknown` after a few tries, and so
 * does a run still open after six hours: the outcome is never `failed`, the run
 * itself may be fine.
 */
async function watchRun(
  deps: DispatchRunnerDeps,
  repo: RepoRef,
  runId: number,
  startedAt: number,
  settle: (outcome: SettleOutcome) => void
): Promise<void> {
  let failures = 0;
  let transientFailures = 0;
  for (;;) {
    if (Date.now() - startedAt > MAX_WATCH_MS) {
      settle({ status: 'unknown', notes: 'Steward stopped following this run after 6 hours. Check it on GitHub.' });
      return;
    }
    try {
      const run = await deps.github.withToken(repo.projectId, (token) =>
        deps.api.getRun(token, repo.owner, repo.name, runId)
      );
      failures = 0;
      transientFailures = 0;
      if (run.status === 'completed') {
        settleFromRun(settle, run);
        return;
      }
    } catch (error) {
      if (isTransient(error)) {
        transientFailures += 1;
      } else {
        failures += 1;
        if (failures >= MAX_WATCH_FAILURES) {
          settle({
            status: 'unknown',
            notes: 'Steward could not read the run from GitHub, so it does not know how it ended. Check it on GitHub.'
          });
          return;
        }
      }
    }
    await sleep(Math.min(WATCH_INTERVAL_MS * 2 ** Math.min(transientFailures, 4), MAX_WATCH_BACKOFF_MS));
  }
}

/**
 * Deploys by starting a GitHub Actions workflow. The dispatch answers with no run
 * id, so the run is found afterwards: the newest run id of that workflow on that
 * ref is taken first, and the run created by the dispatch is the first one above it.
 */
export function createDispatchRunner(deps: DispatchRunnerDeps): DeploymentRunner {
  /** Closes the execution row alongside the deployment, so the activity log and the history agree. */
  function closing(
    context: DeploymentContext,
    executionId: string | null,
    startedAt: string
  ): (outcome: SettleOutcome) => void {
    return (outcome) => {
      context.settle(outcome);
      if (executionId === null) return;
      const status =
        outcome.status === 'succeeded' ? 'succeeded' : outcome.status === 'cancelled' ? 'cancelled' : 'failed';
      updateExecutionFinish(deps.db, executionId, {
        status,
        exitCode: null,
        finishedAt: nowIso(),
        durationMs: Date.now() - Date.parse(startedAt),
        errorCode: outcome.status === 'unknown' ? 'UNKNOWN_OUTCOME' : null,
        errorMessage: outcome.status === 'succeeded' ? null : (outcome.notes ?? null)
      });
    };
  }

  return {
    prepare: async (target, input) => {
      if (target.kind !== 'github_workflow_dispatch' || target.repositoryId === null) {
        throw new StewardServiceError(
          'TARGET_BROKEN',
          'this target has no repository to run in',
          'Edit it and choose a repository.'
        );
      }
      const { repositoryId } = target;
      const { workflowId, workflowPath, defaultRef } = target.config;
      const ref = input.ref ?? defaultRef;
      const { owner, name } = resolveGithubRepo(deps.db, { projectId: target.projectId, repositoryId });
      const repo: RepoRef = { projectId: target.projectId, owner, name };

      // The inputs are read again from the workflow itself: what the form showed may be out of date.
      const file = await deps.github.withToken(repo.projectId, (token) =>
        deps.api.getWorkflowFile(token, owner, name, workflowPath, ref)
      );
      const inputs = validateWorkflowInputs(parseWorkflowInputs(file), input.inputs);

      return {
        ref,
        execute: async (context) => {
          const executionId = uuidv7();
          const startedAt = nowIso();
          insertExecution(deps.db, {
            id: executionId,
            projectId: target.projectId,
            repositoryId,
            kind: 'workflow_dispatch',
            context: 'remote',
            command: 'github:workflow_dispatch',
            args: [workflowPath, ref],
            cwd: null,
            status: 'running',
            exitCode: null,
            confirmedByUser: true,
            startedAt,
            finishedAt: null,
            durationMs: null,
            errorCode: null,
            errorMessage: null,
            logPath: null,
            sshHostId: null
          });
          linkExecutionToDeploy(deps.db, executionId, context.deployment.environmentId, target.id);
          context.update({ executionId });
          const settle = closing(context, executionId, startedAt);

          // Newest run of this workflow on this ref before the dispatch: whatever is created next is above it.
          let baseline = 0;
          try {
            const before = await deps.github.withToken(repo.projectId, (token) =>
              deps.api.listRuns(token, owner, name, {
                workflowId,
                page: 1,
                event: 'workflow_dispatch',
                branch: ref
              })
            );
            baseline = before.items.reduce((highest, run) => Math.max(highest, run.id), 0);
          } catch (error) {
            // Nothing was dispatched yet, so this is a plain failure.
            settle({
              status: 'failed',
              notes: error instanceof StewardServiceError ? error.message : 'Steward could not reach GitHub'
            });
            return;
          }

          // An answer from GitHub means the request was judged; no answer means it may still have gone through.
          let dispatchError: StewardServiceError | null = null;
          try {
            await deps.github.withToken(repo.projectId, (token) =>
              deps.api.dispatchWorkflow(token, owner, name, { workflowId, ref, inputs })
            );
          } catch (error) {
            dispatchError =
              error instanceof StewardServiceError
                ? error
                : new StewardServiceError('GITHUB_UNREACHABLE', 'Steward could not reach GitHub');
          }

          // GitHub refusing the dispatch (permission, invalid input, a missing workflow) means nothing was started.
          if (dispatchError !== null && !isAmbiguousDispatchError(dispatchError)) {
            settle({ status: 'failed', notes: dispatchError.message });
            return;
          }

          // Look for the run the dispatch created. After an ambiguous error the search is short.
          const deadline = Date.now() + (dispatchError === null ? FIND_TIMEOUT_MS : FIND_AFTER_ERROR_MS);
          let found: GithubRun | null = null;
          let crowded = false;
          while (found === null && !crowded && Date.now() < deadline) {
            await sleep(FIND_INTERVAL_MS);
            let page: Awaited<ReturnType<GithubApi['listRuns']>> | null = null;
            try {
              page = await deps.github.withToken(repo.projectId, (token) =>
                deps.api.listRuns(token, owner, name, {
                  workflowId,
                  page: 1,
                  event: 'workflow_dispatch',
                  branch: ref
                })
              );
            } catch {
              // A failed read is retried until the deadline.
            }
            if (page === null) continue;

            // Runs another deployment already follows are not candidates. Choosing and claiming happen in
            // one synchronous step, so two deployments of the same workflow cannot take the same run.
            const candidates = page.items.filter((run) => run.id > baseline && !isRunClaimed(deps.db, run.id));
            const [only] = candidates;
            if (candidates.length > 1) {
              crowded = true;
            } else if (only !== undefined) {
              context.update({ status: 'in_progress', runId: only.id, runUrl: only.url, commitSha: only.sha });
              found = only;
            }
          }

          if (crowded) {
            settle({
              status: 'unknown',
              notes:
                'More than one new run of this workflow appeared on that branch, so Steward cannot tell which one is this deployment. Check the Actions tab on GitHub.'
            });
            return;
          }
          if (found === null) {
            settle({
              status: 'unknown',
              notes:
                dispatchError === null
                  ? 'Steward could not find the run that GitHub should have started. Check the Actions tab on GitHub.'
                  : `GitHub did not confirm the dispatch (${dispatchError.message}) and no run appeared. Check the Actions tab on GitHub.`
            });
            return;
          }

          await watchRun(deps, repo, found.id, Date.parse(startedAt), settle);
        }
      };
    },

    resume: async (deployment, context) => {
      const startedAt = deployment.requestedAt;
      const settle = closing(context, deployment.executionId, startedAt);
      if (deployment.runId === null || deployment.repositoryId === null) {
        settle({ status: 'unknown', notes: 'Steward closed before the run could be followed. Check it on GitHub.' });
        return;
      }
      let repo: RepoRef;
      try {
        const { owner, name } = resolveGithubRepo(deps.db, {
          projectId: deployment.projectId,
          repositoryId: deployment.repositoryId
        });
        repo = { projectId: deployment.projectId, owner, name };
      } catch {
        settle({ status: 'unknown', notes: 'The repository was removed while the run was in progress. Check it on GitHub.' });
        return;
      }
      await watchRun(deps, repo, deployment.runId, Date.parse(startedAt), settle);
    }
  };
}

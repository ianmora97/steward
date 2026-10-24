import type { GithubHealth, GithubRun } from '@shared/schemas/github';

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
const PASSED = new Set(['success']);

/**
 * Operational health from recent runs (newest first), separate from whether the
 * token works. Only completed runs that clearly passed or failed count:
 * cancelled, skipped, neutral, stale or action-required say nothing about
 * whether the workflow is healthy, and unknown values are ignored the same way.
 */
export function computeHealth(runs: readonly GithubRun[]): GithubHealth {
  const latestByWorkflow = new Map<number, GithubRun>();
  let latest: GithubRun | null = null;

  for (const run of runs) {
    if (run.status !== 'completed' || run.conclusion === null) continue;
    if (!FAILED.has(run.conclusion) && !PASSED.has(run.conclusion)) continue;
    latest ??= run;
    if (!latestByWorkflow.has(run.workflowId)) latestByWorkflow.set(run.workflowId, run);
  }

  const failingWorkflows: string[] = [];
  for (const run of latestByWorkflow.values()) {
    if (run.conclusion !== null && FAILED.has(run.conclusion) && !failingWorkflows.includes(run.workflowName)) {
      failingWorkflows.push(run.workflowName);
    }
  }

  let status: GithubHealth['status'] = 'healthy';
  if (latest === null) status = 'unknown';
  else if (latest.conclusion !== null && FAILED.has(latest.conclusion)) status = 'failing';
  else if (failingWorkflows.length > 0) status = 'degraded';

  return { status, basedOnRuns: runs.length, failingWorkflows };
}

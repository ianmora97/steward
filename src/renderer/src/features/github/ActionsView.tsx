import { useState } from 'react';
import type { GithubJob } from '@shared/schemas/github';
import { useGithubStore } from '../../stores/github.store';
import { JobLogModal } from './JobLogModal';
import { RunList } from './RunList';
import './actions.css';

export function ActionsView({ projectId }: { projectId: string }): React.JSX.Element {
  const workflows = useGithubStore((state) => state.workflows);
  const workflowId = useGithubStore((state) => state.workflowId);
  const runs = useGithubStore((state) => state.runs);
  const runsHasNext = useGithubStore((state) => state.runsHasNext);
  const health = useGithubStore((state) => state.health);
  const jobsByRun = useGithubStore((state) => state.jobsByRun);
  const loadingRuns = useGithubStore((state) => state.loadingRuns);
  const errorCode = useGithubStore((state) => state.error?.code ?? null);
  const setWorkflow = useGithubStore((state) => state.setWorkflow);
  const loadMoreRuns = useGithubStore((state) => state.loadMoreRuns);
  const refreshActions = useGithubStore((state) => state.refreshActions);
  const loadJobs = useGithubStore((state) => state.loadJobs);
  const openUrl = useGithubStore((state) => state.openUrl);
  const [logJob, setLogJob] = useState<GithubJob | null>(null);

  const healthStatus = health?.status ?? 'unknown';
  const permissionHint = errorCode === 'GITHUB_FAILED' || errorCode === 'GITHUB_NOT_FOUND';
  const noWorkflows = workflows.length === 0 && runs.length === 0 && !loadingRuns;

  return (
    <div className="ghactions">
      <div className="ghactions__status">
        <span className="chip ghchip ghchip--success">Connection: connected</span>
        <span className={`chip ghchip ghchip--${healthTone(healthStatus)}`}>Workflows: {healthStatus}</span>
        {health !== null && (
          <span className="ghpull__meta">
            based on the latest {health.basedOnRuns} runs
            {health.failingWorkflows.length > 0 ? ` · failing: ${health.failingWorkflows.join(', ')}` : ''}
          </span>
        )}
        <button
          type="button"
          className="button button--small ghactions__refresh"
          disabled={loadingRuns}
          onClick={() => void refreshActions(projectId)}
        >
          Refresh
        </button>
      </div>

      <select
        className="field__input ghactions__filter"
        aria-label="Workflow"
        value={workflowId ?? ''}
        onChange={(event) => void setWorkflow(projectId, event.target.value === '' ? null : Number(event.target.value))}
      >
        <option value="">All workflows</option>
        {workflows.map((workflow) => (
          <option key={workflow.id} value={workflow.id}>
            {workflow.name}
            {workflow.state === 'active' ? '' : ' (disabled)'}
          </option>
        ))}
      </select>

      {permissionHint && (
        <p className="card__hint">Fine-grained tokens need Actions: Read; classic tokens need repo.</p>
      )}

      {noWorkflows ? (
        <p className="card__hint">This repository has no workflows.</p>
      ) : (
        <RunList
          runs={runs}
          hasNext={runsHasNext}
          loading={loadingRuns}
          jobsByRun={jobsByRun}
          onLoadMore={() => void loadMoreRuns(projectId)}
          onExpand={(runId) => void loadJobs(projectId, runId)}
          onViewLog={setLogJob}
          onOpen={(url) => void openUrl(url)}
        />
      )}

      {logJob !== null && (
        <JobLogModal
          projectId={projectId}
          jobId={logJob.id}
          jobName={logJob.name}
          jobUrl={logJob.url}
          onClose={() => setLogJob(null)}
        />
      )}
    </div>
  );
}

function healthTone(status: 'unknown' | 'healthy' | 'degraded' | 'failing'): string {
  switch (status) {
    case 'healthy':
      return 'success';
    case 'failing':
      return 'failure';
    case 'degraded':
      return 'running';
    default:
      return 'neutral';
  }
}

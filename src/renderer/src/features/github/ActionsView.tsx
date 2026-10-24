import { useState } from 'react';
import type { GithubJob } from '@shared/schemas/github';
import { Pill } from '../../components/Pill';
import { useGithubStore } from '../../stores/github.store';
import { JobLogModal } from './JobLogModal';
import { RunList } from './RunList';
import { healthPill } from './run-format';
import './actions.css';

export function ActionsView({ projectId }: { projectId: string }): React.JSX.Element {
  const workflows = useGithubStore((state) => state.workflows);
  const runs = useGithubStore((state) => state.runs);
  const runsHasNext = useGithubStore((state) => state.runsHasNext);
  const health = useGithubStore((state) => state.health);
  const jobsByRun = useGithubStore((state) => state.jobsByRun);
  const loadingRuns = useGithubStore((state) => state.loadingRuns);
  const errorCode = useGithubStore((state) => state.error?.code ?? null);
  const loadMoreRuns = useGithubStore((state) => state.loadMoreRuns);
  const loadJobs = useGithubStore((state) => state.loadJobs);
  const openUrl = useGithubStore((state) => state.openUrl);
  const [logJob, setLogJob] = useState<GithubJob | null>(null);

  const workflowsHealth = healthPill(health?.status ?? 'unknown');
  const permissionHint = errorCode === 'GITHUB_FAILED' || errorCode === 'GITHUB_NOT_FOUND';
  const noWorkflows = workflows.length === 0 && runs.length === 0 && !loadingRuns;

  return (
    <div className="ghactions">
      <div className="ghactions__status">
        <Pill tone="success" icon="checkCircle">
          Connected
        </Pill>
        <Pill tone={workflowsHealth.tone} icon={workflowsHealth.icon}>
          Workflows {workflowsHealth.label.toLowerCase()}
        </Pill>
        {health !== null && (
          <span className="ghmeta__item">
            latest {health.basedOnRuns} runs
            {health.failingWorkflows.length > 0 ? ` · failing: ${health.failingWorkflows.join(', ')}` : ''}
          </span>
        )}
      </div>

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

import { useCallback, useEffect, useState } from 'react';
import type { Deployment, DeploymentLog } from '@shared/schemas/deployments';
import type { GithubJob, GithubJobLog } from '@shared/schemas/github';
import type { StewardError, StewardResult } from '@shared/types/result';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Badge } from '../../components/Badge';
import { useAppStore } from '../../stores/app.store';
import { JobLogModal } from '../github/JobLogModal';
import { RunDetail } from '../github/RunDetail';
import { agoLabel, deploymentBadge, deploymentDuration, sourceLabel, UNKNOWN_HINT } from './deployment-meta';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';

/** The output of a command deploy. Always plain text, never interpreted as HTML. */
function DeploymentLogView({ deployment }: { deployment: Deployment }): React.JSX.Element {
  const [log, setLog] = useState<DeploymentLog | StewardError | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.steward.deployments.log({ id: deployment.id }).then((result) => {
      if (!cancelled) setLog(result.success ? result.data : result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [deployment.id]);

  if (log === null) return <Loading variant="line" lines={4} label="Loading output…" />;
  if ('code' in log) return <p className="card__hint">{log.message}</p>;
  if (log.text.trim() === '') return <p className="card__hint">No output was recorded.</p>;
  return (
    <>
      {log.truncated && <p className="card__hint">Only the end of the output is shown.</p>}
      <pre className="dplog">{log.text}</pre>
    </>
  );
}

/** A workflow deploy's jobs, steps and logs, read from GitHub: that is where its output lives. */
function RunJobs({ projectId, deployment }: { projectId: string; deployment: Deployment }): React.JSX.Element | null {
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const { repositoryId, runId, runUrl } = deployment;
  const [jobs, setJobs] = useState<GithubJob[] | undefined>(undefined);
  const [error, setError] = useState<StewardError | null>(null);
  const [logJob, setLogJob] = useState<GithubJob | null>(null);

  useEffect(() => {
    if (repositoryId === null || runId === null) return;
    let cancelled = false;
    void window.steward.github.listJobs({ projectId, repositoryId, runId }).then((result) => {
      if (cancelled) return;
      if (result.success) setJobs(result.data);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, repositoryId, runId]);

  const openUrl = useCallback((url: string): void => {
    void window.steward.github.openUrl({ url });
  }, []);
  const loadLog = useCallback(
    (jobId: number) =>
      repositoryId === null
        ? Promise.resolve<StewardResult<GithubJobLog>>({
            success: false,
            error: { code: 'NOT_FOUND', message: 'that repository no longer exists' }
          })
        : window.steward.github.getJobLog({ projectId, repositoryId, jobId }),
    [projectId, repositoryId]
  );

  if (runUrl === null || runId === null) {
    return (
      <div className="dphint">
        <p className="card__hint">GitHub never showed a run for this deployment.</p>
        <Button size="sm" onClick={() => setActiveTab('github')}>
          Open the GitHub tab
        </Button>
      </div>
    );
  }

  return (
    <>
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      <RunDetail jobs={error === null ? jobs : []} runUrl={runUrl} onViewLog={setLogJob} onOpen={openUrl} />
      {logJob !== null && (
        <JobLogModal
          projectId={projectId}
          jobId={logJob.id}
          jobName={logJob.name}
          jobUrl={logJob.url}
          onClose={() => setLogJob(null)}
          loadLog={loadLog}
          onOpenUrl={openUrl}
        />
      )}
    </>
  );
}

function DeploymentDetail({ projectId, deployment }: { projectId: string; deployment: Deployment }): React.JSX.Element {
  return (
    <div className="dpdetail">
      {deployment.status === 'unknown' && <p className="dpdetail__unknown">{UNKNOWN_HINT}</p>}
      {deployment.notes !== null && <p className="dpdetail__notes">{deployment.notes}</p>}
      {deployment.targetKind === 'ssh_command' && deployment.executionId !== null && (
        <DeploymentLogView deployment={deployment} />
      )}
      {deployment.targetKind === 'github_workflow_dispatch' && deployment.status !== 'requested' && (
        <RunJobs projectId={projectId} deployment={deployment} />
      )}
    </div>
  );
}

export function HistoryView({
  projectId,
  deployments,
  now
}: {
  projectId: string;
  deployments: Deployment[];
  now: number;
}): React.JSX.Element {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (deployments.length === 0) {
    return (
      <EmptyState
        title="Nothing deployed yet"
        description="Deployments you start from the Targets view show up here with their outcome."
      />
    );
  }

  return (
    <ul className="dplist">
      {deployments.map((deployment) => {
        const badge = deploymentBadge(deployment.status);
        const source = sourceLabel(deployment.statusSource);
        const duration = deploymentDuration(deployment);
        const open = expandedId === deployment.id;
        return (
          <li key={deployment.id} className="dphistory">
            <button
              type="button"
              className="dphistory__row"
              aria-expanded={open}
              onClick={() => setExpandedId(open ? null : deployment.id)}
            >
              <Badge tone={badge.tone} icon={badge.icon}>
                {badge.label}
              </Badge>
              <span className="dphistory__target">{deployment.targetName}</span>
              <span className="dphistory__meta">{deployment.environmentName}</span>
              {deployment.ref !== null && <span className="dphistory__meta dpmono">{deployment.ref}</span>}
              <span className="dpitem__spacer" />
              {source !== null && <span className="dphistory__meta">{source}</span>}
              {duration !== '' && <span className="dphistory__meta">{duration}</span>}
              <span className="dphistory__meta">{agoLabel(deployment.requestedAt, now)}</span>
            </button>
            {open && (
              <DeploymentDetail
                key={`${deployment.id}:${deployment.status}`}
                projectId={projectId}
                deployment={deployment}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

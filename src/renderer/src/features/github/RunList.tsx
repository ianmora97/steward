import { useState } from 'react';
import type { GithubJob, GithubRun } from '@shared/schemas/github';
import { Icon } from '../../components/Icon';
import { Badge } from '../../components/Badge';
import { RunDetail } from './RunDetail';
import { formatDuration, formatWhen, runBadge, shortSha, timeAgo } from './run-format';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';

export function RunList({
  runs,
  hasNext,
  loading,
  jobsByRun,
  onLoadMore,
  onExpand,
  onViewLog,
  onOpen
}: {
  runs: GithubRun[];
  hasNext: boolean;
  loading: boolean;
  jobsByRun: Record<number, GithubJob[]>;
  onLoadMore: () => void;
  onExpand: (runId: number) => void;
  onViewLog: (job: GithubJob) => void;
  onOpen: (url: string) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (runs.length === 0) {
    return loading ? <Loading lines={4} label="Loading runs…" /> : <p className="card__hint">No workflow runs yet.</p>;
  }

  function toggle(runId: number): void {
    if (expanded === runId) {
      setExpanded(null);
      return;
    }
    setExpanded(runId);
    onExpand(runId);
  }

  return (
    <div className="ghpulls">
      <ul className="ghpulls__list">
        {runs.map((run) => {
          const badge = runBadge(run);
          const open = expanded === run.id;
          const duration = run.status === 'completed' ? formatDuration(run.startedAt ?? run.createdAt, run.updatedAt) : '';
          return (
            <li key={run.id} className="ghrun">
              <button type="button" className="ghitem ghrun__row" aria-expanded={open} onClick={() => toggle(run.id)}>
                <Badge tone={badge.tone} icon={badge.icon}>
                  {badge.label}
                </Badge>
                <span className="ghitem__main">
                  <span className="ghitem__title ghitem__title--static">
                    {run.title === '' ? run.workflowName : run.title}
                    <span className="ghitem__number">#{run.runNumber}</span>
                  </span>
                  <span className="ghmeta">
                    <span className="ghmeta__item ghmeta__item--strong">{run.workflowName}</span>
                    <span className="ghmeta__refs">
                      <Icon name="git" size={12} />
                      <code className="ghref">{run.branch ?? '—'}</code>
                    </span>
                    <span className="ghmeta__item">{run.event}</span>
                    <code className="ghmeta__sha">{shortSha(run.sha)}</code>
                    <span className="ghmeta__item">
                      <Icon name="user" size={12} />
                      {run.actor ?? 'unknown'}
                    </span>
                    <span className="ghmeta__item" title={formatWhen(run.createdAt)}>
                      <Icon name="clock" size={12} />
                      {timeAgo(run.createdAt)}
                    </span>
                  </span>
                </span>
                {duration !== '' && <span className="ghrun__duration">{duration}</span>}
                <span className={`ghrun__chevron${open ? ' is-open' : ''}`}>
                  <Icon name="chevronRight" size={14} />
                </span>
              </button>
              {open && (
                <RunDetail
                  jobs={jobsByRun[run.id]}
                  runUrl={run.url}
                  onViewLog={onViewLog}
                  onOpen={onOpen}
                />
              )}
            </li>
          );
        })}
      </ul>
      {hasNext && (
        <Button loading={loading} loadingLabel="Loading…" onClick={onLoadMore}>Load more</Button>
      )}
    </div>
  );
}

import { useState } from 'react';
import type { GithubJob, GithubRun } from '@shared/schemas/github';
import { RunDetail } from './RunDetail';
import { formatDuration, formatWhen, runChip, shortSha } from './run-format';

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
    return <p className="card__hint">{loading ? 'Loading runs…' : 'No workflow runs yet.'}</p>;
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
          const chip = runChip(run);
          const open = expanded === run.id;
          const duration = run.status === 'completed' ? formatDuration(run.startedAt ?? run.createdAt, run.updatedAt) : '';
          return (
            <li key={run.id} className="ghrun">
              <button type="button" className="ghrun__row" aria-expanded={open} onClick={() => toggle(run.id)}>
                <span className={`chip ghchip ghchip--${chip.tone}`}>{chip.label}</span>
                <span className="ghrun__main">
                  <span className="ghrun__title">
                    {run.title === '' ? run.workflowName : run.title}
                    <span className="ghpull__number"> #{run.runNumber}</span>
                  </span>
                  <span className="ghpull__meta">
                    {run.workflowName} · {run.branch ?? '—'} · {run.event} · {shortSha(run.sha)} ·{' '}
                    {run.actor ?? 'unknown'} · {formatWhen(run.createdAt)}
                    {duration === '' ? '' : ` · ${duration}`}
                  </span>
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
        <button type="button" className="button" disabled={loading} onClick={onLoadMore}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

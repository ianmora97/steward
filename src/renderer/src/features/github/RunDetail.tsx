import type { GithubJob } from '@shared/schemas/github';
import { Icon } from '../../components/Icon';
import { Badge } from '../../components/Badge';
import { formatDuration, runBadge } from './run-format';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';

export function RunDetail({
  jobs,
  runUrl,
  onViewLog,
  onOpen
}: {
  /** Undefined while the jobs are still loading. */
  jobs: GithubJob[] | undefined;
  runUrl: string;
  onViewLog: (job: GithubJob) => void;
  onOpen: (url: string) => void;
}): React.JSX.Element {
  return (
    <div className="ghdetail">
      <div className="ghdetail__bar">
        <Button size="sm" className="ghbutton" onClick={() => onOpen(runUrl)}>
          <Icon name="external" size={13} /> Open run on GitHub
        </Button>
      </div>
      {jobs === undefined && <Loading variant="line" lines={3} label="Loading jobs…" />}
      {jobs?.length === 0 && <p className="card__hint">This run has no jobs.</p>}
      {jobs?.map((job) => {
        const badge = runBadge(job);
        return (
          <div key={job.id} className="ghjob">
            <div className="ghjob__head">
              <Badge tone={badge.tone} icon={badge.icon}>
                {badge.label}
              </Badge>
              <span className="ghjob__name">{job.name}</span>
              <span className="ghjob__time">{formatDuration(job.startedAt, job.completedAt)}</span>
              <Button size="sm" className="ghbutton" onClick={() => onViewLog(job)}>
                <Icon name="file" size={13} /> View log
              </Button>
            </div>
            {job.steps.length > 0 && (
              <ul className="ghsteps">
                {job.steps.map((step) => {
                  const stepChip = runBadge(step);
                  return (
                    <li key={step.number} className={`ghstep ghstep--${stepChip.tone}`}>
                      <span className="ghstep__icon" title={stepChip.label}>
                        <Icon name={stepChip.icon} size={14} />
                      </span>
                      <span className="ghstep__name">{step.name}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

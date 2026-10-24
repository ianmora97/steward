import type { GithubJob } from '@shared/schemas/github';
import { Icon } from '../../components/Icon';
import { Pill } from '../../components/Pill';
import { formatDuration, runChip } from './run-format';

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
        <button type="button" className="button button--small ghbutton" onClick={() => onOpen(runUrl)}>
          <Icon name="external" size={13} /> Open run on GitHub
        </button>
      </div>
      {jobs === undefined && <p className="card__hint">Loading jobs…</p>}
      {jobs?.length === 0 && <p className="card__hint">This run has no jobs.</p>}
      {jobs?.map((job) => {
        const chip = runChip(job);
        return (
          <div key={job.id} className="ghjob">
            <div className="ghjob__head">
              <Pill tone={chip.tone} icon={chip.icon}>
                {chip.label}
              </Pill>
              <span className="ghjob__name">{job.name}</span>
              <span className="ghjob__time">{formatDuration(job.startedAt, job.completedAt)}</span>
              <button type="button" className="button button--small ghbutton" onClick={() => onViewLog(job)}>
                <Icon name="file" size={13} /> View log
              </button>
            </div>
            {job.steps.length > 0 && (
              <ul className="ghsteps">
                {job.steps.map((step) => {
                  const stepChip = runChip(step);
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

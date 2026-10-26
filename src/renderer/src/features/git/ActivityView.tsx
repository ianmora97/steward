import { useGitStore } from '../../stores/git.store';
import { Badge } from '../../components/Badge';
import { EXECUTION_STATUS } from '../../components/execution-status';

/** What Steward ran for you, from the execution history. Reads are not listed; actions are. */
export function ActivityView(): React.JSX.Element {
  const executions = useGitStore((state) => state.executions);

  if (executions.length === 0) {
    return <p className="diff__placeholder">No Git actions have been run from Steward on this repository yet.</p>;
  }

  return (
    <ul className="activity">
      {executions.map((execution) => (
        <li key={execution.id} className={`activity__item activity__item--${execution.status}`}>
          <div className="activity__head">
            <code className="activity__command">
              {execution.command} {execution.args.join(' ')}
            </code>
            <Badge tone={EXECUTION_STATUS[execution.status].tone}>{EXECUTION_STATUS[execution.status].label}</Badge>
            {execution.confirmedByUser && (
              <Badge tone="info" icon="check">
                confirmed
              </Badge>
            )}
          </div>
          <p className="activity__meta">
            {new Date(execution.startedAt).toLocaleString()} · {execution.durationMs ?? '?'} ms ·{' '}
            {execution.context} · exit {execution.exitCode ?? '—'}
          </p>
          {execution.errorMessage !== null && <p className="activity__error">{execution.errorMessage}</p>}
        </li>
      ))}
    </ul>
  );
}

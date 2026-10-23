import { useGitStore } from '../../stores/git.store';

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
            <span className={`chip chip--${execution.status}`}>{execution.status.replace('_', ' ')}</span>
            {execution.confirmedByUser && <span className="chip chip--pinned">confirmed</span>}
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

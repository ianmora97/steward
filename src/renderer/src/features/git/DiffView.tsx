import type { GitDiff } from '@shared/schemas/git';
import { Icon } from '../../components/Icon';
import { Loading } from '../../components/Loading';

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
    return 'diff__line diff__line--meta';
  }
  if (line.startsWith('@@')) return 'diff__line diff__line--hunk';
  if (line.startsWith('+')) return 'diff__line diff__line--add';
  if (line.startsWith('-')) return 'diff__line diff__line--del';
  return 'diff__line';
}

/** Renders Git's own unified diff, line by line. Nothing is reinterpreted. */
export function DiffView({ diff, loading }: { diff: GitDiff | null; loading: boolean }): React.JSX.Element {
  if (diff === null) {
    return (
      <div className="diff__empty">
        {loading ? (
          <Loading variant="line" lines={4} label="Loading diff…" />
        ) : (
          <>
            <Icon name="git" size={18} />
            <span>Select a file to see its changes.</span>
          </>
        )}
      </div>
    );
  }
  if (diff.binary) {
    return <p className="diff__placeholder">Binary file — Git does not show a text diff for it.</p>;
  }
  if (diff.empty) {
    return <p className="diff__placeholder">No textual changes (a mode change or an empty file).</p>;
  }

  return (
    <div className="diff" role="region" aria-label={`Diff of ${diff.path}`}>
      <pre className="diff__code">
        {diff.text.split('\n').map((line, index) => (
          <span key={index} className={lineClass(line)}>
            {line === '' ? ' ' : line}
            {'\n'}
          </span>
        ))}
      </pre>
      {diff.truncated && <p className="diff__notice">This diff was cut off because it is very large.</p>}
    </div>
  );
}

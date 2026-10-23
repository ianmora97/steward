import type { CommitFile } from '@shared/schemas/graph';
import { useGitStore } from '../../stores/git.store';
import { DiffView } from './DiffView';

const STATUS_LETTER: Record<CommitFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T'
};

/** Metadata and changed files of the selected commit, with a per-file diff. */
export function CommitDetail(): React.JSX.Element {
  const detail = useGitStore((state) => state.commitDetail);
  const commitFile = useGitStore((state) => state.commitFile);
  const commitDiff = useGitStore((state) => state.commitDiff);
  const selectCommit = useGitStore((state) => state.selectCommit);
  const selectCommitFile = useGitStore((state) => state.selectCommitFile);

  if (detail === null) {
    return (
      <aside className="commitdetail">
        <p className="diff__placeholder">Loading commit…</p>
      </aside>
    );
  }

  const additions = detail.files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const deletions = detail.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);

  return (
    <aside className="commitdetail" aria-label="Commit details">
      <div className="commitdetail__info">
      <div className="commitdetail__head">
        <h3 className="commitdetail__subject">{detail.subject}</h3>
        <button type="button" className="button button--ghost button--small" onClick={() => void selectCommit(null)}>
          Close
        </button>
      </div>

      {detail.body !== '' && <pre className="commitdetail__body">{detail.body}</pre>}

      <dl className="commitdetail__meta">
        <div>
          <dt>Commit</dt>
          <dd>
            <code>{detail.sha}</code>
          </dd>
        </div>
        <div>
          <dt>{detail.parents.length > 1 ? 'Parents (merge)' : 'Parent'}</dt>
          <dd>
            {detail.parents.length === 0 ? (
              'none — root commit'
            ) : (
              detail.parents.map((parent) => (
                <button
                  key={parent}
                  type="button"
                  className="linkbutton"
                  onClick={() => void selectCommit(parent)}
                >
                  {parent.slice(0, 7)}
                </button>
              ))
            )}
          </dd>
        </div>
        <div>
          <dt>Author</dt>
          <dd>
            {detail.author} &lt;{detail.email}&gt; · {new Date(detail.authorDate).toLocaleString()}
          </dd>
        </div>
        {detail.committer !== detail.author && (
          <div>
            <dt>Committer</dt>
            <dd>
              {detail.committer} · {new Date(detail.commitDate).toLocaleString()}
            </dd>
          </div>
        )}
      </dl>

      <h4 className="filegroup__title">
        {detail.files.length} file{detail.files.length === 1 ? '' : 's'} changed ·{' '}
        <span className="stat--add">+{additions}</span> <span className="stat--del">−{deletions}</span>
        {detail.isMerge && ' · compared with the first parent'}
      </h4>

      <ul className="filelist">
        {detail.files.map((file) => (
          <li key={file.path} className={`file${commitFile === file.path ? ' file--active' : ''}`}>
            <button
              type="button"
              className="file__main"
              onClick={() => void selectCommitFile(file.path)}
              title={file.path}
            >
              <span className={`file__kind file__kind--${file.status}`} aria-label={file.status}>
                {STATUS_LETTER[file.status]}
              </span>
              <span className="file__path">
                {file.originalPath !== null && <span className="file__from">{file.originalPath} → </span>}
                {file.path}
              </span>
            </button>
            <span className="file__actions">
              {file.binary ? (
                <span className="stat--dim">binary</span>
              ) : (
                <>
                  <span className="stat--add">+{file.additions ?? 0}</span>
                  <span className="stat--del">−{file.deletions ?? 0}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      </div>

      <div className="commitdetail__diff">
        {commitFile !== null && <p className="changes__diff-title">{commitFile}</p>}
        <DiffView diff={commitFile === null ? null : commitDiff} loading={commitFile !== null} />
      </div>
    </aside>
  );
}

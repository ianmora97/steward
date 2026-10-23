import type { CommitFile } from '@shared/schemas/graph';
import { Icon } from '../../components/Icon';
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

/** Summary card of the selected commit, with its changed files in their own scrolling list below. */
export function CommitInfo(): React.JSX.Element {
  const detail = useGitStore((state) => state.commitDetail);
  const commitFile = useGitStore((state) => state.commitFile);
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
      <section className="commitcard">
        <div className="commitcard__head">
          <h3 className="commitcard__subject" title={detail.subject}>
            {detail.subject}
          </h3>
          <button
            type="button"
            className="iconbutton"
            onClick={() => void selectCommit(null)}
            aria-label="Close commit"
            title="Close"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {detail.body !== '' && <pre className="commitcard__body">{detail.body}</pre>}

        <div className="commitcard__meta">
          <span className="commitcard__author" title={`${detail.author} <${detail.email}>`}>
            {detail.author}
          </span>
          <span className="commitcard__dot">·</span>
          <span>{new Date(detail.authorDate).toLocaleDateString()}</span>
          <code className="commitcard__sha" title={detail.sha}>
            {detail.sha.slice(0, 7)}
          </code>
        </div>

        {detail.parents.length > 0 && (
          <div className="commitcard__meta">
            <span className="commitcard__label">{detail.parents.length > 1 ? 'Merges' : 'Parent'}</span>
            {detail.parents.map((parent) => (
              <button key={parent} type="button" className="linkbutton" onClick={() => void selectCommit(parent)}>
                {parent.slice(0, 7)}
              </button>
            ))}
          </div>
        )}

        <div className="commitcard__stats">
          <span>
            {detail.files.length} file{detail.files.length === 1 ? '' : 's'}
          </span>
          <span className="stat--add">+{additions}</span>
          <span className="stat--del">−{deletions}</span>
          {detail.isMerge && <span className="chip">vs first parent</span>}
        </div>
      </section>

      <ul className="filelist commitdetail__files">
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
    </aside>
  );
}

/** Diff of the file picked in the commit's file list; shown below the graph. */
export function CommitDiffPane(): React.JSX.Element {
  const commitFile = useGitStore((state) => state.commitFile);
  const commitDiff = useGitStore((state) => state.commitDiff);

  return (
    <div className="diffpane">
      {commitFile !== null && <p className="changes__diff-title">{commitFile}</p>}
      <DiffView diff={commitFile === null ? null : commitDiff} loading={commitFile !== null} />
    </div>
  );
}

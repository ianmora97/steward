import { useState } from 'react';
import type { GitFileChangeKind, GitFileEntry } from '@shared/schemas/git';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useGitStore } from '../../stores/git.store';
import { DiffView } from './DiffView';

const KIND_LETTER: Record<GitFileChangeKind, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  untracked: 'U',
  conflicted: '!'
};

function FileRow({
  file,
  kind,
  active,
  onSelect,
  children
}: {
  file: GitFileEntry;
  kind: GitFileChangeKind;
  active: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <li className={`file${active ? ' file--active' : ''}`}>
      <button type="button" className="file__main" onClick={onSelect} title={file.path}>
        <span className={`file__kind file__kind--${kind}`} aria-label={kind}>
          {KIND_LETTER[kind]}
        </span>
        <span className="file__path">
          {file.originalPath !== null && <span className="file__from">{file.originalPath} → </span>}
          {file.path}
        </span>
      </button>
      <span className="file__actions">{children}</span>
    </li>
  );
}

export function ChangesView(): React.JSX.Element {
  const status = useGitStore((state) => state.status);
  const selected = useGitStore((state) => state.selected);
  const busy = useGitStore((state) => state.busy);
  const selectFile = useGitStore((state) => state.selectFile);
  const stage = useGitStore((state) => state.stage);
  const unstage = useGitStore((state) => state.unstage);
  const discard = useGitStore((state) => state.discard);
  const commit = useGitStore((state) => state.commit);

  const [message, setMessage] = useState('');
  const [pendingDiscard, setPendingDiscard] = useState<GitFileEntry[] | null>(null);

  if (status === null) return <p className="diff__placeholder">Loading…</p>;

  const conflicted = status.files.filter((file) => file.conflicted);
  const staged = status.files.filter((file) => !file.conflicted && file.staged !== null);
  const unstaged = status.files.filter((file) => !file.conflicted && file.unstaged !== null);
  const canCommit = (staged.length > 0 || status.mergeInProgress) && conflicted.length === 0 && message.trim() !== '';

  async function submit(): Promise<void> {
    if (!canCommit) return;
    if (await commit(message.trim())) setMessage('');
  }

  return (
    <div className="changes">
      <div className="changes__lists">
        {conflicted.length > 0 && (
          <section className="filegroup">
            <h3 className="filegroup__title filegroup__title--danger">Conflicts ({conflicted.length})</h3>
            <p className="filegroup__hint">
              Edit these files to resolve the conflict markers, then stage them. Or abort the merge above.
            </p>
            <ul className="filelist">
              {conflicted.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  kind="conflicted"
                  active={selected?.path === file.path}
                  onSelect={() => void selectFile({ path: file.path, staged: false, untracked: false })}
                >
                  <button type="button" className="button button--small" disabled={busy} onClick={() => void stage([file.path])}>
                    Mark resolved
                  </button>
                </FileRow>
              ))}
            </ul>
          </section>
        )}

        <section className="filegroup">
          <div className="filegroup__head">
            <h3 className="filegroup__title">Staged ({staged.length})</h3>
            {staged.length > 0 && (
              <button
                type="button"
                className="button button--ghost button--small"
                disabled={busy}
                onClick={() => void unstage(staged.map((file) => file.path))}
              >
                Unstage all
              </button>
            )}
          </div>
          {staged.length === 0 ? (
            <p className="filegroup__hint">Nothing staged.</p>
          ) : (
            <ul className="filelist">
              {staged.map((file) => (
                <FileRow
                  key={`s-${file.path}`}
                  file={file}
                  kind={file.staged as GitFileChangeKind}
                  active={selected?.path === file.path && selected.staged}
                  onSelect={() => void selectFile({ path: file.path, staged: true, untracked: false })}
                >
                  <button type="button" className="button button--small" disabled={busy} onClick={() => void unstage([file.path])}>
                    Unstage
                  </button>
                </FileRow>
              ))}
            </ul>
          )}
        </section>

        <section className="filegroup">
          <div className="filegroup__head">
            <h3 className="filegroup__title">Changes ({unstaged.length})</h3>
            {unstaged.length > 0 && (
              <button
                type="button"
                className="button button--ghost button--small"
                disabled={busy}
                onClick={() => void stage(unstaged.map((file) => file.path))}
              >
                Stage all
              </button>
            )}
          </div>
          {unstaged.length === 0 ? (
            <p className="filegroup__hint">Working tree is clean.</p>
          ) : (
            <ul className="filelist">
              {unstaged.map((file) => (
                <FileRow
                  key={`u-${file.path}`}
                  file={file}
                  kind={file.unstaged as GitFileChangeKind}
                  active={selected?.path === file.path && !selected.staged}
                  onSelect={() =>
                    void selectFile({ path: file.path, staged: false, untracked: file.unstaged === 'untracked' })
                  }
                >
                  <button type="button" className="button button--small" disabled={busy} onClick={() => void stage([file.path])}>
                    Stage
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small button--danger-text"
                    disabled={busy}
                    onClick={() => setPendingDiscard([file])}
                  >
                    Discard
                  </button>
                </FileRow>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="commitbox">
        <label className="field__label" htmlFor="commit-message">
          Commit message
        </label>
        <textarea
          id="commit-message"
          className="field__input commitbox__input"
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void submit();
          }}
          placeholder={status.mergeInProgress ? 'Merge commit message' : 'Summarize what changed and why'}
        />
        <div className="row">
          <button
            type="button"
            className="button button--primary"
            disabled={busy || !canCommit}
            onClick={() => void submit()}
          >
            Commit {staged.length > 0 ? `${staged.length} file${staged.length === 1 ? '' : 's'}` : ''}
          </button>
          <span className="commitbox__hint">
            {conflicted.length > 0
              ? 'Resolve conflicts first'
              : staged.length === 0 && !status.mergeInProgress
                ? 'Stage changes to commit'
                : 'Ctrl+Enter'}
          </span>
        </div>
      </section>

      {pendingDiscard !== null && (
        <ConfirmDialog
          title="Discard changes?"
          confirmLabel="Discard permanently"
          onCancel={() => setPendingDiscard(null)}
          onConfirm={() => {
            const files = pendingDiscard;
            setPendingDiscard(null);
            void discard(files.map((file) => file.path));
          }}
        >
          <p>This cannot be undone. Git does not keep these changes anywhere else.</p>
          <ul className="dialog__list">
            {pendingDiscard.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code> —{' '}
                {file.unstaged === 'untracked' ? 'the untracked file will be deleted' : 'reverts to the last staged/committed version'}
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** The diff of the file selected in the working-tree lists; shown below the graph. */
export function WorkingDiff(): React.JSX.Element {
  const selected = useGitStore((state) => state.selected);
  const diff = useGitStore((state) => state.diff);
  const busy = useGitStore((state) => state.busy);

  return (
    <div className="diffpane">
      {selected !== null && (
        <p className="changes__diff-title">
          {selected.staged ? 'Staged' : 'Unstaged'} · {selected.path}
        </p>
      )}
      <DiffView diff={diff} loading={busy && selected !== null} />
    </div>
  );
}

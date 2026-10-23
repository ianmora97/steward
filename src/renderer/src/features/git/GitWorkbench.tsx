import { useState } from 'react';
import { useGitStore } from '../../stores/git.store';
import { BranchesView } from './BranchesView';
import { ChangesView } from './ChangesView';
import { CommitDetail } from './CommitDetail';
import { GraphView } from './GraphView';

/**
 * The whole everyday Git workflow in one view, in the manner of a Git client:
 * the commit graph on top, then either the working-tree changes or the selected
 * commit below it, and the branches in a sidebar on the right that can be
 * folded away.
 */
export function GitWorkbench(): React.JSX.Element {
  const selectedCommit = useGitStore((state) => state.selectedCommit);
  const branchCount = useGitStore((state) => state.branches?.branches.length ?? 0);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className={`workbench${sidebarOpen ? '' : ' workbench--collapsed'}`}>
      <div className="workbench__main">
        <section className="workbench__graph" aria-label="Commit graph">
          <GraphView />
        </section>
        <section className="workbench__lower" aria-label={selectedCommit === null ? 'Working changes' : 'Commit'}>
          {selectedCommit === null ? <ChangesView /> : <CommitDetail />}
        </section>
      </div>

      <aside className="workbench__side" aria-label="Branches">
        <button
          type="button"
          className="workbench__toggle"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
          title={sidebarOpen ? 'Hide branches' : 'Show branches'}
        >
          <span aria-hidden="true">{sidebarOpen ? '›' : '‹'}</span>
          <span className="workbench__toggle-label">
            Branches <span className="chip">{branchCount}</span>
          </span>
        </button>
        {sidebarOpen && (
          <div className="workbench__side-scroll">
            <BranchesView />
          </div>
        )}
      </aside>
    </div>
  );
}

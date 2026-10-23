import { useGitStore } from '../../stores/git.store';
import { ChangesView, WorkingDiff } from './ChangesView';
import { CommitDiffPane, CommitInfo } from './CommitDetail';
import { GraphView } from './GraphView';

/**
 * The everyday Git workflow in one view: the commit graph with the code diff
 * below it, and on the right the staging area (or, when a commit is selected,
 * that commit's details and files). Picking a file on the right shows its diff
 * under the graph.
 */
export function GitWorkbench(): React.JSX.Element {
  const selectedCommit = useGitStore((state) => state.selectedCommit);
  const showingCommit = selectedCommit !== null;
  // The diff area only exists once a file is picked, so the graph gets the whole height until then.
  const hasFile = useGitStore((state) =>
    state.selectedCommit !== null ? state.commitFile !== null : state.selected !== null
  );

  return (
    <div className="workbench">
      <div className="workbench__main">
        <section className="workbench__graph" aria-label="Commit graph">
          <GraphView />
        </section>
        {hasFile && (
          <section className="workbench__lower" aria-label="Code changes">
            {showingCommit ? <CommitDiffPane /> : <WorkingDiff />}
          </section>
        )}
      </div>

      <aside className="workbench__side" aria-label={showingCommit ? 'Commit' : 'Staging area'}>
        {showingCommit ? <CommitInfo /> : <ChangesView />}
      </aside>
    </div>
  );
}

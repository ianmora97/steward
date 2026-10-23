import { useState } from 'react';
import type { GitBranch } from '@shared/schemas/git';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useGitStore } from '../../stores/git.store';

function BranchRow({ branch }: { branch: GitBranch }): React.JSX.Element {
  const busy = useGitStore((state) => state.busy);
  const checkout = useGitStore((state) => state.checkout);
  const deleteBranch = useGitStore((state) => state.deleteBranch);
  const [confirmForce, setConfirmForce] = useState(false);

  async function remove(): Promise<void> {
    const deleted = await deleteBranch(branch.name, false);
    // A branch with unmerged commits is refused by Git; only then do we ask
    // whether to throw those commits away.
    if (!deleted && useGitStore.getState().error?.code === 'GIT_UNMERGED_BRANCH') {
      setConfirmForce(true);
    }
  }

  return (
    <li className={`branch${branch.current ? ' branch--current' : ''}`}>
      <div className="branch__main">
        <span className="branch__name">{branch.name}</span>
        {branch.current && <span className="chip chip--primary">current</span>}
        {branch.remote && <span className="chip">remote</span>}
        {branch.ahead > 0 && <span className="chip">↑{branch.ahead}</span>}
        {branch.behind > 0 && <span className="chip">↓{branch.behind}</span>}
        {branch.upstreamGone && <span className="chip chip--warn">upstream gone</span>}
        <span className="branch__sha">{branch.sha}</span>
      </div>
      <div className="branch__actions">
        {!branch.current && (
          <button
            type="button"
            className="button button--small"
            disabled={busy}
            onClick={() => void checkout(branch.name, branch.remote)}
          >
            {branch.remote ? 'Check out as local' : 'Check out'}
          </button>
        )}
        {!branch.current && !branch.remote && (
          <button
            type="button"
            className="button button--ghost button--small button--danger-text"
            disabled={busy}
            onClick={() => void remove()}
          >
            Delete
          </button>
        )}
      </div>

      {confirmForce && (
        <ConfirmDialog
          title={`Force delete "${branch.name}"?`}
          confirmLabel="Delete and lose commits"
          onCancel={() => setConfirmForce(false)}
          onConfirm={() => {
            setConfirmForce(false);
            void deleteBranch(branch.name, true);
          }}
        >
          <p>
            <code>{branch.name}</code> has commits that are not merged into any other branch. After deleting it,
            the only way to find them is the reflog.
          </p>
          <p>
            Tip commit: <code>{branch.sha}</code>
          </p>
        </ConfirmDialog>
      )}
    </li>
  );
}

export function BranchesView(): React.JSX.Element {
  const branches = useGitStore((state) => state.branches);
  const status = useGitStore((state) => state.status);
  const busy = useGitStore((state) => state.busy);
  const createBranch = useGitStore((state) => state.createBranch);

  const [name, setName] = useState('');
  const [checkout, setCheckout] = useState(true);

  if (branches === null) return <p className="diff__placeholder">Loading…</p>;

  const local = branches.branches.filter((branch) => !branch.remote);
  const remote = branches.branches.filter((branch) => branch.remote);
  const noCommits = status !== null && !status.hasCommits;

  async function create(): Promise<void> {
    if (name.trim() === '') return;
    if (await createBranch(name.trim(), checkout)) setName('');
  }

  return (
    <div className="branches">
      <section className="card">
        <h3 className="card__title">New branch</h3>
        <div className="row">
          <input
            className="field__input field__input--grow"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
            }}
            placeholder="feature/short-description"
            spellCheck={false}
            aria-label="New branch name"
          />
          <label className="check">
            <input type="checkbox" checked={checkout} onChange={(event) => setCheckout(event.target.checked)} />
            Check out
          </label>
          <button
            type="button"
            className="button button--primary"
            disabled={busy || name.trim() === '' || (noCommits && !checkout)}
            onClick={() => void create()}
          >
            Create
          </button>
        </div>
        <p className="card__hint branches__hint">
          {noCommits
            ? 'This repository has no commits yet, so a branch can only be created together with a checkout.'
            : 'The branch starts at the current commit. Names cannot contain spaces, "..", "~", "^" or ":".'}
        </p>
      </section>

      <section className="card">
        <h3 className="card__title">
          Local branches ({local.length}){branches.detached && ' · HEAD is detached'}
        </h3>
        {local.length === 0 ? (
          <p className="card__hint">
            {branches.current !== null
              ? `${branches.current} has no commits yet; it appears here after the first commit.`
              : 'No local branches.'}
          </p>
        ) : (
          <ul className="branchlist">
            {local.map((branch) => (
              <BranchRow key={branch.fullName} branch={branch} />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3 className="card__title">Remote branches ({remote.length})</h3>
        {remote.length === 0 ? (
          <p className="card__hint">None known. Fetch to look for remote branches.</p>
        ) : (
          <ul className="branchlist">
            {remote.map((branch) => (
              <BranchRow key={branch.fullName} branch={branch} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

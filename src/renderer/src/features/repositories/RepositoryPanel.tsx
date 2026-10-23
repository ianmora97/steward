import { useState } from 'react';
import type { RepositoryProbe } from '@shared/schemas/repository';
import { EmptyState } from '../../components/EmptyState';
import { useAppStore } from '../../stores/app.store';

/**
 * Binds local repositories to the project and shows what Git reports about a
 * folder before it is added. It is the whole Git tab until the project has a
 * repository, and the "Repositories" section afterwards.
 *
 * A folder is probed before it can be added, and the probe result is shown as-is.
 */
export function RepositoryPanel(): React.JSX.Element {
  const repositories = useAppStore((state) => state.repositories);
  const busy = useAppStore((state) => state.busy);
  const validatePath = useAppStore((state) => state.validatePath);
  const pickDirectory = useAppStore((state) => state.pickDirectory);
  const addRepository = useAppStore((state) => state.addRepository);
  const removeRepository = useAppStore((state) => state.removeRepository);

  const [candidatePath, setCandidatePath] = useState('');
  const [probe, setProbe] = useState<RepositoryProbe | null>(null);

  async function browse(): Promise<void> {
    const chosen = await pickDirectory();
    if (chosen === null) return;
    setCandidatePath(chosen);
    setProbe(await validatePath(chosen));
  }

  async function check(): Promise<void> {
    if (candidatePath.trim() === '') return;
    setProbe(await validatePath(candidatePath.trim()));
  }

  async function add(): Promise<void> {
    if (probe === null || !probe.isGitRepository) return;
    const added = await addRepository({ localPath: probe.workTreeRoot ?? probe.localPath });
    if (added) {
      setCandidatePath('');
      setProbe(null);
    }
  }

  return (
    <div className="panel">
      <section className="card">
        <h2 className="card__title">Add a repository</h2>
        <p className="card__hint">
          A project can hold several repositories — a web app, an API, infrastructure — so add them one at a
          time. Steward checks the folder with Git before recording anything.
        </p>

        <div className="row">
          <input
            className="field__input field__input--grow"
            value={candidatePath}
            onChange={(event) => {
              setCandidatePath(event.target.value);
              setProbe(null);
            }}
            placeholder="C:\path\to\repository"
            spellCheck={false}
          />
          <button type="button" className="button" onClick={() => void browse()} disabled={busy}>
            Browse…
          </button>
          <button
            type="button"
            className="button"
            onClick={() => void check()}
            disabled={busy || candidatePath.trim() === ''}
          >
            Check
          </button>
        </div>

        {probe !== null && (
          <div className={`probe${probe.isGitRepository ? ' probe--ok' : ' probe--bad'}`}>
            {probe.isGitRepository ? (
              <>
                <p className="probe__headline">Git repository confirmed</p>
                <dl className="probe__facts">
                  <div>
                    <dt>Work tree</dt>
                    <dd>{probe.workTreeRoot}</dd>
                  </div>
                  <div>
                    <dt>Branch</dt>
                    <dd>{probe.detachedHead ? 'detached HEAD' : (probe.currentBranch ?? 'no commits yet')}</dd>
                  </div>
                  <div>
                    <dt>Remote</dt>
                    <dd>
                      {probe.remoteUrl === null
                        ? 'none configured'
                        : `${probe.remoteName ?? 'remote'} · ${probe.remoteUrl}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Provider</dt>
                    <dd>{probe.provider}</dd>
                  </div>
                </dl>
                <button type="button" className="button button--primary" onClick={() => void add()} disabled={busy}>
                  Add to project
                </button>
              </>
            ) : (
              <>
                <p className="probe__headline">Not added</p>
                <p className="probe__reason">{probe.reason ?? 'that folder is not a Git repository'}</p>
              </>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">Repositories</h2>
        {repositories.length === 0 ? (
          <EmptyState
            title="No repositories yet"
            description="Add the project's first repository above to bind it to this project."
          />
        ) : (
          <ul className="repo-list">
            {repositories.map((repository) => (
              <li key={repository.id} className="repo-item">
                <div className="repo-item__head">
                  <span className="repo-item__name">{repository.name}</span>
                  <span className={`chip chip--${repository.role}`}>{repository.role}</span>
                  <span className="chip">{repository.provider}</span>
                </div>
                <p className="repo-item__path">{repository.localPath}</p>
                <p className="repo-item__meta">
                  {repository.defaultBranch ?? 'unknown branch'}
                  {repository.remoteUrl !== null && ` · ${repository.remoteUrl}`}
                </p>
                <button
                  type="button"
                  className="button button--ghost button--small"
                  onClick={() => void removeRepository(repository.id)}
                  disabled={busy}
                >
                  Remove from project
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card--muted">
        <h2 className="card__title">Coming next</h2>
        <p className="card__hint">
          The commit graph arrives in Milestone 3. Steward reads status, branches and history from the
          installed Git each time rather than caching its own copy.
        </p>
      </section>
    </div>
  );
}

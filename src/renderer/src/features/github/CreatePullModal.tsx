import { useEffect, useState } from 'react';
import type { GithubBranchList, GithubCreatedPull } from '@shared/schemas/github';
import type { StewardError } from '@shared/types/result';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Modal } from '../../components/Modal';
import { useGithubStore } from '../../stores/github.store';

type Step = 'edit' | 'confirm' | 'done';

/**
 * Creating a pull request publishes to GitHub, so the form ends in a review
 * step that restates exactly what will be sent. Cancelling at any point sends
 * nothing.
 */
export function CreatePullModal({
  projectId,
  repositoryId,
  repositoryName,
  onClose,
  onCreated
}: {
  projectId: string;
  repositoryId: string;
  repositoryName: string;
  onClose: () => void;
  onCreated: () => void;
}): React.JSX.Element {
  const createPull = useGithubStore((state) => state.createPull);
  const openUrl = useGithubStore((state) => state.openUrl);

  const [branches, setBranches] = useState<GithubBranchList | null>(null);
  const [base, setBase] = useState('');
  const [head, setHead] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [step, setStep] = useState<Step>('edit');
  const [created, setCreated] = useState<GithubCreatedPull | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<StewardError | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [remote, local] = await Promise.all([
        window.steward.github.listBranches({ projectId, repositoryId }),
        window.steward.git.listBranches({ repositoryId })
      ]);
      if (cancelled) return;
      if (!remote.success) {
        setError(remote.error);
        return;
      }
      setBranches(remote.data);
      setBase(remote.data.defaultBranch);
      const current = local.success ? local.data.current : null;
      if (current !== null && remote.data.names.includes(current)) setHead(current);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, repositoryId]);

  const sameBranch = base !== '' && base === head;
  const ready = title.trim().length > 0 && base !== '' && head !== '' && !sameBranch;

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const result = await createPull({ projectId, repositoryId, base, head, title, body, draft });
      if (result === null) {
        setError(useGithubStore.getState().error);
        setStep('edit');
        return;
      }
      setCreated(result);
      setStep('done');
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New pull request" onClose={onClose}>
      <div className="dialog__body ghcreate">
        {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

        {step === 'edit' && (
          <>
            <div className="ghcreate__branches">
              <label className="field">
                <span className="field__label">Base (merge into)</span>
                <select className="field__input" value={base} onChange={(event) => setBase(event.target.value)}>
                  {(branches?.names ?? []).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Head (your changes)</span>
                <select className="field__input" value={head} onChange={(event) => setHead(event.target.value)}>
                  <option value="">Choose a branch…</option>
                  {(branches?.names ?? []).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {sameBranch && <p className="card__hint">Base and head must be different branches.</p>}
            <p className="card__hint">
              Only branches already pushed to GitHub are listed. Push your branch from the Git tab first.
            </p>
            <label className="field">
              <span className="field__label">Title</span>
              <input
                className="field__input"
                value={title}
                maxLength={256}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Description</span>
              <textarea
                className="field__input ghcreate__body"
                rows={6}
                value={body}
                maxLength={65536}
                onChange={(event) => setBody(event.target.value)}
              />
            </label>
            <label className="ghcreate__draft">
              <input type="checkbox" checked={draft} onChange={(event) => setDraft(event.target.checked)} /> Create as
              draft
            </label>
          </>
        )}

        {step === 'confirm' && (
          <div className="ghcreate__summary">
            <p>This will publish a pull request on GitHub:</p>
            <ul>
              <li>
                Repository: <strong>{repositoryName}</strong>
              </li>
              <li>
                <strong>{head}</strong> → <strong>{base}</strong>
              </li>
              <li>
                Title: <strong>{title.trim()}</strong>
              </li>
              <li>{draft ? 'As a draft' : 'Ready for review'}</li>
            </ul>
          </div>
        )}

        {step === 'done' && created !== null && (
          <div className="ghcreate__summary">
            <p>
              Pull request <strong>#{created.number}</strong> created.
            </p>
          </div>
        )}
      </div>

      <div className="dialog__actions">
        {step === 'edit' && (
          <>
            <button type="button" className="button" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="button button--primary" disabled={!ready} onClick={() => setStep('confirm')}>
              Review
            </button>
          </>
        )}
        {step === 'confirm' && (
          <>
            <button type="button" className="button" disabled={submitting} onClick={() => setStep('edit')}>
              Back
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={submitting}
              onClick={() => void submit()}
            >
              {submitting ? 'Creating…' : 'Create pull request'}
            </button>
          </>
        )}
        {step === 'done' && created !== null && (
          <>
            <button type="button" className="button" onClick={() => void openUrl(created.url)}>
              Open on GitHub
            </button>
            <button type="button" className="button button--primary" onClick={onClose}>
              Close
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

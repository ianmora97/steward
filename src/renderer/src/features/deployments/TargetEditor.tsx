import { useEffect, useState } from 'react';
import { parseGithubRemote } from '@shared/github-remote';
import {
  SSH_TARGET_DEFAULT_TIMEOUT_SECONDS,
  type DeployTarget,
  type DeployTargetKind
} from '@shared/schemas/deploy-targets';
import type { Environment } from '@shared/schemas/environments';
import type { GithubBranchList, GithubWorkflow } from '@shared/schemas/github';
import type { Repository } from '@shared/schemas/repository';
import type { SshHost } from '@shared/schemas/ssh';
import type { StewardError } from '@shared/types/result';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Modal } from '../../components/Modal';
import { useAppStore } from '../../stores/app.store';

/** What GitHub told us about the chosen repository; only valid for the repository it was loaded for. */
interface RepoData {
  repositoryId: string;
  workflows: GithubWorkflow[];
  branches: GithubBranchList;
}

type RepoLoad = { repositoryId: string; data: RepoData } | { repositoryId: string; error: StewardError };

export function TargetEditor({
  projectId,
  target,
  environments,
  hosts,
  repositories,
  onSaved,
  onClose
}: {
  projectId: string;
  /** null = a new target. */
  target: DeployTarget | null;
  environments: Environment[];
  hosts: SshHost[];
  repositories: Repository[];
  onSaved: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const githubRepositories = repositories.filter((repository) => parseGithubRemote(repository.remoteUrl) !== null);

  const [kind, setKind] = useState<DeployTargetKind>(target?.kind ?? 'ssh_command');
  const [name, setName] = useState(target?.name ?? '');
  const [environmentId, setEnvironmentId] = useState(target?.environmentId ?? environments[0]?.id ?? '');
  const [requiresConfirmation, setRequiresConfirmation] = useState(target?.requiresConfirmation ?? true);

  const [sshHostId, setSshHostId] = useState(target?.kind === 'ssh_command' ? (target.sshHostId ?? '') : '');
  const [command, setCommand] = useState(target?.kind === 'ssh_command' ? target.config.command : '');
  const [remoteDir, setRemoteDir] = useState(target?.kind === 'ssh_command' ? (target.config.remoteDir ?? '') : '');
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    String(target?.kind === 'ssh_command' ? target.config.timeoutSeconds : SSH_TARGET_DEFAULT_TIMEOUT_SECONDS)
  );

  const [repositoryId, setRepositoryId] = useState(
    target?.kind === 'github_workflow_dispatch' ? (target.repositoryId ?? '') : ''
  );
  const [workflowId, setWorkflowId] = useState(
    target?.kind === 'github_workflow_dispatch' ? String(target.config.workflowId) : ''
  );
  const [defaultRef, setDefaultRef] = useState(
    target?.kind === 'github_workflow_dispatch' ? target.config.defaultRef : ''
  );
  const [repoLoad, setRepoLoad] = useState<RepoLoad | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<StewardError | null>(null);

  useEffect(() => {
    if (kind !== 'github_workflow_dispatch' || repositoryId === '') return;
    let cancelled = false;
    void (async () => {
      const [workflows, branches] = await Promise.all([
        window.steward.github.listWorkflows({ projectId, repositoryId }),
        window.steward.github.listBranches({ projectId, repositoryId })
      ]);
      if (cancelled) return;
      if (!workflows.success) setRepoLoad({ repositoryId, error: workflows.error });
      else if (!branches.success) setRepoLoad({ repositoryId, error: branches.error });
      else setRepoLoad({ repositoryId, data: { repositoryId, workflows: workflows.data, branches: branches.data } });
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, projectId, repositoryId]);

  const loaded = repoLoad !== null && repoLoad.repositoryId === repositoryId ? repoLoad : null;
  const repoData = loaded !== null && 'data' in loaded ? loaded.data : null;
  const repoError = loaded !== null && 'error' in loaded ? loaded.error : null;

  const environment = environments.find((candidate) => candidate.id === environmentId) ?? null;
  const confirmationForced = environment?.isProtected === true;
  const workflow = repoData?.workflows.find((candidate) => String(candidate.id) === workflowId) ?? null;

  function chooseRepository(next: string): void {
    setRepositoryId(next);
    setWorkflowId('');
    setDefaultRef('');
  }

  function chooseWorkflow(next: string): void {
    setWorkflowId(next);
    if (defaultRef === '' && repoData !== null) setDefaultRef(repoData.branches.defaultBranch);
  }

  async function save(): Promise<void> {
    setError(null);
    const base = {
      environmentId,
      name,
      requiresConfirmation: confirmationForced || requiresConfirmation
    };
    let body;
    if (kind === 'ssh_command') {
      body = {
        ...base,
        kind: 'ssh_command' as const,
        sshHostId,
        config: {
          command,
          remoteDir: remoteDir.trim() === '' ? null : remoteDir.trim(),
          timeoutSeconds: Number(timeoutSeconds)
        }
      };
    } else {
      if (workflow === null) {
        setError({ code: 'VALIDATION_FAILED', message: 'Choose the workflow to run' });
        return;
      }
      body = {
        ...base,
        kind: 'github_workflow_dispatch' as const,
        repositoryId,
        config: { workflowId: workflow.id, workflowPath: workflow.path, defaultRef }
      };
    }

    setSaving(true);
    const result =
      target === null
        ? await window.steward.deployTargets.create({ projectId, ...body })
        : await window.steward.deployTargets.update({ id: target.id, ...body });
    setSaving(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onSaved();
    onClose();
  }

  const ready =
    name.trim() !== '' &&
    environmentId !== '' &&
    (kind === 'ssh_command'
      ? sshHostId !== '' && command.trim() !== '' && Number.isInteger(Number(timeoutSeconds))
      : repositoryId !== '' && workflowId !== '' && defaultRef.trim() !== '');

  return (
    <Modal title={target === null ? 'New deploy target' : `Edit ${target.name}`} onClose={onClose}>
      <div className="dialog__body dpform">
        {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="field__input"
            value={name}
            maxLength={120}
            placeholder="API to production"
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <div className="dprow">
          <label className="field">
            <span className="field__label">Type</span>
            <select
              className="field__input"
              value={kind}
              disabled={target !== null}
              onChange={(event) => setKind(event.target.value as DeployTargetKind)}
            >
              <option value="ssh_command">Command over SSH</option>
              <option value="github_workflow_dispatch">GitHub workflow</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Environment</span>
            <select
              className="field__input"
              value={environmentId}
              onChange={(event) => setEnvironmentId(event.target.value)}
            >
              {environments.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {kind === 'ssh_command' ? (
          <>
            <label className="field">
              <span className="field__label">Server</span>
              <select className="field__input" value={sshHostId} onChange={(event) => setSshHostId(event.target.value)}>
                <option value="">Choose a server…</option>
                {hosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.name}
                    {host.environment === null ? '' : ` · ${host.environment}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Command</span>
              <textarea
                className="field__input dpmono"
                rows={4}
                value={command}
                placeholder="./deploy.sh"
                onChange={(event) => setCommand(event.target.value)}
              />
              <span className="card__hint">
                Runs on the server exactly as written. Do not put secrets in it: it is stored as plain text.
              </span>
            </label>
            <div className="dprow">
              <label className="field">
                <span className="field__label">Directory on the server (optional)</span>
                <input
                  className="field__input dpmono"
                  value={remoteDir}
                  placeholder="/srv/app"
                  onChange={(event) => setRemoteDir(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">Timeout (seconds)</span>
                <input
                  className="field__input"
                  inputMode="numeric"
                  value={timeoutSeconds}
                  onChange={(event) => setTimeoutSeconds(event.target.value)}
                />
              </label>
            </div>
          </>
        ) : (
          <>
            <label className="field">
              <span className="field__label">Repository</span>
              <select
                className="field__input"
                value={repositoryId}
                onChange={(event) => chooseRepository(event.target.value)}
              >
                <option value="">Choose a repository…</option>
                {githubRepositories.map((repository) => (
                  <option key={repository.id} value={repository.id}>
                    {repository.name}
                  </option>
                ))}
              </select>
              {githubRepositories.length === 0 && (
                <span className="card__hint">None of this project&apos;s repositories has a github.com remote.</span>
              )}
            </label>

            {repoError !== null && (
              <div className="dphint">
                <ErrorBanner error={repoError} onDismiss={() => setRepoLoad(null)} />
                {repoError.code === 'GITHUB_NOT_CONNECTED' && (
                  <button type="button" className="button" onClick={() => setActiveTab('github')}>
                    Open the GitHub tab to connect
                  </button>
                )}
              </div>
            )}

            {repositoryId !== '' && repoError === null && (
              <div className="dprow">
                <label className="field">
                  <span className="field__label">Workflow</span>
                  <select
                    className="field__input"
                    value={workflowId}
                    disabled={repoData === null}
                    onChange={(event) => chooseWorkflow(event.target.value)}
                  >
                    <option value="">{repoData === null ? 'Loading…' : 'Choose a workflow…'}</option>
                    {(repoData?.workflows ?? []).map((candidate) => (
                      <option key={candidate.id} value={String(candidate.id)}>
                        {candidate.name} ({candidate.path.replace('.github/workflows/', '')})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Default branch or tag</span>
                  <select
                    className="field__input"
                    value={defaultRef}
                    disabled={repoData === null}
                    onChange={(event) => setDefaultRef(event.target.value)}
                  >
                    <option value="">{repoData === null ? 'Loading…' : 'Choose a branch…'}</option>
                    {(repoData?.branches.names ?? []).map((branch) => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </>
        )}

        <label className="dpcheck">
          <input
            type="checkbox"
            checked={confirmationForced || requiresConfirmation}
            disabled={confirmationForced}
            onChange={(event) => setRequiresConfirmation(event.target.checked)}
          />
          <span>
            <strong>Ask for confirmation</strong>
            {confirmationForced ? ' — always on: this environment is protected.' : ' before every deploy.'}
          </span>
        </label>
      </div>
      <div className="dialog__actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={saving || !ready}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import type { DeployTarget } from '@shared/schemas/deploy-targets';
import type { Deployment, WorkflowInputSpec } from '@shared/schemas/deployments';
import type { Environment } from '@shared/schemas/environments';
import type { StewardError } from '@shared/types/result';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/Badge';
import { collectInputs, InputsForm, missingRequired } from './InputsForm';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';

/** The inputs a workflow declared at one ref, or why they could not be read. Only valid for that ref. */
type SpecsLoad = { ref: string; specs: WorkflowInputSpec[] } | { ref: string; error: StewardError };

/**
 * Deploying changes something real, so this restates exactly what will run and
 * where. A protected environment needs its name typed; the check is repeated in
 * main, so this form is only the courtesy of saying so before the request.
 */
export function DeployModal({
  projectId,
  target,
  environment,
  destination,
  onClose,
  onStarted
}: {
  projectId: string;
  target: DeployTarget;
  environment: Environment;
  destination: string;
  onClose: () => void;
  onStarted: (deployment: Deployment) => void;
}): React.JSX.Element {
  const [typedName, setTypedName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<StewardError | null>(null);

  // Workflow deploys only: which ref to run, and the inputs that workflow asks for at that ref.
  const dispatch = target.kind === 'github_workflow_dispatch' ? target : null;
  const [chosenRef, setChosenRef] = useState<string | null>(null);
  const ref = dispatch === null ? null : (chosenRef ?? dispatch.config.defaultRef);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [specsLoad, setSpecsLoad] = useState<SpecsLoad | null>(null);
  const [edited, setEdited] = useState<Record<string, string>>({});

  const repositoryId = dispatch?.repositoryId ?? null;
  const workflowPath = dispatch?.config.workflowPath ?? null;

  useEffect(() => {
    if (repositoryId === null) return;
    let cancelled = false;
    void window.steward.github.listBranches({ projectId, repositoryId }).then((result) => {
      if (cancelled) return;
      if (result.success) setBranches(result.data.names);
      // Without the list the default ref still works; the select just offers that one.
      else setBranches([]);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, repositoryId]);

  useEffect(() => {
    if (repositoryId === null || workflowPath === null || ref === null) return;
    let cancelled = false;
    void window.steward.deployments.workflowInputs({ projectId, repositoryId, workflowPath, ref }).then((result) => {
      if (cancelled) return;
      setSpecsLoad(result.success ? { ref, specs: result.data } : { ref, error: result.error });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, repositoryId, workflowPath, ref]);

  const currentLoad = specsLoad !== null && specsLoad.ref === ref ? specsLoad : null;
  const specs = currentLoad !== null && 'specs' in currentLoad ? currentLoad.specs : null;
  const specsError = currentLoad !== null && 'error' in currentLoad ? currentLoad.error : null;
  const refOptions = ref === null ? [] : [ref, ...(branches ?? []).filter((name) => name !== ref)];

  const needsName = environment.isProtected;
  const needsCheck = !needsName && target.requiresConfirmation;
  const confirmationOk = needsName ? typedName === environment.name : needsCheck ? confirmed : true;
  const inputsOk = dispatch === null || (specs !== null && missingRequired(specs, edited) === null);
  const ready = confirmationOk && inputsOk;

  async function start(): Promise<void> {
    setStarting(true);
    setError(null);
    const result = await window.steward.deployments.start({
      targetId: target.id,
      ref,
      inputs: specs === null ? {} : collectInputs(specs, edited),
      confirmed: confirmed || !target.requiresConfirmation,
      confirmation: needsName ? { environmentName: typedName } : null
    });
    setStarting(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onStarted(result.data);
    onClose();
  }

  return (
    <Modal title={`Deploy ${target.name}`} onClose={onClose}>
      <div className="dialog__body dpform">
        {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

        <dl className="dpsummary">
          <dt>Environment</dt>
          <dd>
            {environment.name}{' '}
            {environment.isProtected && (
              <Badge tone="warning" icon="shield">
                Protected
              </Badge>
            )}
          </dd>
          <dt>Target</dt>
          <dd>{target.name}</dd>
          <dt>{target.kind === 'ssh_command' ? 'Server' : 'Workflow'}</dt>
          <dd>{destination}</dd>
          {target.kind === 'ssh_command' && (
            <>
              {target.config.remoteDir !== null && (
                <>
                  <dt>Directory</dt>
                  <dd className="dpmono">{target.config.remoteDir}</dd>
                </>
              )}
              <dt>Command</dt>
              <dd>
                <pre className="dpcommand">{target.config.command}</pre>
              </dd>
              <dt>Timeout</dt>
              <dd>{target.config.timeoutSeconds} s</dd>
            </>
          )}
        </dl>

        {dispatch !== null && (
          <>
            <label className="field">
              <span className="field__label">Branch or tag to run</span>
              <select className="field__input" value={ref ?? ''} onChange={(event) => setChosenRef(event.target.value)}>
                {refOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            {specsError !== null && <ErrorBanner error={specsError} onDismiss={() => setSpecsLoad(null)} />}
            {specsError === null && specs === null && <Loading variant="line" lines={3} label="Reading the workflow’s inputs…" />}
            {specs !== null && specs.length === 0 && (
              <p className="card__hint">This workflow takes no inputs.</p>
            )}
            {specs !== null && specs.length > 0 && (
              <InputsForm
                specs={specs}
                edited={edited}
                onChange={(name, value) => setEdited((current) => ({ ...current, [name]: value }))}
              />
            )}
          </>
        )}

        {needsName && (
          <label className="field">
            <span className="field__label">
              Type <strong>{environment.name}</strong> to confirm
            </span>
            <input
              className="field__input"
              value={typedName}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTypedName(event.target.value)}
            />
          </label>
        )}
        {needsCheck && (
          <label className="dpcheck">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>
              I want to deploy {target.name} to {environment.name}.
            </span>
          </label>
        )}
      </div>
      <div className="dialog__actions">
        <Button onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" loading={starting} loadingLabel="Starting…" disabled={!ready || starting} onClick={() => void start()}>Deploy</Button>
      </div>
    </Modal>
  );
}

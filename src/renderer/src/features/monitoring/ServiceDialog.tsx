import { useEffect, useState } from 'react';
import type { Environment } from '@shared/schemas/environments';
import type { Repository } from '@shared/schemas/repository';
import type { SshHost } from '@shared/schemas/ssh';
import type { ObservabilityServiceEntry } from '@shared/schemas/observability';
import { fail, type StewardError } from '@shared/types/result';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useAction } from '../../components/useAction';

/** Empty text means "not set": the schema wants null, not an empty string. */
const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

export function ServiceDialog({
  projectId,
  existing,
  onClose,
  onSaved
}: {
  projectId: string;
  existing: ObservabilityServiceEntry | null;
  onClose: () => void;
  onSaved: (service: ObservabilityServiceEntry) => void;
}): React.JSX.Element {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [name, setName] = useState(existing?.name ?? '');
  const [environmentId, setEnvironmentId] = useState(existing?.environmentId ?? '');
  const [repositoryId, setRepositoryId] = useState(existing?.repositoryId ?? '');
  const [logSelector, setLogSelector] = useState(existing?.logSelector ?? '');
  const [metricMatcher, setMetricMatcher] = useState(existing?.metricMatcher ?? '');
  const [sshHostId, setSshHostId] = useState(existing?.sshHostId ?? '');
  const [dockerContainer, setDockerContainer] = useState(existing?.dockerContainer ?? '');
  const [problem, setProblem] = useState<StewardError | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.steward.environments.list({ projectId }),
      window.steward.repositories.list({ projectId }),
      window.steward.ssh.list({ projectId })
    ]).then(([environmentResult, repositoryResult, hostResult]) => {
      if (cancelled) return;
      if (environmentResult.success) setEnvironments(environmentResult.data);
      if (repositoryResult.success) setRepositories(repositoryResult.data);
      if (hostResult.success) setHosts(hostResult.data);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const save = useAction(
    async () => {
      if (name.trim() === '') return fail<ObservabilityServiceEntry>('VALIDATION_FAILED', 'Give the service a name.');
      const fields = {
        environmentId: environmentId === '' ? null : environmentId,
        name: name.trim(),
        repositoryId: repositoryId === '' ? null : repositoryId,
        logSelector: orNull(logSelector),
        metricMatcher: orNull(metricMatcher),
        sshHostId: sshHostId === '' ? null : sshHostId,
        // A container only makes sense on a server; main refuses one without it.
        dockerContainer: sshHostId === '' ? null : orNull(dockerContainer)
      };
      return existing === null
        ? window.steward.observability.createService({ projectId, ...fields })
        : window.steward.observability.updateService({ id: existing.id, ...fields });
    },
    { success: existing === null ? 'Service added' : 'Service saved', errorTarget: 'none' }
  );

  async function onSave(): Promise<void> {
    setProblem(null);
    const saved = await save.run();
    if (saved !== undefined) onSaved(saved);
  }

  const shown = problem ?? save.error;

  return (
    <Modal title={existing === null ? 'New service' : `Edit ${existing.name}`} onClose={onClose} className="mgconn">
      <div className="mgconn__body">
        <div className="mnrow">
          <Field label="Name" required>
            <input className="field__input" value={name} onChange={(event) => setName(event.target.value)} placeholder="api" autoFocus />
          </Field>
          <Field label="Environment">
            <select className="field__input" value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}>
              <option value="">Any</option>
              {environments.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Log selector (LogQL)" hint='How this service is found in Loki, such as {app="api", env="prod"}.'>
          <input className="field__input mnmono" value={logSelector} onChange={(event) => setLogSelector(event.target.value)} placeholder='{app="api"}' spellCheck={false} />
        </Field>
        <Field label="Metric matcher (PromQL)" hint='What goes between the braces of a metric, such as job="api". Without braces.'>
          <input className="field__input mnmono" value={metricMatcher} onChange={(event) => setMetricMatcher(event.target.value)} placeholder='job="api"' spellCheck={false} />
        </Field>

        <div className="mnrow">
          <Field label="Repository" hint="Where its code lives.">
            <select className="field__input" value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
              <option value="">None</option>
              {repositories.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Server" hint="The VPC server it runs on.">
            <select className="field__input" value={sshHostId} onChange={(event) => setSshHostId(event.target.value)}>
              <option value="">None</option>
              {hosts.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Docker container" hint="Its name on that server, to show whether it is running.">
          <input
            className="field__input mnmono"
            value={dockerContainer}
            onChange={(event) => setDockerContainer(event.target.value)}
            placeholder="api"
            spellCheck={false}
            disabled={sshHostId === ''}
          />
        </Field>

        {shown !== null && (
          <div className="banner banner--error" role="alert">
            <span className="banner__message">{shown.message}</span>
            {shown.details !== undefined && <span className="banner__details">{shown.details}</span>}
          </div>
        )}

        <div className="dialog__actions">
          <span className="dpitem__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.pending} loadingLabel="Saving…" disabled={name.trim() === ''} onClick={() => void onSave()}>
            {existing === null ? 'Save service' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import type { CreateDomainResult, DomainSummary } from '@shared/schemas/cloud';
import type { Environment } from '@shared/schemas/environments';
import type { Repository } from '@shared/schemas/repository';
import type { SshHost } from '@shared/schemas/ssh';
import { fail, ok } from '@shared/types/result';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useAction } from '../../components/useAction';
import { toast } from '../../stores/toast.store';

export function DomainDialog({
  projectId,
  existing,
  sshHostId = null,
  onClose,
  onSaved
}: {
  projectId: string;
  existing: DomainSummary | null;
  /** The server the domain is being added to, when it was asked for from that server's card. */
  sshHostId?: string | null;
  onClose: () => void;
  onSaved: (domain: DomainSummary) => void;
}): React.JSX.Element {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [hostname, setHostname] = useState(existing?.hostname ?? '');
  const [environmentId, setEnvironmentId] = useState(existing?.environmentId ?? '');
  const [repositoryId, setRepositoryId] = useState(existing?.repositoryId ?? '');
  const [serverId, setServerId] = useState(existing?.sshHostId ?? sshHostId ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [withDefaultChecks, setWithDefaultChecks] = useState(true);

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
      if (hostname.trim() === '') return fail<CreateDomainResult>('VALIDATION_FAILED', 'Type the domain name.');
      const fields = {
        hostname: hostname.trim(),
        environmentId: environmentId === '' ? null : environmentId,
        repositoryId: repositoryId === '' ? null : repositoryId,
        sshHostId: serverId === '' ? null : serverId,
        notes: notes.trim()
      };
      if (existing === null) return window.steward.cloud.createDomain({ projectId, ...fields, withDefaultChecks });
      const updated = await window.steward.cloud.updateDomain({ id: existing.id, ...fields });
      return updated.success ? ok<CreateDomainResult>({ domain: updated.data, checksCreated: false }) : updated;
    },
    { success: existing === null ? 'Domain added' : 'Domain saved', errorTarget: 'none' }
  );

  async function onSave(): Promise<void> {
    const saved = await save.run();
    if (saved === undefined) return;
    if (existing === null && withDefaultChecks && !saved.checksCreated) {
      toast.info('The domain was added without checks: the project already has 20 active checks. Switch one off to make room.');
    }
    onSaved(saved.domain);
  }

  return (
    <Modal title={existing === null ? 'Add a domain' : `Edit ${existing.hostname}`} onClose={onClose}>
      <div className="cdform">
        <Field label="Domain name" required hint="Only the name, such as app.example.com. No https://, path or port.">
          <input
            className="field__input cdmono"
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            placeholder="app.example.com"
            spellCheck={false}
            autoFocus
          />
        </Field>

        <Field label="Server" hint="The connection that serves it. Leave it on none for a CDN, a static site or another provider.">
          <select className="field__input" value={serverId} onChange={(event) => setServerId(event.target.value)}>
            <option value="">No server</option>
            {hosts.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
                {candidate.environment === null ? '' : ` · ${candidate.environment}`}
              </option>
            ))}
          </select>
        </Field>

        <div className="cdrow">
          <Field label="Environment" hint="Left on any, it follows the server's.">
            <select className="field__input" value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}>
              <option value="">Any</option>
              {environments.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </Field>
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
        </div>

        <Field label="Notes">
          <textarea className="field__input" rows={3} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </Field>

        {existing === null && (
          <label className="dpcheck">
            <input type="checkbox" checked={withDefaultChecks} onChange={(event) => setWithDefaultChecks(event.target.checked)} />
            <span>
              <strong>Add the recommended checks</strong> — DNS every 5 minutes, the certificate every hour and the HTTPS page every minute, while
              Steward is open.
            </span>
          </label>
        )}

        {save.error !== null && (
          <div className="banner banner--error" role="alert">
            <span className="banner__message">{save.error.message}</span>
            {save.error.details !== undefined && <span className="banner__details">{save.error.details}</span>}
          </div>
        )}

        <div className="dialog__actions">
          <span className="dpitem__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.pending} loadingLabel="Saving…" disabled={hostname.trim() === ''} onClick={() => void onSave()}>
            {existing === null ? 'Add domain' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

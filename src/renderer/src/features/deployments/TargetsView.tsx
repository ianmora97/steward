import { useState } from 'react';
import type { DeployTarget } from '@shared/schemas/deploy-targets';
import type { Deployment } from '@shared/schemas/deployments';
import type { Environment } from '@shared/schemas/environments';
import type { Repository } from '@shared/schemas/repository';
import type { SshHost } from '@shared/schemas/ssh';
import type { StewardError } from '@shared/types/result';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { Badge } from '../../components/Badge';
import { TargetEditor } from './TargetEditor';
import { agoLabel, deploymentBadge, isActive, targetDestination } from './deployment-meta';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { toast } from '../../stores/toast.store';

/** The latest deployment through a target, and the button that starts the next one. */
function TargetFooter({
  target,
  deployments,
  now,
  onDeploy
}: {
  target: DeployTarget;
  deployments: Deployment[];
  now: number;
  onDeploy: (target: DeployTarget) => void;
}): React.JSX.Element {
  const last = deployments.find((deployment) => deployment.deployTargetId === target.id) ?? null;
  const badge = last === null ? null : deploymentBadge(last.status);
  const busy = last !== null && isActive(last);
  return (
    <footer className="dptarget__foot">
      {last !== null && badge !== null ? (
        <span className="dptarget__last">
          <Badge tone={badge.tone} icon={badge.icon}>
            {badge.label}
          </Badge>
          <span className="card__hint">{agoLabel(last.requestedAt, now)}</span>
        </span>
      ) : (
        <span className="card__hint">Never deployed</span>
      )}
      <Button size="sm" loading={busy} loadingLabel="Deploying…" onClick={() => onDeploy(target)}>Deploy</Button>
    </footer>
  );
}

/** Deploy targets laid out in a column per environment, in the environments' own order. */
export function TargetsView({
  projectId,
  environments,
  targets,
  hosts,
  repositories,
  deployments,
  now,
  onDeploy,
  onChanged,
  onError,
  onGoToEnvironments
}: {
  projectId: string;
  environments: Environment[];
  targets: DeployTarget[];
  hosts: SshHost[];
  repositories: Repository[];
  /** Newest first. */
  deployments: Deployment[];
  now: number;
  onDeploy: (target: DeployTarget) => void;
  /** Reload the targets after any change. */
  onChanged: () => void;
  onError: (error: StewardError) => void;
  onGoToEnvironments: () => void;
}): React.JSX.Element {
  // `null` closes the editor, `'new'` opens it blank.
  const [editing, setEditing] = useState<DeployTarget | 'new' | null>(null);
  const [deleting, setDeleting] = useState<DeployTarget | null>(null);

  const hostsById = new Map(hosts.map((host) => [host.id, host]));
  const repositoriesById = new Map(repositories.map((repository) => [repository.id, repository]));

  async function remove(target: DeployTarget): Promise<void> {
    setDeleting(null);
    const result = await window.steward.deployTargets.remove({ id: target.id });
    if (!result.success) {
      onError(result.error);
      return;
    }
    toast.success('Target deleted');
    onChanged();
  }

  if (environments.length === 0) {
    return (
      <EmptyState
        title="Create an environment first"
        description="A deploy target belongs to an environment such as Production or Staging."
      >
        <Button variant="primary" onClick={onGoToEnvironments}>
          Go to Environments
        </Button>
      </EmptyState>
    );
  }

  return (
    <section className="dpsection">
      <div className="dpsection__bar">
        <p className="card__hint">What each environment can be deployed with: a command on a server, or a GitHub workflow.</p>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={14} /> Add target
        </Button>
      </div>

      <div className="dpcolumns">
        {environments.map((environment) => {
          const inEnvironment = targets.filter((target) => target.environmentId === environment.id);
          return (
            <div key={environment.id} className="dpcolumn">
              <h3 className="dpcolumn__title">
                {environment.name}
                {environment.isProtected && (
                  <Badge tone="warning" icon="shield">
                    Protected
                  </Badge>
                )}
              </h3>
              {inEnvironment.length === 0 && <p className="card__hint">No targets here yet.</p>}
              {inEnvironment.map((target) => (
                <article key={target.id} className={`dptarget${target.broken ? ' dptarget--broken' : ''}`}>
                  <header className="dptarget__head">
                    <Icon name={target.kind === 'ssh_command' ? 'ssh' : 'github'} size={16} />
                    <span className="dptarget__name">{target.name}</span>
                    {target.broken && (
                      <Badge tone="failure" icon="alert">
                        Broken
                      </Badge>
                    )}
                    <span className="dpitem__spacer" />
                    <IconButton icon="edit" label={`Edit ${target.name}`} onClick={() => setEditing(target)} />
                    <IconButton icon="trash" label={`Delete ${target.name}`} onClick={() => setDeleting(target)} />
                  </header>
                  <p className="dptarget__destination">{targetDestination(target, hostsById, repositoriesById)}</p>
                  {target.broken && (
                    <p className="card__hint">Edit it to point at an existing {target.kind === 'ssh_command' ? 'server' : 'repository'}.</p>
                  )}
                  {!target.broken && <TargetFooter target={target} deployments={deployments} now={now} onDeploy={onDeploy} />}
                </article>
              ))}
            </div>
          );
        })}
      </div>

      {editing !== null && (
        <TargetEditor
          projectId={projectId}
          target={editing === 'new' ? null : editing}
          environments={environments}
          hosts={hosts}
          repositories={repositories}
          onSaved={onChanged}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting !== null && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete target"
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        >
          <p>
            The target is removed from Steward. Nothing changes on the server or in GitHub, and the deployments already
            made through it stay in the history.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

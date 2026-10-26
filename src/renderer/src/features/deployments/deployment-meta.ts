import type { DeployTarget } from '@shared/schemas/deploy-targets';
import type { Deployment, DeploymentSource, DeploymentStatus } from '@shared/schemas/deployments';
import type { EnvironmentKind } from '@shared/schemas/environments';
import type { Repository } from '@shared/schemas/repository';
import type { SshHost } from '@shared/schemas/ssh';
import type { IconName } from '../../components/Icon';
import type { BadgeTone } from '../../components/Badge';
import { durationLabel, sinceLabel } from '../ssh/ssh-meta';

export const KIND_LABEL: Record<EnvironmentKind, string> = {
  development: 'Development',
  staging: 'Staging',
  production: 'Production',
  custom: 'Custom'
};

const STATUS_CHIP: Record<DeploymentStatus, { tone: BadgeTone; icon: IconName; label: string }> = {
  requested: { tone: 'neutral', icon: 'clock', label: 'Requested' },
  in_progress: { tone: 'running', icon: 'loader', label: 'In progress' },
  succeeded: { tone: 'success', icon: 'check', label: 'Succeeded' },
  failed: { tone: 'failure', icon: 'x', label: 'Failed' },
  cancelled: { tone: 'neutral', icon: 'x', label: 'Cancelled' },
  unknown: { tone: 'warning', icon: 'alert', label: 'Unknown' }
};

export function deploymentBadge(status: DeploymentStatus): { tone: BadgeTone; icon: IconName; label: string } {
  return STATUS_CHIP[status];
}

/** Said next to a finished deployment so the pill is never taken on trust. */
export function sourceLabel(source: DeploymentSource | null): string | null {
  if (source === null) return null;
  return source === 'exit_code' ? 'confirmed by exit code' : 'confirmed by GitHub';
}

export const UNKNOWN_HINT = "Steward can't confirm the result. Check the server or GitHub.";

export function isActive(deployment: Deployment): boolean {
  return deployment.status === 'requested' || deployment.status === 'in_progress';
}

export function agoLabel(iso: string, now: number): string {
  return `${sinceLabel(iso, now)} ago`;
}

export function deploymentDuration(deployment: Deployment): string {
  if (deployment.finishedAt === null) return '';
  return durationLabel(Date.parse(deployment.finishedAt) - Date.parse(deployment.requestedAt));
}

/** Where a target sends its deploys, in words. */
export function targetDestination(
  target: DeployTarget,
  hosts: ReadonlyMap<string, SshHost>,
  repositories: ReadonlyMap<string, Repository>
): string {
  if (target.kind === 'ssh_command') {
    if (target.sshHostId === null) return 'The server was deleted';
    return hosts.get(target.sshHostId)?.name ?? 'Unknown server';
  }
  if (target.repositoryId === null) return 'The repository was removed';
  const repository = repositories.get(target.repositoryId)?.name ?? 'Unknown repository';
  return `${repository} · ${target.config.workflowPath.replace('.github/workflows/', '')}`;
}

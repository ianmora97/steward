import type { OverviewProject } from '@shared/schemas/overview';
import type { TabKey } from '@shared/schemas/tabs';
import type { IconName } from '../../components/Icon';
import { Badge, type BadgeTone } from '../../components/Badge';

interface ServiceBadge {
  key: string;
  label: string;
  icon: IconName;
  tone: BadgeTone;
  title: string;
  /** Where a click goes: a tab, or the GitHub part of Git. */
  target: { tab: TabKey } | { git: 'pulls' };
}

function dataBadge(
  key: 'mongodb' | 'redis',
  label: string,
  icon: IconName,
  data: OverviewProject['mongodb']
): ServiceBadge | null {
  if (data.total === 0) return null;
  const allReadOnly = data.readOnly === data.total;
  return {
    key,
    label: `${label} (${data.total})${allReadOnly ? ' · read-only' : ''}`,
    icon,
    tone: data.connectedBefore > 0 ? 'success' : 'neutral',
    title: `${data.total} connection${data.total === 1 ? '' : 's'} · ${data.readOnly} read-only · ${data.connectedBefore} used before`,
    target: { tab: key }
  };
}

/** What a project has configured, as one row of badges. A service nobody configured has no badge. */
export function serviceBadges(project: OverviewProject): ServiceBadge[] {
  const badges: ServiceBadge[] = [];

  if (project.repositories > 0) {
    badges.push({
      key: 'repositories',
      label: `Repositories (${project.repositories})`,
      icon: 'repo',
      tone: 'neutral',
      title: 'Open Git',
      target: { tab: 'git' }
    });
  }

  if (project.github !== 'unconfigured' || project.githubRepositories > 0) {
    const tone: BadgeTone = project.github === 'connected' ? 'success' : project.github === 'auth_error' ? 'failure' : project.github === 'unreachable' ? 'warning' : 'neutral';
    const state = { connected: 'connected', auth_error: 'token rejected', unreachable: 'unreachable', unconfigured: 'not connected' }[project.github];
    badges.push({
      key: 'github',
      label: `GitHub · ${state}`,
      icon: 'github',
      tone,
      title: project.github === 'connected' ? 'Open pull requests and Actions' : 'Open GitHub in the Git tab',
      target: { git: 'pulls' }
    });
  }

  if (project.vpc.total > 0) {
    const { vpc } = project;
    const tone: BadgeTone = vpc.down > 0 ? 'failure' : vpc.attention > 0 ? 'warning' : vpc.reachable === vpc.total ? 'success' : 'neutral';
    badges.push({
      key: 'vpc',
      label: `VPC · ${vpc.reachable}/${vpc.total} reachable`,
      icon: 'ssh',
      tone,
      title: `${vpc.reachable} reachable · ${vpc.attention} need attention · ${vpc.down} unreachable · ${vpc.untested} not checked`,
      target: { tab: 'ssh' }
    });
  }

  if (project.deployTargets > 0) {
    badges.push({
      key: 'deployments',
      label: `Deployments (${project.deployTargets})`,
      icon: 'deployments',
      tone: 'neutral',
      title: 'Open deployments',
      target: { tab: 'deployments' }
    });
  }

  if (project.tabs.includes('docker')) {
    badges.push({ key: 'docker', label: 'Docker', icon: 'docker', tone: 'neutral', title: 'Open Docker', target: { tab: 'docker' } });
  }

  const mongodb = dataBadge('mongodb', 'MongoDB', 'mongodb', project.mongodb);
  if (mongodb !== null) badges.push(mongodb);
  const redis = dataBadge('redis', 'Redis', 'database', project.redis);
  if (redis !== null) badges.push(redis);

  return badges;
}

export function ServiceBadges({
  badges,
  onOpen
}: {
  badges: ServiceBadge[];
  onOpen: (target: ServiceBadge['target']) => void;
}): React.JSX.Element {
  return (
    <div className="svcbadges">
      {badges.map((badge) => (
        <button key={badge.key} type="button" className="svcbadge" title={badge.title} onClick={() => onOpen(badge.target)}>
          <Badge tone={badge.tone} icon={badge.icon}>
            {badge.label}
          </Badge>
        </button>
      ))}
    </div>
  );
}

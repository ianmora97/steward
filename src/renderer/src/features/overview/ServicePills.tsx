import type { OverviewProject } from '@shared/schemas/overview';
import type { TabKey } from '@shared/schemas/tabs';
import type { IconName } from '../../components/Icon';
import { Pill, type PillTone } from '../../components/Pill';

interface ServicePill {
  key: string;
  label: string;
  icon: IconName;
  tone: PillTone;
  title: string;
  /** Where a click goes: a tab, or the GitHub part of Git. */
  target: { tab: TabKey } | { git: 'pulls' };
}

function dataPill(
  key: 'mongodb' | 'redis',
  label: string,
  icon: IconName,
  data: OverviewProject['mongodb']
): ServicePill | null {
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

/** What a project has configured, as one row of pills. A service nobody configured has no pill. */
export function servicePills(project: OverviewProject): ServicePill[] {
  const pills: ServicePill[] = [];

  if (project.repositories > 0) {
    pills.push({
      key: 'repositories',
      label: `Repositories (${project.repositories})`,
      icon: 'repo',
      tone: 'neutral',
      title: 'Open Git',
      target: { tab: 'git' }
    });
  }

  if (project.github !== 'unconfigured' || project.githubRepositories > 0) {
    const tone: PillTone = project.github === 'connected' ? 'success' : project.github === 'auth_error' ? 'failure' : project.github === 'unreachable' ? 'warning' : 'neutral';
    const state = { connected: 'connected', auth_error: 'token rejected', unreachable: 'unreachable', unconfigured: 'not connected' }[project.github];
    pills.push({
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
    const tone: PillTone = vpc.down > 0 ? 'failure' : vpc.attention > 0 ? 'warning' : vpc.reachable === vpc.total ? 'success' : 'neutral';
    pills.push({
      key: 'vpc',
      label: `VPC · ${vpc.reachable}/${vpc.total} reachable`,
      icon: 'ssh',
      tone,
      title: `${vpc.reachable} reachable · ${vpc.attention} need attention · ${vpc.down} unreachable · ${vpc.untested} not checked`,
      target: { tab: 'ssh' }
    });
  }

  if (project.deployTargets > 0) {
    pills.push({
      key: 'deployments',
      label: `Deployments (${project.deployTargets})`,
      icon: 'deployments',
      tone: 'neutral',
      title: 'Open deployments',
      target: { tab: 'deployments' }
    });
  }

  if (project.tabs.includes('docker')) {
    pills.push({ key: 'docker', label: 'Docker', icon: 'docker', tone: 'neutral', title: 'Open Docker', target: { tab: 'docker' } });
  }

  const mongodb = dataPill('mongodb', 'MongoDB', 'mongodb', project.mongodb);
  if (mongodb !== null) pills.push(mongodb);
  const redis = dataPill('redis', 'Redis', 'database', project.redis);
  if (redis !== null) pills.push(redis);

  return pills;
}

export function ServicePills({
  pills,
  onOpen
}: {
  pills: ServicePill[];
  onOpen: (target: ServicePill['target']) => void;
}): React.JSX.Element {
  return (
    <div className="svcpills">
      {pills.map((pill) => (
        <button key={pill.key} type="button" className="svcpill" title={pill.title} onClick={() => onOpen(pill.target)}>
          <Pill tone={pill.tone} icon={pill.icon}>
            {pill.label}
          </Pill>
        </button>
      ))}
    </div>
  );
}

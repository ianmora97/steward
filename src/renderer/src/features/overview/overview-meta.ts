import type { TabKey } from '@shared/schemas/tabs';
import type { IconName } from '../../components/Icon';
import { EXECUTION_STATUS } from '../../components/execution-status';

/** Where an entry in the activity list belongs, so clicking it opens the right tab of its project. */
export const ACTIVITY_KIND: Record<string, { label: string; icon: IconName; tab: TabKey }> = {
  git_op: { label: 'Git', icon: 'git', tab: 'git' },
  ssh_command: { label: 'VPC', icon: 'ssh', tab: 'ssh' },
  docker_action: { label: 'Docker', icon: 'docker', tab: 'docker' },
  mongo_write: { label: 'MongoDB', icon: 'mongodb', tab: 'mongodb' },
  redis_write: { label: 'Redis', icon: 'database', tab: 'redis' },
  workflow_dispatch: { label: 'Deploy', icon: 'deployments', tab: 'deployments' }
};

export function activityKind(kind: string): { label: string; icon: IconName; tab: TabKey } {
  return ACTIVITY_KIND[kind] ?? { label: 'Activity', icon: 'pulse', tab: 'git' };
}

export const ACTIVITY_STATUS = EXECUTION_STATUS;

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60]
];

export function timeAgo(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

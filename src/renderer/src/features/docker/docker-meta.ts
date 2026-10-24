import type { DockerTarget } from '@shared/schemas/docker';
import type { IconName } from '../../components/Icon';
import type { PillTone } from '../../components/Pill';

export interface StateChip {
  tone: PillTone;
  icon: IconName;
  label: string;
}

/** Docker's own state word plus its status text ("Exited (1) 3 minutes ago", "Up 2 hours (unhealthy)"). */
export function containerChip(state: string, status: string): StateChip {
  switch (state) {
    case 'running':
      return /\(unhealthy\)/i.test(status)
        ? { tone: 'failure', icon: 'alert', label: 'Unhealthy' }
        : { tone: 'success', icon: 'checkCircle', label: 'Running' };
    case 'exited':
      return /^Exited \((?!0\))/i.test(status)
        ? { tone: 'failure', icon: 'xCircle', label: 'Exited with error' }
        : { tone: 'neutral', icon: 'minusCircle', label: 'Exited' };
    case 'paused':
      return { tone: 'warning', icon: 'minusCircle', label: 'Paused' };
    case 'restarting':
      return { tone: 'running', icon: 'loader', label: 'Restarting' };
    case 'created':
      return { tone: 'neutral', icon: 'minusCircle', label: 'Created' };
    case 'dead':
      return { tone: 'failure', icon: 'xCircle', label: 'Dead' };
    case 'removing':
      return { tone: 'warning', icon: 'loader', label: 'Removing' };
    default:
      return { tone: 'neutral', icon: 'minusCircle', label: state === '' ? 'Unknown' : state };
  }
}

/** The tab keeps its target while the project stays open; this is its stable key for effects. */
export function targetKey(target: DockerTarget): string {
  return target.kind === 'local' ? 'local' : `ssh:${target.sshHostId}`;
}

/** Default networks Docker will not let you remove. */
export const BUILTIN_NETWORKS: readonly string[] = ['bridge', 'host', 'none'];

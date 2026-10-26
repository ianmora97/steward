import { Icon, type IconName } from './Icon';

/** The colours and icons a project can take in Settings → General. Kept short so every pair reads well on the dark theme. */
export const PROJECT_COLORS = ['#2f6df0', '#3fb67f', '#a371f7', '#e0a93b', '#f2555a', '#22b8cf', '#e86aa4', '#8d9ab3'] as const;

export const PROJECT_ICONS: readonly IconName[] = ['folder', 'repo', 'git', 'terminal', 'deployments', 'docker', 'database', 'cloud', 'ssh', 'pulse'];

function isProjectIcon(name: string | null): name is IconName {
  return name !== null && (PROJECT_ICONS as readonly string[]).includes(name);
}

/** A project's mark: its icon on a tint of its colour. */
export function ProjectAvatar({
  icon,
  color,
  size = 28
}: {
  icon: string | null;
  color: string | null;
  size?: number;
}): React.JSX.Element {
  const tint = color ?? PROJECT_COLORS[0];
  return (
    <span
      className="projavatar"
      style={{ width: size, height: size, color: tint, background: `color-mix(in srgb, ${tint} 16%, transparent)`, borderColor: `color-mix(in srgb, ${tint} 40%, transparent)` }}
      aria-hidden="true"
    >
      <Icon name={isProjectIcon(icon) ? icon : 'folder'} size={Math.round(size * 0.55)} />
    </span>
  );
}

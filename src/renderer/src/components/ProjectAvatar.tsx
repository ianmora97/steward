import { Icon, type IconName } from './Icon';

/** The colours a project can take in Settings → General. The first is the default. */
export const PROJECT_COLORS = [
  { value: '#2f6df0', name: 'Blue' },
  { value: '#38a8e8', name: 'Sky' },
  { value: '#22b8cf', name: 'Cyan' },
  { value: '#14b8a6', name: 'Teal' },
  { value: '#5eead4', name: 'Mint' },
  { value: '#3fb67f', name: 'Green' },
  { value: '#84cc16', name: 'Lime' },
  { value: '#e8c63a', name: 'Yellow' },
  { value: '#e0a93b', name: 'Amber' },
  { value: '#d4af37', name: 'Gold' },
  { value: '#f0883e', name: 'Orange' },
  { value: '#ff7f6e', name: 'Coral' },
  { value: '#f2555a', name: 'Red' },
  { value: '#dc2646', name: 'Crimson' },
  { value: '#e86aa4', name: 'Pink' },
  { value: '#d946ef', name: 'Fuchsia' },
  { value: '#a371f7', name: 'Purple' },
  { value: '#7c5cff', name: 'Violet' },
  { value: '#5b6ef0', name: 'Indigo' },
  { value: '#3a56b0', name: 'Navy' },
  { value: '#a47551', name: 'Brown' },
  { value: '#8d9ab3', name: 'Slate' },
  { value: '#6b7280', name: 'Grey' },
  { value: '#cbd5e1', name: 'Silver' }
] as const;

export const DEFAULT_PROJECT_COLOR = PROJECT_COLORS[0].value;

export const PROJECT_ICONS: readonly IconName[] = [
  'folder', 'repo', 'git', 'gitCommit', 'terminal', 'code', 'braces', 'hash', 'bug', 'flask',
  'deployments', 'docker', 'box', 'layers', 'database', 'hardDrive', 'cpu', 'ssh', 'network', 'wifi',
  'cloud', 'globe', 'link', 'key', 'lock', 'shield', 'shieldCheck', 'bell', 'mail', 'chat',
  'send', 'download', 'archive', 'pulse', 'barChart', 'trendingUp', 'pie', 'target', 'flag', 'bookmark',
  'bookOpen', 'lightbulb', 'sparkles', 'zap', 'flame', 'star', 'heart', 'crown', 'trophy', 'users',
  'home', 'building', 'briefcase', 'wrench', 'cart', 'creditCard', 'dollar', 'monitor', 'smartphone', 'laptop',
  'image', 'video', 'music', 'compass', 'mapPin', 'plane', 'anchor', 'mountain', 'leaf', 'sun',
  'moon', 'droplet', 'waves', 'coffee', 'lifebuoy', 'infinity', 'power', 'eye', 'list', 'ghost',
  'smile', 'mongodb', 'github', 'tag', 'user', 'calendar', 'clock', 'file'
];

/** Text that stays readable on top of a project's colour: dark on the light ones, white on the rest. */
export function inkOn(color: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (match === null) return '#ffffff';
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => parseInt(part ?? '0', 16) / 255) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.62 ? '#0a0f1c' : '#ffffff';
}

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
  const tint = color ?? DEFAULT_PROJECT_COLOR;
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

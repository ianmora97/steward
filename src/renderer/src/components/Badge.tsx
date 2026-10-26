import { Icon, type IconName } from './Icon';

export type BadgeTone = 'success' | 'failure' | 'running' | 'warning' | 'merged' | 'info' | 'neutral';

/**
 * One badge for the whole app: a tone (colour), an icon and a short label.
 * Colour is never the only signal — the icon and the text say the same thing.
 */
export function Badge({
  tone,
  icon,
  size = 'md',
  title,
  children
}: {
  tone: BadgeTone;
  icon?: IconName;
  size?: 'sm' | 'md';
  title?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span className={`badge badge--${tone}${size === 'sm' ? ' badge--sm' : ''}`} title={title}>
      {icon !== undefined && <Icon name={icon} size={size === 'sm' ? 11 : 12} />}
      {children}
    </span>
  );
}

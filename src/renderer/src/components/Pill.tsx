import { Icon, type IconName } from './Icon';

export type PillTone = 'success' | 'failure' | 'running' | 'warning' | 'merged' | 'info' | 'neutral';

/**
 * One status pill for the whole app: a tone (colour), an icon and a short label.
 * Colour is never the only signal — the icon and the text say the same thing.
 */
export function Pill({
  tone,
  icon,
  children,
  title
}: {
  tone: PillTone;
  icon?: IconName;
  children: React.ReactNode;
  title?: string;
}): React.JSX.Element {
  return (
    <span className={`status-pill status-pill--${tone}`} title={title}>
      {icon !== undefined && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

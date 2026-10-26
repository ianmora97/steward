import { Icon, type IconName } from './Icon';

/** An icon-only button. The label is required: it is the tooltip and what a screen reader says. */
export function IconButton({
  icon,
  label,
  onClick,
  tone = 'default',
  bordered = false,
  loading = false,
  disabled = false,
  size = 15,
  className = '',
  expanded
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
  bordered?: boolean;
  /** Spins the icon, for a refresh that keeps the content on screen. */
  loading?: boolean;
  disabled?: boolean;
  size?: number;
  className?: string;
  /** For a button that opens a menu: whether the menu is open. */
  expanded?: boolean;
}): React.JSX.Element {
  const classes = ['iconbutton', tone === 'danger' && 'iconbutton--danger', bordered && 'iconbutton--bordered', loading && 'is-loading', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} onClick={onClick} disabled={disabled} aria-label={label} title={label} aria-busy={loading || undefined} aria-expanded={expanded}>
      <Icon name={icon} size={size} />
    </button>
  );
}

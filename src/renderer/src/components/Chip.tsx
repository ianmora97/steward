import { Icon, type IconName } from './Icon';

/** A label the user can select (a filter, a tab-like choice) and/or remove. Anything read-only is a Badge. */
export function Chip({
  selected = false,
  toggle = false,
  onClick,
  onRemove,
  removeLabel = 'Remove',
  icon,
  title,
  className = '',
  children
}: {
  selected?: boolean;
  /** The chip switches something on and off (a filter), so it is announced as pressed or not. */
  toggle?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  icon?: IconName;
  title?: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const classes = ['fchip', selected && 'fchip--selected', onClick !== undefined && 'fchip--clickable', className].filter(Boolean).join(' ');
  const content = (
    <>
      {icon !== undefined && <Icon name={icon} size={13} />}
      {children}
    </>
  );

  return (
    <span className={classes} title={title}>
      {onClick === undefined ? (
        content
      ) : (
        <button type="button" className="fchip__label" onClick={onClick} aria-pressed={toggle ? selected : undefined}>
          {content}
        </button>
      )}
      {onRemove !== undefined && (
        <button type="button" className="fchip__remove" onClick={onRemove} aria-label={removeLabel} title={removeLabel}>
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  );
}

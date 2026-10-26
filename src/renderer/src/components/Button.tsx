import { Icon, type IconName } from './Icon';
import { Spinner } from './Spinner';

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'ghost';

/**
 * The one button. While `loading` it cannot be pressed, shows a spinner and swaps its label
 * for `loadingLabel` ("Saving…"), so the user sees that something is happening and never
 * double-submits.
 */
export function Button({
  variant = 'default',
  size = 'md',
  icon,
  loading = false,
  loadingLabel,
  dangerText = false,
  className = '',
  type = 'button',
  disabled,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: IconName;
  loading?: boolean;
  loadingLabel?: string;
  /** A plain button that turns red on hover, for a destructive action that is not the main one. */
  dangerText?: boolean;
}): React.JSX.Element {
  const classes = [
    'button',
    variant !== 'default' && `button--${variant}`,
    size === 'sm' && 'button--small',
    dangerText && 'button--danger-text',
    loading && 'is-loading',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} disabled={disabled === true || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : icon !== undefined && <Icon name={icon} size={size === 'sm' ? 13 : 15} />}
      {loading && loadingLabel !== undefined ? loadingLabel : children}
    </button>
  );
}

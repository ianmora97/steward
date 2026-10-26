export type StatusTone = 'ok' | 'warn' | 'danger' | 'idle' | 'busy';

/**
 * A status light: green, amber, red or blue pulses so a live state catches the eye; grey (never checked) stays still.
 * The text next to it always says the same thing, so colour is never the only signal.
 */
export function StatusDot({ tone, size = 10, label }: { tone: StatusTone; size?: number; label?: string }): React.JSX.Element {
  return (
    <span
      className={`sdot sdot--${tone}`}
      style={{ width: size, height: size }}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    />
  );
}

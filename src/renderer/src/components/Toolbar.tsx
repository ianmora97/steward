/** A row of controls: even spacing, wraps instead of squeezing, never breaks a label. */
export function Toolbar({
  align = 'start',
  children
}: {
  align?: 'start' | 'end' | 'between';
  children: React.ReactNode;
}): React.JSX.Element {
  return <div className={`toolbar${align === 'start' ? '' : ` toolbar--${align}`}`}>{children}</div>;
}

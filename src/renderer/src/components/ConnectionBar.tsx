/** The header of a connected service: a status dot, what it is connected to, one line of facts, badges and actions. */
export function ConnectionBar({
  status,
  statusLabel,
  title,
  titleHint,
  meta,
  metaTitle,
  badges,
  actions
}: {
  /** Omit when the service does not keep a live connection to report on. */
  status?: 'up' | 'connecting' | 'down';
  statusLabel?: string;
  /** Host or name, shown in the mono face. */
  title: string;
  titleHint?: string;
  meta?: React.ReactNode;
  metaTitle?: string;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="connbar">
      {status !== undefined && (
        <span
          className={`connbar__dot${status === 'up' ? ' connbar__dot--up' : status === 'down' ? ' connbar__dot--down' : ''}`}
          role="img"
          aria-label={statusLabel}
          title={statusLabel}
        />
      )}
      <span className="connbar__title" title={titleHint ?? title}>
        {title}
      </span>
      {meta !== undefined && (
        <span className="connbar__meta" title={metaTitle}>
          {meta}
        </span>
      )}
      {badges}
      <span className="connbar__spacer" />
      {actions !== undefined && <div className="connbar__actions">{actions}</div>}
    </div>
  );
}

import { Icon, type IconName } from './Icon';

/** One row of a list: icon, title, a line of meta, badges and actions, at a standard height. Clickable when it has `onClick`. */
export function ListRow({
  icon,
  title,
  titleMono = false,
  titleHint,
  meta,
  badges,
  actions,
  onClick,
  selected = false
}: {
  icon?: IconName;
  title: React.ReactNode;
  titleMono?: boolean;
  titleHint?: string;
  meta?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
}): React.JSX.Element {
  const content = (
    <>
      {icon !== undefined && (
        <span className="listrow__icon">
          <Icon name={icon} size={15} />
        </span>
      )}
      <span className="listrow__text">
        <span className={`listrow__title${titleMono ? ' listrow__title--mono' : ''}`} title={titleHint}>
          {title}
        </span>
        {meta !== undefined && <span className="listrow__meta">{meta}</span>}
      </span>
      {badges !== undefined && <span className="listrow__badges">{badges}</span>}
      {actions !== undefined && <span className="listrow__actions">{actions}</span>}
    </>
  );
  const classes = `listrow${selected ? ' listrow--selected' : ''}`;

  return onClick === undefined ? (
    <div className={classes}>{content}</div>
  ) : (
    <button type="button" className={classes} onClick={onClick}>
      {content}
    </button>
  );
}

/** The list a run of `ListRow`s sits in: wrap each row in an `<li>`. */
export function ListRows({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <ul className="listrows">{children}</ul>;
}

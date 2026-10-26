import { Icon, type IconName } from './Icon';

/** What a view shows when there is nothing to list. `bare` drops the dashed frame for a quiet one-line note. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  bare = false,
  children
}: {
  title: string;
  description?: string;
  icon?: IconName;
  action?: React.ReactNode;
  bare?: boolean;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={`empty${bare ? ' empty--bare' : ''}`}>
      {icon !== undefined && (
        <span className="empty__icon">
          <Icon name={icon} size={20} />
        </span>
      )}
      <h3 className="empty__title">{title}</h3>
      {description !== undefined && <p className="empty__description">{description}</p>}
      {action !== undefined && <div className="empty__action">{action}</div>}
      {children}
    </div>
  );
}

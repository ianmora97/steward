export function EmptyState({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="empty">
      <h3 className="empty__title">{title}</h3>
      {description !== undefined && <p className="empty__description">{description}</p>}
      {children}
    </div>
  );
}

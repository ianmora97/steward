/** The title block at the top of a page or view: name, one line of context, and its actions on the right. */
export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="pagehead">
      <div>
        <h2 className="pagehead__title">{title}</h2>
        {subtitle !== undefined && <p className="pagehead__subtitle">{subtitle}</p>}
      </div>
      {actions !== undefined && <div className="toolbar">{actions}</div>}
    </header>
  );
}

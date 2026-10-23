/**
 * A tab whose feature has not been built yet.
 *
 * It says plainly what is missing and when it arrives. Showing an empty shell
 * or placeholder data here would be a simulated success, which Steward does
 * not do anywhere.
 */
export function PendingPanel({
  title,
  milestone,
  description
}: {
  title: string;
  milestone: string;
  description: string;
}): React.JSX.Element {
  return (
    <div className="panel">
      <section className="card card--muted">
        <h2 className="card__title">{title}</h2>
        <p className="card__badge">{milestone}</p>
        <p className="card__hint">{description}</p>
      </section>
    </div>
  );
}

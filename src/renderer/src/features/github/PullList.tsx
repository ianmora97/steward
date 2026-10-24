import type { GithubPull } from '@shared/schemas/github';

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

export function PullList({
  pulls,
  hasNext,
  loading,
  onLoadMore,
  onOpen
}: {
  pulls: GithubPull[];
  hasNext: boolean;
  loading: boolean;
  onLoadMore: () => void;
  onOpen: (url: string) => void;
}): React.JSX.Element {
  if (pulls.length === 0) {
    return <p className="card__hint">{loading ? 'Loading pull requests…' : 'No pull requests match this filter.'}</p>;
  }

  return (
    <div className="ghpulls">
      <ul className="ghpulls__list">
        {pulls.map((pull) => (
          <li key={pull.number} className="ghpull">
            <div className="ghpull__main">
              <button type="button" className="ghpull__title" onClick={() => onOpen(pull.url)}>
                <span className="ghpull__number">#{pull.number}</span> {pull.title}
              </button>
              <span className="ghpull__meta">
                {pull.headRef} → {pull.baseRef} · {pull.author ?? 'unknown'} · updated {formatDate(pull.updatedAt)}
              </span>
            </div>
            <div className="ghpull__badges">
              {pull.draft && <span className="chip">draft</span>}
              <span className={`chip ghpull__state ghpull__state--${pull.state}`}>{pull.state}</span>
            </div>
          </li>
        ))}
      </ul>
      {hasNext && (
        <button type="button" className="button" disabled={loading} onClick={onLoadMore}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

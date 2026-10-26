import type { GithubPull } from '@shared/schemas/github';
import { Icon, type IconName } from '../../components/Icon';
import { Badge, type BadgeTone } from '../../components/Badge';
import { formatWhen, timeAgo } from './run-format';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';

function pullBadge(pull: GithubPull): { tone: BadgeTone; icon: IconName; label: string } {
  if (pull.state === 'merged') return { tone: 'merged', icon: 'merge', label: 'Merged' };
  if (pull.state === 'closed') return { tone: 'failure', icon: 'prClosed', label: 'Closed' };
  if (pull.draft) return { tone: 'neutral', icon: 'prDraft', label: 'Draft' };
  return { tone: 'success', icon: 'pullRequest', label: 'Open' };
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
    return loading ? <Loading lines={4} label="Loading pull requests…" /> : <p className="card__hint">No pull requests match this filter.</p>;
  }

  return (
    <div className="ghpulls">
      <ul className="ghpulls__list">
        {pulls.map((pull) => {
          const badge = pullBadge(pull);
          return (
            <li key={pull.number} className="ghitem">
              <Badge tone={badge.tone} icon={badge.icon}>
                {badge.label}
              </Badge>
              <div className="ghitem__main">
                <button type="button" className="ghitem__title" onClick={() => onOpen(pull.url)}>
                  {pull.title}
                  <span className="ghitem__number">#{pull.number}</span>
                </button>
                <span className="ghmeta">
                  <span className="ghmeta__refs">
                    <code className="ghref">{pull.headRef}</code>
                    <Icon name="arrowRight" size={12} />
                    <code className="ghref">{pull.baseRef}</code>
                  </span>
                  <span className="ghmeta__item">
                    <Icon name="user" size={12} />
                    {pull.author ?? 'unknown'}
                  </span>
                  <span className="ghmeta__item" title={formatWhen(pull.updatedAt)}>
                    <Icon name="clock" size={12} />
                    {timeAgo(pull.updatedAt)}
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {hasNext && (
        <Button loading={loading} loadingLabel="Loading…" onClick={onLoadMore}>Load more</Button>
      )}
    </div>
  );
}

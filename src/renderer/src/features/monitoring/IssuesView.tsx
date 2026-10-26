import { useEffect, useState } from 'react';
import type { ObservabilitySource, SentryEvent, SentryIssue, SentryIssuesResult, SentryPeriod } from '@shared/schemas/observability';
import type { StewardError } from '@shared/types/result';
import { Badge, type BadgeTone } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBanner } from '../../components/ErrorBanner';
import { IconButton } from '../../components/IconButton';
import { ListRow } from '../../components/ListRow';
import { Loading } from '../../components/Loading';
import { useAction } from '../../components/useAction';
import { formatWhen } from './investigate-format';

const PERIODS: readonly SentryPeriod[] = ['1h', '24h', '7d', '14d'];

const LEVEL_TONE: Record<string, BadgeTone> = { fatal: 'failure', error: 'failure', warning: 'warning', info: 'info', debug: 'neutral' };

function formatCount(value: number): string {
  return new Intl.NumberFormat('en').format(value);
}

/** The latest event of one issue: what was thrown, where, and the labels Sentry attached. */
function IssueDetail({ source, issue, onClose }: { source: ObservabilitySource; issue: SentryIssue; onClose: () => void }): React.JSX.Element {
  const [answer, setAnswer] = useState<{ issueId: string; event: SentryEvent | null; error: StewardError | null } | null>(null);
  const open = useAction((path: string) => window.steward.observability.openUrl({ sourceId: source.id, path }), { errorTarget: 'toast' });

  useEffect(() => {
    let cancelled = false;
    void window.steward.observability.sentryEvent({ sourceId: source.id, issueId: issue.id }).then((response) => {
      if (cancelled) return;
      setAnswer({ issueId: issue.id, event: response.success ? response.data : null, error: response.success ? null : response.error });
    });
    return () => {
      cancelled = true;
    };
  }, [source.id, issue.id]);

  const current = answer !== null && answer.issueId === issue.id ? answer : null;

  return (
    <Card>
      <Card.Header title={issue.shortId}>
        <div className="mnrange">
          {issue.path !== null && (
            <Button size="sm" icon="external" onClick={() => void open.run(issue.path ?? '/')}>
              Open in Sentry
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </Card.Header>
      <Card.Body>
        <p className="mnsignal__error">{issue.title}</p>
        {current === null && <Loading lines={4} label="Loading the latest event…" />}
        {current !== null && current.error !== null && <ErrorBanner error={current.error} onDismiss={() => setAnswer(null)} />}
        {current !== null && current.event !== null && (
          <>
            <p className="card__hint">
              {current.event.dateCreatedMs === null ? '' : `${formatWhen(current.event.dateCreatedMs)} · `}
              {current.event.release === null ? 'no release' : `release ${current.event.release}`}
            </p>
            {current.event.message !== null && <p className="mnmono">{current.event.message}</p>}
            <div className="mndetail__labels">
              {current.event.tags.map((tag) => (
                <Badge key={tag.key} tone="neutral" size="sm">
                  {tag.key}={tag.value}
                </Badge>
              ))}
            </div>
            {current.event.exceptions.length === 0 && <p className="card__hint">This event has no stack trace.</p>}
            {current.event.exceptions.map((exception, index) => (
              <div key={`${exception.type}-${index}`} className="mnstack">
                <strong>{exception.type ?? 'Exception'}</strong>
                {exception.value !== null && <span className="mnstack__value"> {exception.value}</span>}
                <ol className="mnstack__frames">
                  {[...exception.frames].reverse().map((frame, position) => (
                    <li key={`${frame.file}-${frame.line}-${position}`} className={frame.inApp ? 'mnstack__frame mnstack__frame--app' : 'mnstack__frame'}>
                      <span className="mnmono">{frame.function ?? '(anonymous)'}</span>
                      <span className="card__hint">
                        {' '}
                        {frame.file ?? ''}
                        {frame.line === null ? '' : `:${frame.line}`}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </>
        )}
      </Card.Body>
    </Card>
  );
}

/** One Sentry project: its issues for a search and a period, and the latest event of the one chosen. */
function SentryExplorer({ source }: { source: ObservabilitySource }): React.JSX.Element {
  const [query, setQuery] = useState('is:unresolved');
  const [appliedQuery, setAppliedQuery] = useState('is:unresolved');
  const [period, setPeriod] = useState<SentryPeriod>('24h');
  const [token, setToken] = useState(0);
  const [selected, setSelected] = useState<SentryIssue | null>(null);
  const requestKey = `${appliedQuery}|${period}|${token}`;
  const [answer, setAnswer] = useState<{ key: string; result: SentryIssuesResult | null; error: StewardError | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.steward.observability
      .sentryIssues({ sourceId: source.id, query: appliedQuery, statsPeriod: period })
      .then((response) => {
        if (cancelled) return;
        setAnswer({ key: requestKey, result: response.success ? response.data : null, error: response.success ? null : response.error });
      });
    return () => {
      cancelled = true;
    };
  }, [source.id, appliedQuery, period, requestKey]);

  const current = answer !== null && answer.key === requestKey ? answer : null;
  const loading = current === null;

  return (
    <>
      <Card>
        <Card.Body>
          <div className="mnsection__bar">
            <div className="mnrange">
              <input
                className="field__input mnsearch mnmono"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setAppliedQuery(query.trim());
                }}
                placeholder="is:unresolved level:error"
                aria-label="Sentry search"
                spellCheck={false}
              />
              <Button size="sm" onClick={() => setAppliedQuery(query.trim())}>
                Search
              </Button>
            </div>
            <div className="mnrange">
              <div className="segmented" role="group" aria-label="Period">
                {PERIODS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`segmented__option${period === value ? ' segmented__option--active' : ''}`}
                    onClick={() => setPeriod(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <IconButton icon="refresh" label="Reload issues" loading={loading} onClick={() => setToken((value) => value + 1)} />
            </div>
          </div>
        </Card.Body>
      </Card>

      {current !== null && current.error !== null && <ErrorBanner error={current.error} onDismiss={() => setAnswer(null)} />}
      {loading && <Loading lines={4} label="Loading issues…" />}

      {current !== null && current.result !== null && (
        <Card>
          <Card.Header title="Issues">
            <span className="card__hint">{current.result.issues.length}{current.result.truncated ? '+' : ''} found</span>
          </Card.Header>
          <Card.Body>
            {current.result.issues.length === 0 ? (
              <p className="card__hint">No issue matches this search in this period.</p>
            ) : (
              <div className="mnlist">
                {current.result.issues.map((issue) => (
                  <ListRow
                    key={issue.id}
                    icon="bug"
                    title={issue.title}
                    titleHint={issue.title}
                    meta={`${issue.culprit ?? ''}${issue.culprit === null ? '' : ' · '}${formatCount(issue.count)} events · ${formatCount(issue.userCount)} users${issue.lastSeenMs === null ? '' : ` · last seen ${formatWhen(issue.lastSeenMs)}`}`}
                    badges={<Badge tone={LEVEL_TONE[issue.level] ?? 'neutral'} size="sm">{issue.level}</Badge>}
                    selected={selected?.id === issue.id}
                    onClick={() => setSelected(selected?.id === issue.id ? null : issue)}
                  />
                ))}
              </div>
            )}
            {current.result.truncated && <p className="card__hint">Showing the first {current.result.issues.length}. Narrow the search to see the rest.</p>}
          </Card.Body>
        </Card>
      )}

      {selected !== null && <IssueDetail source={source} issue={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

export function IssuesView({ sources }: { sources: ObservabilitySource[] }): React.JSX.Element {
  const sentries = sources.filter((source) => source.kind === 'sentry');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const source = sentries.find((candidate) => candidate.id === selectedId) ?? sentries[0] ?? null;

  if (source === null) {
    return <EmptyState icon="bug" title="No Sentry source" description="Add a Sentry source in the Sources view to read the issues of a project." />;
  }

  return (
    <div className="mnsection">
      {sentries.length > 1 && (
        <div className="mnsection__bar">
          <select className="field__input mnselect" value={source.id} onChange={(event) => setSelectedId(event.target.value)} aria-label="Sentry source">
            {sentries.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <SentryExplorer key={source.id} source={source} />
    </div>
  );
}

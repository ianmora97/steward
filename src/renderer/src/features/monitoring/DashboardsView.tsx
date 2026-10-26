import { useEffect, useMemo, useState } from 'react';
import type { ObservabilityAlert, ObservabilityDashboard, ObservabilitySource } from '@shared/schemas/observability';
import type { StewardError } from '@shared/types/result';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { ListRow } from '../../components/ListRow';
import { Loading } from '../../components/Loading';
import { useAction } from '../../components/useAction';

const NO_FOLDER = 'General';

function groupByFolder(dashboards: ObservabilityDashboard[]): [string, ObservabilityDashboard[]][] {
  const groups = new Map<string, ObservabilityDashboard[]>();
  for (const dashboard of dashboards) {
    const folder = dashboard.folder ?? NO_FOLDER;
    groups.set(folder, [...(groups.get(folder) ?? []), dashboard]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === NO_FOLDER ? -1 : b === NO_FOLDER ? 1 : a.localeCompare(b)));
}

export function DashboardsView({ sources }: { sources: ObservabilitySource[] }): React.JSX.Element {
  const grafanas = sources.filter((source) => source.kind === 'grafana');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const source = grafanas.find((candidate) => candidate.id === selectedId) ?? grafanas[0] ?? null;
  const sourceId = source?.id ?? null;

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [dashboards, setDashboards] = useState<ObservabilityDashboard[] | null>(null);
  const [alerts, setAlerts] = useState<ObservabilityAlert[] | null>(null);
  const [error, setError] = useState<StewardError | null>(null);
  const [alertsError, setAlertsError] = useState<StewardError | null>(null);
  const [version, setVersion] = useState(0);

  const open = useAction((path: string) => window.steward.observability.openUrl({ sourceId: sourceId ?? '', path }), { errorTarget: 'toast' });

  // The search waits for a pause in typing: every keystroke would otherwise be a request to Grafana.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (sourceId === null) return;
    let cancelled = false;
    void window.steward.observability.grafanaDashboards({ sourceId, ...(query === '' ? {} : { query }) }).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setDashboards(result.data);
        setError(null);
      } else {
        setDashboards([]);
        setError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sourceId, query, version]);

  useEffect(() => {
    if (sourceId === null) return;
    let cancelled = false;
    void window.steward.observability.grafanaAlerts({ sourceId }).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setAlerts(result.data);
        setAlertsError(null);
      } else {
        setAlerts([]);
        setAlertsError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sourceId, version]);

  const groups = useMemo(() => groupByFolder(dashboards ?? []), [dashboards]);

  if (source === null) {
    return <EmptyState icon="barChart" title="No Grafana source" description="Add a Grafana source in the Sources view to list its dashboards." />;
  }

  return (
    <div className="mnsection">
      <div className="mnsection__bar">
        {grafanas.length > 1 && (
          <select className="field__input mnselect" value={source.id} onChange={(event) => setSelectedId(event.target.value)} aria-label="Grafana source">
            {grafanas.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        )}
        <input
          className="field__input mnsearch"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search dashboards"
          aria-label="Search dashboards"
        />
        <IconButton
          icon="refresh"
          label="Reload dashboards and alerts"
          onClick={() => {
            setDashboards(null);
            setAlerts(null);
            setVersion((value) => value + 1);
          }}
        />
      </div>

      <Card>
        <Card.Header title="Active alerts">
          {alerts !== null && (
            <Badge tone={alerts.length === 0 ? 'success' : 'warning'} icon={alerts.length === 0 ? 'checkCircle' : 'alert'}>
              {alerts.length === 0 ? 'None firing' : `${alerts.length} active`}
            </Badge>
          )}
        </Card.Header>
        <Card.Body>
          {alertsError !== null && <ErrorBanner error={alertsError} onDismiss={() => setAlertsError(null)} />}
          {alerts === null ? (
            <Loading lines={2} label="Loading alerts…" />
          ) : alerts.length === 0 ? (
            alertsError === null && <p className="card__hint">Nothing is firing in Grafana right now.</p>
          ) : (
            <div className="mnlist">
              {alerts.map((alert) => (
                <ListRow
                  key={alert.id}
                  icon="alert"
                  title={alert.name}
                  meta={alert.summary ?? undefined}
                  badges={
                    <>
                      {alert.severity !== null && <Badge tone={alert.severity === 'critical' ? 'failure' : 'warning'}>{alert.severity}</Badge>}
                      {alert.state === 'suppressed' && <Badge tone="neutral">Silenced</Badge>}
                    </>
                  }
                />
              ))}
            </div>
          )}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header title="Dashboards">
          {dashboards !== null && <span className="card__hint">{dashboards.length} found</span>}
        </Card.Header>
        <Card.Body>
          {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
          {dashboards === null ? (
            <Loading lines={4} label="Loading dashboards…" />
          ) : dashboards.length === 0 ? (
            error === null && <p className="card__hint">{query === '' ? 'This Grafana has no dashboards the token can see.' : `No dashboard matches "${query}".`}</p>
          ) : (
            groups.map(([folder, items]) => (
              <section key={folder} className="mnfolder">
                <h4 className="mnfolder__title">
                  <Icon name="folder" size={13} /> {folder}
                </h4>
                <div className="mnlist">
                  {items.map((dashboard) => (
                    <ListRow
                      key={dashboard.uid}
                      icon="barChart"
                      title={dashboard.title}
                      meta={dashboard.tags.length === 0 ? undefined : dashboard.tags.join(' · ')}
                      actions={<IconButton icon="external" label={`Open ${dashboard.title} in the browser`} onClick={() => void open.run(dashboard.path)} />}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </Card.Body>
      </Card>
    </div>
  );
}

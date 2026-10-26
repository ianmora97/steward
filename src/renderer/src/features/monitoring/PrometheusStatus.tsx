import { useEffect, useState } from 'react';
import type { ObservabilityAlert, PrometheusTargetsResult } from '@shared/schemas/observability';
import type { StewardError } from '@shared/types/result';
import { Badge } from '../../components/Badge';
import { Card } from '../../components/Card';
import { ErrorBanner } from '../../components/ErrorBanner';
import { IconButton } from '../../components/IconButton';
import { ListRow } from '../../components/ListRow';
import { Loading } from '../../components/Loading';

/** What Prometheus itself reports: which scrape targets are up, and which alerts are firing or about to. */
export function PrometheusStatus({ sourceId, section }: { sourceId: string; section: 'targets' | 'alerts' }): React.JSX.Element {
  const [targets, setTargets] = useState<PrometheusTargetsResult | null>(null);
  const [alerts, setAlerts] = useState<ObservabilityAlert[] | null>(null);
  const [error, setError] = useState<StewardError | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (section === 'targets') {
      void window.steward.observability.prometheusTargets({ sourceId }).then((result) => {
        if (cancelled) return;
        if (result.success) setTargets(result.data);
        else {
          setTargets({ targets: [], totalTargets: 0, truncated: false });
          setError(result.error);
        }
      });
    } else {
      void window.steward.observability.prometheusAlerts({ sourceId }).then((result) => {
        if (cancelled) return;
        if (result.success) setAlerts(result.data);
        else {
          setAlerts([]);
          setError(result.error);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [sourceId, section, version]);

  const reload = (): void => {
    setError(null);
    setTargets(null);
    setAlerts(null);
    setVersion((value) => value + 1);
  };

  return (
    <Card>
      <Card.Header title={section === 'targets' ? 'Scrape targets' : 'Alerts'}>
        <IconButton icon="refresh" label="Reload" onClick={reload} />
      </Card.Header>
      <Card.Body>
        {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        {section === 'targets' &&
          (targets === null ? (
            <Loading lines={4} label="Loading targets…" />
          ) : targets.targets.length === 0 ? (
            error === null && <p className="card__hint">Prometheus has no active targets.</p>
          ) : (
            <>
              <div className="mnlist">
                {targets.targets.map((target, position) => (
                  <ListRow
                    key={`${target.job}-${target.instance}-${position}`}
                    icon="plug"
                    title={target.instance}
                    titleMono
                    meta={target.lastError ?? target.job}
                    badges={
                      <Badge tone={target.health === 'up' ? 'success' : target.health === 'down' ? 'failure' : 'neutral'} icon={target.health === 'up' ? 'checkCircle' : target.health === 'down' ? 'xCircle' : 'minusCircle'}>
                        {target.health === 'up' ? 'Up' : target.health === 'down' ? 'Down' : 'Unknown'}
                      </Badge>
                    }
                  />
                ))}
              </div>
              {targets.truncated && <p className="card__hint">Showing {targets.targets.length} of {targets.totalTargets} targets, down ones first.</p>}
            </>
          ))}
        {section === 'alerts' &&
          (alerts === null ? (
            <Loading lines={3} label="Loading alerts…" />
          ) : alerts.length === 0 ? (
            error === null && <p className="card__hint">No alert is firing or pending.</p>
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
                      <Badge tone={alert.state === 'firing' ? 'failure' : 'warning'}>{alert.state === 'firing' ? 'Firing' : 'Pending'}</Badge>
                    </>
                  }
                />
              ))}
            </div>
          ))}
      </Card.Body>
    </Card>
  );
}

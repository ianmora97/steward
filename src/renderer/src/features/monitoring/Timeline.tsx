import type { AlertMarker, DeployMarker } from '@shared/schemas/observability';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { formatWhen } from './investigate-format';

interface TimelineEvent {
  key: string;
  atMs: number;
  tone: 'success' | 'failure' | 'warning' | 'neutral';
  kind: 'deploy' | 'alert';
  title: string;
  detail: string;
}

function eventsOf(deploys: DeployMarker[], alerts: AlertMarker[], fromMs: number, toMs: number): TimelineEvent[] {
  const events: TimelineEvent[] = deploys.map((deploy) => ({
    key: `deploy-${deploy.id}`,
    atMs: deploy.atMs,
    tone: deploy.status === 'succeeded' ? 'success' : deploy.status === 'failed' ? 'failure' : 'neutral',
    kind: 'deploy',
    title: `Deploy ${deploy.ref ?? deploy.commitSha?.slice(0, 7) ?? deploy.targetName}`,
    detail: `${deploy.status.replace('_', ' ')} · ${deploy.targetName}`
  }));
  for (const alert of alerts) {
    if (alert.startsAtMs === null || alert.startsAtMs < fromMs || alert.startsAtMs > toMs) continue;
    events.push({
      key: `alert-${alert.name}-${alert.startsAtMs}`,
      atMs: alert.startsAtMs,
      tone: alert.severity === 'critical' ? 'failure' : 'warning',
      kind: 'alert',
      title: alert.name,
      detail: `${alert.state}${alert.severity === null ? '' : ` · ${alert.severity}`} · ${alert.sourceName}`
    });
  }
  return events.sort((a, b) => a.atMs - b.atMs);
}

/** Deploys and alerts of the window on one line, then listed: the order in which things happened is the point. */
export function Timeline({
  deploys,
  alerts,
  fromMs,
  toMs,
  onOpenDeployments
}: {
  deploys: DeployMarker[];
  alerts: AlertMarker[];
  fromMs: number;
  toMs: number;
  onOpenDeployments: () => void;
}): React.JSX.Element {
  const events = eventsOf(deploys, alerts, fromMs, toMs);
  const span = Math.max(1, toMs - fromMs);

  if (events.length === 0) return <p className="card__hint">No deploys or alerts in this window.</p>;

  return (
    <div className="mntimeline">
      <div className="mntimeline__track" role="img" aria-label={`${events.length} events between ${formatWhen(fromMs)} and ${formatWhen(toMs)}`}>
        {events.map((event) => (
          <span
            key={event.key}
            className={`mntimeline__mark mntimeline__mark--${event.tone}${event.kind === 'alert' ? ' mntimeline__mark--alert' : ''}`}
            style={{ left: `${Math.min(100, Math.max(0, ((event.atMs - fromMs) / span) * 100))}%` }}
            title={`${event.title} · ${formatWhen(event.atMs)}`}
          />
        ))}
      </div>
      <div className="mntimeline__ends">
        <span>{formatWhen(fromMs)}</span>
        <span>{formatWhen(toMs)}</span>
      </div>
      <ul className="mntimeline__list">
        {events.map((event) => (
          <li key={event.key} className="mntimeline__item">
            <Icon name={event.kind === 'deploy' ? 'deployments' : 'alert'} size={14} />
            <span className="mntimeline__when">{formatWhen(event.atMs)}</span>
            <strong>{event.title}</strong>
            <Badge tone={event.tone} size="sm">
              {event.detail}
            </Badge>
          </li>
        ))}
      </ul>
      {deploys.length > 0 && (
        <div>
          <Button size="sm" icon="deployments" onClick={onOpenDeployments}>
            Open Deployments
          </Button>
        </div>
      )}
    </div>
  );
}

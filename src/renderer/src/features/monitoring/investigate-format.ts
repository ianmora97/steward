import type { AlertMarker, DeployMarker } from '@shared/schemas/observability';
import type { ChartMarker } from './TimeSeriesChart';

/** `Oct 25, 14:03`, in the user's time zone. */
export function formatWhen(ms: number): string {
  const date = new Date(ms);
  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${day}, ${time}`;
}

/** Deploys and alerts as vertical lines on every chart: a failed deploy red, a successful one green, an alert amber. */
export function chartMarkers(deploys: DeployMarker[], alerts: AlertMarker[], fromMs: number, toMs: number): ChartMarker[] {
  const markers: ChartMarker[] = deploys.map((deploy) => ({
    atMs: deploy.atMs,
    label: deploy.ref ?? deploy.commitSha?.slice(0, 7) ?? 'deploy',
    tone: deploy.status === 'failed' ? 'danger' : deploy.status === 'succeeded' ? 'success' : 'info'
  }));
  for (const alert of alerts) {
    if (alert.startsAtMs !== null && alert.startsAtMs >= fromMs && alert.startsAtMs <= toMs) {
      markers.push({ atMs: alert.startsAtMs, label: alert.name, tone: 'warning' });
    }
  }
  return markers;
}

/** `+12.5%` / `−3%`, with a real minus sign; a dash when there is nothing honest to say. */
export function formatChange(changePct: number | null): string {
  if (changePct === null) return '—';
  const magnitude = Math.abs(changePct);
  const text = magnitude >= 100 ? magnitude.toFixed(0) : magnitude >= 10 ? magnitude.toFixed(1) : magnitude.toFixed(2);
  return `${changePct >= 0 ? '+' : '−'}${text}%`;
}

import type {
  ConnectionState,
  ObservabilityCapability,
  ObservabilityKind,
  ObservabilitySource,
  ObservabilitySourceStatus,
  OperationalState
} from '@shared/schemas/observability';
import type { BadgeTone } from '../../components/Badge';
import type { IconName } from '../../components/Icon';

export const KIND_LABEL: Record<ObservabilityKind, string> = {
  grafana: 'Grafana',
  loki: 'Loki',
  prometheus: 'Prometheus',
  sentry: 'Sentry'
};

export const KIND_ICON: Record<ObservabilityKind, IconName> = {
  grafana: 'barChart',
  loki: 'list',
  prometheus: 'trendingUp',
  sentry: 'bug'
};

/** The tools this version of Steward can connect. A kind joins the list when its provider ships. */
export const AVAILABLE_KINDS: readonly ObservabilityKind[] = ['grafana', 'loki', 'prometheus', 'sentry'];

/** An answer older than this is asked for again when the tab opens. */
export const STATUS_TTL_MS = 30_000;

const CONNECTION_BADGE: Record<ConnectionState, { tone: BadgeTone; icon: IconName; label: string }> = {
  connected: { tone: 'success', icon: 'checkCircle', label: 'Connected' },
  auth_error: { tone: 'failure', icon: 'lock', label: 'Auth error' },
  unreachable: { tone: 'failure', icon: 'xCircle', label: 'Unreachable' },
  unchecked: { tone: 'neutral', icon: 'minusCircle', label: 'Not checked' }
};

const OPERATIONAL_BADGE: Record<OperationalState, { tone: BadgeTone; icon: IconName; label: string }> = {
  healthy: { tone: 'success', icon: 'checkCircle', label: 'Healthy' },
  degraded: { tone: 'warning', icon: 'alert', label: 'Degraded' },
  failing: { tone: 'failure', icon: 'xCircle', label: 'Failing' },
  unknown: { tone: 'neutral', icon: 'minusCircle', label: 'Unknown' }
};

export function connectionBadge(state: ConnectionState): { tone: BadgeTone; icon: IconName; label: string } {
  return CONNECTION_BADGE[state];
}

export function operationalBadge(state: OperationalState): { tone: BadgeTone; icon: IconName; label: string } {
  return OPERATIONAL_BADGE[state];
}

export function isStale(status: ObservabilitySourceStatus, now = Date.now()): boolean {
  return status.checkedAt === null || now - Date.parse(status.checkedAt) > STATUS_TTL_MS;
}

export function hasCapability(sources: readonly ObservabilitySource[], capability: ObservabilityCapability): boolean {
  return sources.some((source) => source.capabilities.includes(capability));
}

/** `1234 ms` → `1.2 s`. */
export function formatLatency(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

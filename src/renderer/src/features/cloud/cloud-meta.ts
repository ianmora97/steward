import type { CheckKind, CheckStatus, DetectedProxy, DomainConnection, DomainOperational } from '@shared/schemas/cloud';
import type { BadgeTone } from '../../components/Badge';
import type { IconName } from '../../components/Icon';

interface BadgeLook {
  tone: BadgeTone;
  icon: IconName;
  label: string;
}

const CONNECTION_BADGE: Record<DomainConnection, BadgeLook> = {
  connected: { tone: 'success', icon: 'checkCircle', label: 'Reachable' },
  unreachable: { tone: 'failure', icon: 'xCircle', label: 'Unreachable' },
  unknown: { tone: 'neutral', icon: 'minusCircle', label: 'Not checked' }
};

const OPERATIONAL_BADGE: Record<DomainOperational, BadgeLook> = {
  healthy: { tone: 'success', icon: 'checkCircle', label: 'Healthy' },
  degraded: { tone: 'warning', icon: 'alert', label: 'Degraded' },
  failing: { tone: 'failure', icon: 'xCircle', label: 'Failing' },
  unknown: { tone: 'neutral', icon: 'minusCircle', label: 'Unknown' }
};

export const PROXY_LABEL: Record<DetectedProxy, string> = {
  cloudflare: 'Cloudflare',
  cloudfront: 'CloudFront',
  alb: 'AWS load balancer'
};

/** The certificate's remaining life as a badge: red under a week, amber under three, calm otherwise. */
export function certificateBadge(daysLeft: number): { tone: BadgeTone; label: string } {
  if (daysLeft < 0) return { tone: 'failure', label: 'Certificate expired' };
  const label = `Certificate ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  if (daysLeft < 7) return { tone: 'failure', label };
  if (daysLeft < 21) return { tone: 'warning', label };
  return { tone: 'neutral', label };
}

/** `1234 ms` → `1.2 s`. */
export function formatLatency(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function connectionBadge(state: DomainConnection): BadgeLook {
  return CONNECTION_BADGE[state];
}

export function operationalBadge(state: DomainOperational): BadgeLook {
  return OPERATIONAL_BADGE[state];
}

export const CHECK_KIND_LABEL: Record<CheckKind, string> = {
  dns: 'DNS',
  tls: 'Certificate',
  http: 'Web page'
};

export const CHECK_KIND_ICON: Record<CheckKind, IconName> = {
  dns: 'list',
  tls: 'lock',
  http: 'globe'
};

const RESULT_BADGE: Record<CheckStatus, BadgeLook> = {
  ok: { tone: 'success', icon: 'checkCircle', label: 'OK' },
  warn: { tone: 'warning', icon: 'alert', label: 'Warning' },
  fail: { tone: 'failure', icon: 'xCircle', label: 'Failed' }
};

export function resultBadge(status: CheckStatus): BadgeLook {
  return RESULT_BADGE[status];
}

/** `300` → `5 min`, `3600` → `1 h`. */
export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
}

/** The intervals offered when creating a check; an edited check with another value keeps it as an extra option. */
export const INTERVAL_PRESETS: readonly number[] = [30, 60, 300, 900, 1800, 3600, 21_600, 86_400];

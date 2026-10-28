import type {
  CheckKind,
  CheckStatus,
  DetectedProxy,
  DomainCheckStates,
  DomainConnection,
  DomainOperational
} from '@shared/schemas/cloud';

const DAY_MS = 86_400_000;

/**
 * Which proxy or CDN answered, from headers an application cannot easily fake by accident:
 * `cf-ray` is Cloudflare's, `x-amz-cf-id` and `via: … CloudFront` are CloudFront's, `server: awselb/2.0` is an
 * AWS load balancer's. Header names are expected in lowercase, as Node delivers them.
 */
export function detectProxy(headers: Record<string, string>): DetectedProxy | null {
  const server = (headers['server'] ?? '').toLowerCase();
  if (headers['cf-ray'] !== undefined || server === 'cloudflare') return 'cloudflare';
  if (headers['x-amz-cf-id'] !== undefined || (headers['via'] ?? '').toLowerCase().includes('cloudfront')) return 'cloudfront';
  if (server.startsWith('awselb')) return 'alb';
  return null;
}

/** Whole days from `nowMs` to the moment, rounded down; negative once it has passed. */
export function daysUntil(momentIso: string, nowMs: number): number {
  return Math.floor((Date.parse(momentIso) - nowMs) / DAY_MS);
}

/**
 * One spelling per address, so `2001:DB8::1` and `2001:db8:0:0:0:0:0:1` compare equal. The URL parser already
 * serializes IPv6 in its shortest lowercase form; anything it does not understand is only lowercased.
 */
export function normalizeIp(address: string): string {
  const trimmed = address.trim().toLowerCase();
  if (!trimmed.includes(':')) return trimmed;
  try {
    return new URL(`http://[${trimmed}]/`).hostname.slice(1, -1);
  } catch {
    return trimmed;
  }
}

/** A CNAME target in one spelling: lowercase, no trailing dot. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, '');
}

export function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && containsAll(a, b);
}

/** Every member of `wanted` is in `have`. */
export function containsAll(have: ReadonlySet<string>, wanted: ReadonlySet<string>): boolean {
  for (const member of wanted) if (!have.has(member)) return false;
  return true;
}

// ── What a check, and a domain, are doing ──────────────────────────────────

export type OperationalState = DomainOperational;

/** How many of a check's latest results its state is read from. */
export const STATE_WINDOW = 5;
/** This many failures in a row, newest first, and the check is failing instead of degraded. */
const FAILING_STREAK = 3;

export interface StateResult {
  ts: string;
  status: CheckStatus;
  latencyMs: number | null;
  detail: Record<string, unknown>;
}

export interface StateCheck {
  kind: CheckKind;
  enabled: boolean;
  /** Newest first. */
  results: readonly StateResult[];
}

/**
 * One check, from its latest results: `failing` after three failures in a row, `degraded` when the latest is not
 * a pass or any of the window was not, `healthy` otherwise. A certificate that was read and is bad (expired,
 * wrong name, untrusted, about to expire) is failing at once: visitors already get a full-page error, and an
 * hourly check should not take three hours to say so.
 */
export function checkState(kind: CheckKind, results: readonly StateResult[]): OperationalState {
  const latest = results[0];
  if (latest === undefined) return 'unknown';
  if (kind === 'tls' && latest.status === 'fail' && typeof latest.detail['validTo'] === 'string') return 'failing';
  const recent = results.slice(0, STATE_WINDOW);
  if (recent.length >= FAILING_STREAK && recent.slice(0, FAILING_STREAK).every((result) => result.status === 'fail')) return 'failing';
  if (recent.some((result) => result.status !== 'ok')) return 'degraded';
  return 'healthy';
}

const SEVERITY: Record<OperationalState, number> = { unknown: 0, healthy: 1, degraded: 2, failing: 3 };

/** The worst state among the checks that have an opinion; unknown only when none does. */
export function domainOperational(states: readonly OperationalState[]): OperationalState {
  let worst: OperationalState = 'unknown';
  for (const state of states) if (SEVERITY[state] > SEVERITY[worst]) worst = state;
  return worst;
}

/**
 * Does the domain resolve and answer? That is the DNS answer and whether the HTTP check got any response at all:
 * a 500 is a response, so it changes the operational state and leaves the connection alone.
 */
export function domainConnection(latest: Partial<Record<CheckKind, StateResult>>): DomainConnection {
  const dns = latest.dns;
  const http = latest.http;
  if (dns === undefined && http === undefined) return 'unknown';
  if (dns?.status === 'fail') return 'unreachable';
  if (http !== undefined && http.detail['responded'] === false) return 'unreachable';
  return 'connected';
}

export interface DomainSignals {
  connection: DomainConnection;
  operational: OperationalState;
  /** One state per kind of check, for the dots a list shows; null where the domain has no such active check. */
  checkStates: DomainCheckStates;
  certDaysLeft: number | null;
  latencyMs: number | null;
  proxy: DetectedProxy | null;
  lastCheckedAt: string | null;
}

const PROXIES: readonly string[] = ['cloudflare', 'cloudfront', 'alb'];

/** The signals the domain list shows, from the checks of one domain. Switched-off checks have no say. */
export function summarizeDomain(checks: readonly StateCheck[]): DomainSignals {
  const active = checks.filter((check) => check.enabled);
  const latest: Partial<Record<CheckKind, StateResult>> = {};
  let lastCheckedAt: string | null = null;
  for (const check of active) {
    const newest = check.results[0];
    if (newest === undefined) continue;
    latest[check.kind] ??= newest;
    if (lastCheckedAt === null || newest.ts > lastCheckedAt) lastCheckedAt = newest.ts;
  }

  const checkStates: DomainCheckStates = { dns: null, tls: null, http: null };
  for (const check of active) {
    const state = checkState(check.kind, check.results);
    const known = checkStates[check.kind];
    // Two checks of the same kind on one domain: the worse of them is what the dot shows.
    checkStates[check.kind] = known === null || SEVERITY[state] > SEVERITY[known] ? state : known;
  }

  const daysLeft = latest.tls?.detail['daysLeft'];
  const proxy = latest.http?.detail['proxy'];
  return {
    connection: domainConnection(latest),
    operational: domainOperational(Object.values(checkStates).filter((state) => state !== null)),
    checkStates,
    certDaysLeft: typeof daysLeft === 'number' ? daysLeft : null,
    latencyMs: latest.http?.latencyMs ?? null,
    proxy: typeof proxy === 'string' && PROXIES.includes(proxy) ? (proxy as DetectedProxy) : null,
    lastCheckedAt
  };
}

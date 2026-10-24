import type { SshHost, SshProvider } from '@shared/schemas/ssh';

export const PROVIDER_LABELS: Record<SshProvider, string> = {
  aws: 'AWS',
  digitalocean: 'DigitalOcean',
  gcp: 'Google Cloud',
  azure: 'Azure',
  hetzner: 'Hetzner',
  linode: 'Linode',
  vultr: 'Vultr',
  on_prem: 'On-premises',
  other: 'Other'
};

export const AWS_REGIONS: readonly { code: string; label: string }[] = [
  { code: 'us-east-1', label: 'N. Virginia' },
  { code: 'us-east-2', label: 'Ohio' },
  { code: 'us-west-1', label: 'N. California' },
  { code: 'us-west-2', label: 'Oregon' },
  { code: 'ca-central-1', label: 'Canada' },
  { code: 'sa-east-1', label: 'São Paulo' },
  { code: 'eu-west-1', label: 'Ireland' },
  { code: 'eu-west-2', label: 'London' },
  { code: 'eu-west-3', label: 'Paris' },
  { code: 'eu-central-1', label: 'Frankfurt' },
  { code: 'eu-north-1', label: 'Stockholm' },
  { code: 'ap-south-1', label: 'Mumbai' },
  { code: 'ap-northeast-1', label: 'Tokyo' },
  { code: 'ap-northeast-2', label: 'Seoul' },
  { code: 'ap-southeast-1', label: 'Singapore' },
  { code: 'ap-southeast-2', label: 'Sydney' }
];

export const CONNECTION_LABEL: Record<SshHost['connection']['state'], string> = {
  unknown: 'Not connected',
  connected: 'Reachable',
  unreachable: 'Unreachable',
  timeout: 'Timed out',
  auth_failed: 'Authentication failed',
  host_key_unknown: 'Host not trusted',
  host_key_changed: 'Host key changed',
  error: 'Error'
};

export function destinationOf(host: SshHost): string {
  const base = host.username === null ? host.host : `${host.username}@${host.host}`;
  return host.port === null ? base : `${base}:${host.port}`;
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function isProduction(environment: string | null): boolean {
  return environment !== null && ['prod', 'production', 'live'].includes(environment.toLowerCase());
}

/** "12 min" / "3 h" / "2 d", for how long ago something started. */
export function sinceLabel(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`;
}

export function durationLabel(ms: number | null): string {
  if (ms === null) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

export const NO_ENVIRONMENT = 'No environment';

/** Familiar environments keep a fixed order (prod → stage → dev); anything else follows alphabetically, unassigned last. */
const KNOWN_ORDER = [
  ['prod', 'production', 'live'],
  ['stage', 'staging', 'preprod', 'pre-prod'],
  ['qa', 'test', 'testing', 'uat'],
  ['dev', 'development']
];

function rank(environment: string): number {
  const lowered = environment.toLowerCase();
  const index = KNOWN_ORDER.findIndex((names) => names.includes(lowered));
  return index === -1 ? KNOWN_ORDER.length : index;
}

export interface EnvironmentGroup {
  /** null = the connections that have no environment yet. */
  environment: string | null;
  hosts: SshHost[];
}

export function groupByEnvironment(hosts: SshHost[]): EnvironmentGroup[] {
  const byName = new Map<string, SshHost[]>();
  const unassigned: SshHost[] = [];
  for (const host of hosts) {
    if (host.environment === null) {
      unassigned.push(host);
      continue;
    }
    // "Prod" and "prod" are the same group; the first spelling seen is the one shown.
    const key = [...byName.keys()].find((name) => name.toLowerCase() === host.environment?.toLowerCase()) ?? host.environment;
    byName.set(key, [...(byName.get(key) ?? []), host]);
  }
  const groups: EnvironmentGroup[] = [...byName.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([environment, list]) => ({ environment, hosts: list }));
  if (unassigned.length > 0) groups.push({ environment: null, hosts: unassigned });
  return groups;
}

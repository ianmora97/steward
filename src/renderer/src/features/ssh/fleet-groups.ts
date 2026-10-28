import type { DomainSummary } from '@shared/schemas/cloud';
import type { Environment } from '@shared/schemas/environments';
import type { SshHost } from '@shared/schemas/ssh';
import { environmentRank, groupByEnvironment } from './ssh-meta';

/** One server with the domains it serves. */
export interface FleetServer {
  host: SshHost;
  domains: DomainSummary[];
}

/** One environment of the project: its servers with their domains, and the domains that are on no server. */
export interface FleetGroup {
  /** null = what has no environment yet. */
  environment: string | null;
  icon: string | null;
  servers: FleetServer[];
  /** Domains of the environment that belong to no server of the project: a CDN, a static site. */
  loose: DomainSummary[];
}

const same = (a: string | null, b: string | null): boolean =>
  a === null || b === null ? a === b : a.toLowerCase() === b.toLowerCase();

/**
 * Servers and their domains, by environment. A domain follows its server, wherever that server lives; one
 * without a server is grouped by its own environment, so a static site still shows up. "Prod" and "prod" are
 * one group, and whatever has no environment is gathered last.
 */
export function groupFleet(hosts: SshHost[], domains: DomainSummary[], environments: Environment[]): FleetGroup[] {
  const groups: FleetGroup[] = groupByEnvironment(hosts).map((group) => ({
    environment: group.environment,
    icon: group.icon,
    servers: group.hosts.map((host) => ({ host, domains: [] })),
    loose: []
  }));

  const serverById = new Map(groups.flatMap((group) => group.servers.map((server) => [server.host.id, server] as const)));

  function groupFor(environment: string | null): FleetGroup {
    const found = groups.find((candidate) => same(candidate.environment, environment));
    if (found !== undefined) return found;
    const icon = environment === null ? null : (environments.find((candidate) => same(candidate.name, environment))?.icon ?? null);
    const created: FleetGroup = { environment, icon, servers: [], loose: [] };
    groups.push(created);
    return created;
  }

  for (const domain of domains) {
    const server = domain.sshHostId === null ? undefined : serverById.get(domain.sshHostId);
    if (server !== undefined) server.domains.push(domain);
    else groupFor(domain.environmentName).loose.push(domain);
  }

  const named = groups
    .filter((group) => group.environment !== null)
    .sort(
      (a, b) =>
        environmentRank(a.environment ?? '') - environmentRank(b.environment ?? '') ||
        (a.environment ?? '').localeCompare(b.environment ?? '')
    );
  return [...named, ...groups.filter((group) => group.environment === null)];
}

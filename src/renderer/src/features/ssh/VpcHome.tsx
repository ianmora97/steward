import type { CheckKind, DomainOperational, DomainSummary } from '@shared/schemas/cloud';
import type { Environment } from '@shared/schemas/environments';
import type { SshConnectionState, SshHost } from '@shared/schemas/ssh';
import { EmptyState } from '../../components/EmptyState';
import { Icon, type IconName } from '../../components/Icon';
import { Badge, type BadgeTone } from '../../components/Badge';
import { StatusDot, type StatusTone } from '../../components/StatusDot';
import { environmentIcon, environmentTone } from '../../components/environment-meta';
import { CHECK_KIND_LABEL, PROXY_LABEL, certificateBadge, formatLatency, operationalBadge } from '../cloud/cloud-meta';
import { groupFleet, type FleetServer } from './fleet-groups';
import { AWS_REGIONS, CONNECTION_LABEL, NO_ENVIRONMENT, destinationOf, fileNameOf, sinceLabel } from './ssh-meta';
import { ProviderLogo } from './ProviderLogo';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';

type Bucket = 'reachable' | 'attention' | 'down' | 'untested';

/** Reachable, needs the user (trust a key, fix the login), unreachable, never checked. */
const BUCKET: Record<SshConnectionState, Bucket> = {
  connected: 'reachable',
  auth_failed: 'attention',
  host_key_unknown: 'attention',
  host_key_changed: 'attention',
  unreachable: 'down',
  timeout: 'down',
  error: 'down',
  unknown: 'untested'
};

const BUCKET_BADGE: Record<Bucket, { tone: BadgeTone; icon: 'checkCircle' | 'alert' | 'xCircle' | 'minusCircle' }> = {
  reachable: { tone: 'success', icon: 'checkCircle' },
  attention: { tone: 'warning', icon: 'alert' },
  down: { tone: 'failure', icon: 'xCircle' },
  untested: { tone: 'neutral', icon: 'minusCircle' }
};

const SUMMARY: Array<{ bucket: Bucket; label: string; icon: IconName }> = [
  { bucket: 'reachable', label: 'Reachable', icon: 'checkCircle' },
  { bucket: 'attention', label: 'Needs attention', icon: 'alert' },
  { bucket: 'down', label: 'Unreachable', icon: 'xCircle' },
  { bucket: 'untested', label: 'Not checked', icon: 'minusCircle' }
];

const BUCKET_DOT: Record<Bucket, StatusTone> = { reachable: 'ok', attention: 'warn', down: 'danger', untested: 'idle' };

const DOMAIN_DOT: Record<DomainOperational, StatusTone> = { healthy: 'ok', degraded: 'warn', failing: 'danger', unknown: 'idle' };

/** The domain counters shown next to the servers', in the same order of severity. */
const DOMAIN_SUMMARY: Array<{ state: DomainOperational; label: string }> = [
  { state: 'healthy', label: 'Healthy' },
  { state: 'degraded', label: 'Degraded' },
  { state: 'failing', label: 'Failing' },
  { state: 'unknown', label: 'Not checked' }
];

const CHECK_ORDER: readonly CheckKind[] = ['dns', 'tls', 'http'];

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** One line for the fleet panel: how many domains, and how many of them are not fine. */
function domainsLine(domains: DomainSummary[]): string {
  const failing = domains.filter((domain) => domain.operational === 'failing').length;
  const degraded = domains.filter((domain) => domain.operational === 'degraded').length;
  const trouble = [failing > 0 ? `${failing} failing` : null, degraded > 0 ? `${degraded} degraded` : null].filter((part) => part !== null);
  return `${plural(domains.length, 'domain', 'domains')}${trouble.length === 0 ? '' : ` (${trouble.join(', ')})`}`;
}

/** DNS, certificate and web page at a glance: one dot each, grey where there is no such check. */
function CheckDots({ domain }: { domain: DomainSummary }): React.JSX.Element {
  return (
    <span className="vpcdom__dots">
      {CHECK_ORDER.map((kind) => {
        const state = domain.checkStates[kind];
        return (
          <StatusDot
            key={kind}
            tone={state === null ? 'idle' : DOMAIN_DOT[state]}
            size={7}
            label={`${CHECK_KIND_LABEL[kind]}: ${state === null ? 'no check' : state}`}
          />
        );
      })}
    </span>
  );
}

/** A domain inside the card of the server that serves it: its checks, its certificate and how it answered. */
function DomainLine({ domain, now, onOpen }: { domain: DomainSummary; now: number; onOpen: () => void }): React.JSX.Element {
  const operational = operationalBadge(domain.operational);
  const certificate = domain.certDaysLeft === null ? null : certificateBadge(domain.certDaysLeft);
  const facts = [
    domain.latencyMs === null ? null : formatLatency(domain.latencyMs),
    domain.lastCheckedAt === null ? 'not checked yet' : `checked ${sinceLabel(domain.lastCheckedAt, now)} ago`
  ].filter((fact) => fact !== null);

  return (
    <button type="button" className={`vpcdom vpcdom--${domain.operational}`} onClick={onOpen} title="Open its checks">
      <CheckDots domain={domain} />
      <span className="vpcdom__body">
        <span className="vpcdom__name">{domain.hostname}</span>
        <span className="vpcdom__facts">{facts.join(' · ')}</span>
      </span>
      <span className="vpcdom__badges">
        {domain.proxy !== null && <Badge tone="neutral" size="sm">{PROXY_LABEL[domain.proxy]}</Badge>}
        {certificate !== null && (
          <Badge tone={certificate.tone} size="sm">
            {certificate.label}
          </Badge>
        )}
        <Badge tone={operational.tone} icon={operational.icon} size="sm">
          {operational.label}
        </Badge>
      </span>
      <Icon name="chevronRight" size={14} />
    </button>
  );
}

/** The domains of a card, with the way to add one more to the same server. */
function DomainsBlock({
  domains,
  now,
  onOpenDomain,
  onAddDomain
}: {
  domains: DomainSummary[];
  now: number;
  onOpenDomain: (domainId: string) => void;
  onAddDomain: () => void;
}): React.JSX.Element {
  return (
    <div className="vpcdomains">
      <div className="vpcdomains__head">
        <Icon name="globe" size={12} />
        <span className="vpcdomains__title">{domains.length === 0 ? 'No domains' : plural(domains.length, 'domain', 'domains')}</span>
        <IconButton icon="plus" label="Add a domain to this server" onClick={onAddDomain} />
      </div>
      {domains.length === 0 ? (
        <p className="vpcdomains__empty">Add the domain this server answers for to watch its DNS, certificate and page.</p>
      ) : (
        domains.map((domain) => <DomainLine key={domain.id} domain={domain} now={now} onOpen={() => onOpenDomain(domain.id)} />)
      )}
    </div>
  );
}

function regionLabel(region: string): string {
  const known = AWS_REGIONS.find((entry) => entry.code === region);
  return known === undefined ? region : `${region} · ${known.label}`;
}

function Fact({ icon, label, value, sub }: { icon: IconName; label: string; value: string; sub?: string | null }): React.JSX.Element {
  const hint = sub ? `${label}: ${value} (${sub})` : `${label}: ${value}`;
  return (
    <div className="vpcfact" title={hint}>
      <Icon name={icon} size={13} />
      <span className="vpcfact__text">
        <span className="vpcfact__label">{label}</span>
        <span className="vpcfact__value">{value}</span>
        {sub ? <span className="vpcfact__sub">{sub}</span> : null}
      </span>
    </div>
  );
}

function ServerCard({
  server,
  index,
  busy,
  shellOpen,
  now,
  onTest,
  onConnect,
  onManage,
  onOpenDomain,
  onAddDomain
}: {
  server: FleetServer;
  index: number;
  busy: boolean;
  shellOpen: boolean;
  now: number;
  onTest: () => void;
  onConnect: () => void;
  onManage: () => void;
  onOpenDomain: (domainId: string) => void;
  onAddDomain: () => void;
}): React.JSX.Element {
  const { host, domains } = server;
  const bucket = BUCKET[host.connection.state];
  const badge = BUCKET_BADGE[bucket];
  const dot: StatusTone = busy ? 'busy' : BUCKET_DOT[bucket];
  const last = host.lastCommand;
  // The domain is already a row of its own below; repeating it as a fact only takes room.
  const domainShown = host.domain !== null && domains.some((domain) => domain.hostname === host.domain?.toLowerCase());

  return (
    <article className={`vpccard vpccard--${busy ? 'busy' : bucket}`} style={{ ['--i' as string]: index }}>
      <header className="vpccard__head">
        <StatusDot tone={dot} size={11} label={busy ? 'Checking' : CONNECTION_LABEL[host.connection.state]} />
        <button type="button" className="vpccard__name" onClick={onManage} title="Open the connection's details">
          {host.name}
        </button>
        {host.provider !== null && host.provider !== 'other' && <ProviderLogo provider={host.provider} />}
      </header>

      <code className="vpccard__dest" title={destinationOf(host)}>
        <span className="vpccard__prompt">$</span> ssh {destinationOf(host)}
      </code>

      {host.description !== null && <p className="vpccard__about">{host.description}</p>}

      <div className="vpccard__status">
        <Badge tone={busy ? 'running' : badge.tone} icon={busy ? 'loader' : badge.icon} title={host.connection.message ?? undefined}>
          {busy ? 'Checking…' : CONNECTION_LABEL[host.connection.state]}
        </Badge>
        <span className="vpccard__since">
          <Icon name="clock" size={12} />
          {host.connection.checkedAt === null ? 'never checked' : `checked ${sinceLabel(host.connection.checkedAt, now)} ago`}
        </span>
        {shellOpen && (
          <Badge tone="info" icon="terminal">
            Shell open
          </Badge>
        )}
      </div>

      <div className="vpccard__facts">
        {host.region !== null && <Fact icon="mapPin" label="Region" value={regionLabel(host.region)} />}
        {host.ipAddress !== null && <Fact icon="network" label="IP" value={host.ipAddress} />}
        {host.domain !== null && !domainShown && <Fact icon="globe" label="Domain" value={host.domain} />}
        {(host.vpcName !== null || host.vpcId !== null) && (
          <Fact icon="cloud" label="VPC" value={host.vpcName ?? host.vpcId ?? ''} sub={host.vpcName !== null ? (host.vpcCidr ?? host.vpcId) : host.vpcCidr} />
        )}
        {host.vpcName === null && host.vpcId === null && host.vpcCidr !== null && <Fact icon="cloud" label="CIDR" value={host.vpcCidr} />}
        {host.identityFile !== null && <Fact icon="key" label="Key" value={fileNameOf(host.identityFile)} />}
      </div>

      <DomainsBlock domains={domains} now={now} onOpenDomain={onOpenDomain} onAddDomain={onAddDomain} />

      {last !== null && (
        <div className={`vpccard__last vpccard__last--${host.operational}`} title={last.command}>
          <Icon name={host.operational === 'healthy' ? 'checkCircle' : 'xCircle'} size={13} />
          <code>{last.command}</code>
          <span>{sinceLabel(last.finishedAt, now)} ago</span>
        </div>
      )}

      {host.connection.hint !== null && bucket !== 'reachable' && <p className="vpccard__hint">{host.connection.hint}</p>}

      <footer className="vpccard__actions">
        <Button size="sm" icon="refresh" loading={busy} loadingLabel="Checking…" onClick={onTest}>
          Check
        </Button>
        <Button variant="primary" size="sm" icon="terminal" disabled={busy} onClick={onConnect}>
          Connect
        </Button>
        <span className="dpitem__spacer" />
        <IconButton icon="gear" label="Manage" onClick={onManage} />
      </footer>
    </article>
  );
}

/** The domains of an environment that are on no server of the project: a CDN, a static site, another provider. */
function LooseCard({
  domains,
  index,
  now,
  onOpenDomain,
  onAddDomain
}: {
  domains: DomainSummary[];
  index: number;
  now: number;
  onOpenDomain: (domainId: string) => void;
  onAddDomain: () => void;
}): React.JSX.Element {
  return (
    <article className="vpccard vpccard--loose" style={{ ['--i' as string]: index }}>
      <header className="vpccard__head">
        <span className="vpccard__globe">
          <Icon name="globe" size={14} />
        </span>
        <span className="vpccard__name vpccard__name--plain">Without a server</span>
      </header>
      <p className="vpccard__about">Domains served from somewhere Steward does not reach over SSH: a CDN, a static site, another provider.</p>
      <DomainsBlock domains={domains} now={now} onOpenDomain={onOpenDomain} onAddDomain={onAddDomain} />
    </article>
  );
}

/**
 * The VPC tab: every environment of the project with its servers, the domains each one serves and what their
 * checks say. Opening a server goes to its settings and history, opening a domain to its checks.
 */
export function VpcHome({
  hosts,
  domains,
  environments,
  activeHostIds,
  checking,
  now,
  onTest,
  onTestAll,
  onConnect,
  onManage,
  onNew,
  onOpenDomain,
  onAddDomain
}: {
  hosts: SshHost[];
  domains: DomainSummary[];
  environments: Environment[];
  /** Connections with a running shell. */
  activeHostIds: ReadonlySet<string>;
  /** Ids being checked right now. */
  checking: ReadonlySet<string>;
  now: number;
  onTest: (host: SshHost) => void;
  onTestAll: () => void;
  onConnect: (host: SshHost) => void;
  onManage: (host: SshHost) => void;
  onNew: () => void;
  onOpenDomain: (domainId: string) => void;
  /** Adds a domain, already on that server when one asked for it. */
  onAddDomain: (sshHostId: string | null) => void;
}): React.JSX.Element {
  if (hosts.length === 0 && domains.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        description="Add the servers and bastion hosts you reach over SSH and the domains your apps are served from. Steward then shows which ones answer, grouped by environment."
      >
        <Button variant="primary" icon="plus" onClick={onNew}>
          New connection
        </Button>
        <Button icon="globe" onClick={() => onAddDomain(null)}>
          Add a domain
        </Button>
      </EmptyState>
    );
  }

  const counts: Record<Bucket, number> = { reachable: 0, attention: 0, down: 0, untested: 0 };
  for (const host of hosts) counts[BUCKET[host.connection.state]] += 1;
  const domainCounts: Record<DomainOperational, number> = { healthy: 0, degraded: 0, failing: 0, unknown: 0 };
  for (const domain of domains) domainCounts[domain.operational] += 1;
  const groups = groupFleet(hosts, domains, environments);
  const anyChecking = checking.size > 0;
  const total = hosts.length;
  const lastCheck = hosts.reduce<string | null>((latest, host) => {
    const at = host.connection.checkedAt;
    return at !== null && (latest === null || Date.parse(at) > Date.parse(latest)) ? at : latest;
  }, null);
  const providers = new Set(hosts.flatMap((host) => (host.provider === null ? [] : [host.provider])));
  const protectedNames = new Set(environments.filter((environment) => environment.isProtected).map((environment) => environment.name.toLowerCase()));

  return (
    <div className="vpchome">
      {hosts.length === 0 && (
        <div className="vpcnote">
          <p className="card__hint">
            No servers yet, only domains. Add the connections you reach over SSH to see each domain under the server that serves it.
          </p>
          <Button icon="plus" onClick={onNew}>
            New connection
          </Button>
        </div>
      )}

      {hosts.length > 0 && (
        <section className="vpcfleet" aria-label="Fleet status">
          <div className="vpcfleet__top">
            <div className="vpcfleet__meta">
              <span className="vpcfleet__total">{total}</span>
              <span className="vpcfleet__text">
                {total === 1 ? 'connection' : 'connections'} · {groups.length} {groups.length === 1 ? 'environment' : 'environments'}
                {providers.size > 0 ? ` · ${providers.size} ${providers.size === 1 ? 'provider' : 'providers'}` : ''}
                {' · '}
                {lastCheck === null ? 'never checked' : `last check ${sinceLabel(lastCheck, now)} ago`}
                {domains.length > 0 ? ` · ${domainsLine(domains)}` : ''}
                {activeHostIds.size > 0 ? ` · ${activeHostIds.size} ${activeHostIds.size === 1 ? 'shell' : 'shells'} open` : ''}
              </span>
            </div>
            <Button icon="refresh" loading={anyChecking} loadingLabel="Checking…" onClick={onTestAll}>
              Check all
            </Button>
          </div>

          <div className="vpcstats">
            {SUMMARY.map(({ bucket, label, icon }, index) => (
              <div key={bucket} className={`vpcstat vpcstat--${bucket}`} style={{ ['--i' as string]: index }}>
                <span className="vpcstat__icon">
                  <Icon name={icon} size={22} />
                </span>
                <span className="vpcstat__body">
                  <span className="vpcstat__value">{counts[bucket]}</span>
                  <span className="vpcstat__label">{label}</span>
                </span>
                <span className="vpcstat__share">{Math.round((counts[bucket] / total) * 100)}%</span>
              </div>
            ))}
          </div>

          <div className="vpcbar" role="img" aria-label={SUMMARY.map(({ bucket, label }) => `${counts[bucket]} ${label.toLowerCase()}`).join(', ')}>
            {SUMMARY.map(({ bucket, label }) =>
              counts[bucket] === 0 ? null : (
                <span key={bucket} className={`vpcbar__part vpcbar__part--${bucket}`} style={{ flexGrow: counts[bucket] }} title={`${counts[bucket]} ${label.toLowerCase()}`} />
              )
            )}
          </div>

          {domains.length > 0 && (
            <div className="vpcdomstats" aria-label="Domain status">
              <span className="vpcdomstats__label">
                <Icon name="globe" size={13} />
                Domains
              </span>
              {DOMAIN_SUMMARY.map(({ state, label }) => (
                <span key={state} className={`vpcdomstat vpcdomstat--${state}`} title={`${domainCounts[state]} ${label.toLowerCase()}`}>
                  <StatusDot tone={DOMAIN_DOT[state]} size={8} />
                  <strong>{domainCounts[state]}</strong>
                  {label}
                </span>
              ))}
              <span className="dpitem__spacer" />
              <Button size="sm" icon="plus" onClick={() => onAddDomain(null)}>
                Add domain
              </Button>
            </div>
          )}
        </section>
      )}

      {groups.map((group) => {
        const name = group.environment ?? NO_ENVIRONMENT;
        const groupDomains = [...group.servers.flatMap((server) => server.domains), ...group.loose];
        return (
          <section key={name} className="vpcgroup">
            <h3 className="vpcgroup__title" style={{ ['--env' as string]: environmentTone(group.environment) }}>
              <span className="vpcgroup__icon">
                <Icon name={environmentIcon(group.environment, group.icon)} size={16} />
              </span>
              {name}
              {group.environment !== null && protectedNames.has(group.environment.toLowerCase()) && (
                <span className="vpcgroup__protected" title="Protected: a deploy here asks you to type the environment name">
                  <Icon name="shield" size={13} />
                  Protected
                </span>
              )}
              {group.servers.length > 0 && <span className="vpcgroup__count">{plural(group.servers.length, 'server', 'servers')}</span>}
              {groupDomains.length > 0 && <span className="vpcgroup__count">{plural(groupDomains.length, 'domain', 'domains')}</span>}
              <span className="vpcgroup__dots" aria-hidden="true">
                {group.servers.map((server) => (
                  <StatusDot
                    key={server.host.id}
                    tone={checking.has(server.host.id) ? 'busy' : BUCKET_DOT[BUCKET[server.host.connection.state]]}
                    size={7}
                  />
                ))}
                {groupDomains.map((domain) => (
                  <StatusDot key={domain.id} tone={DOMAIN_DOT[domain.operational]} size={7} />
                ))}
              </span>
            </h3>

            <div className="vpcgrid">
              {group.servers.map((server, index) => (
                <ServerCard
                  key={server.host.id}
                  server={server}
                  index={index}
                  busy={checking.has(server.host.id)}
                  shellOpen={activeHostIds.has(server.host.id)}
                  now={now}
                  onTest={() => onTest(server.host)}
                  onConnect={() => onConnect(server.host)}
                  onManage={() => onManage(server.host)}
                  onOpenDomain={onOpenDomain}
                  onAddDomain={() => onAddDomain(server.host.id)}
                />
              ))}
              {group.loose.length > 0 && (
                <LooseCard
                  domains={group.loose}
                  index={group.servers.length}
                  now={now}
                  onOpenDomain={onOpenDomain}
                  onAddDomain={() => onAddDomain(null)}
                />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

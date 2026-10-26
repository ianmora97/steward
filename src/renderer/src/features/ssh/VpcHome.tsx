import type { Environment } from '@shared/schemas/environments';
import type { SshConnectionState, SshHost } from '@shared/schemas/ssh';
import { EmptyState } from '../../components/EmptyState';
import { Icon, type IconName } from '../../components/Icon';
import { Badge, type BadgeTone } from '../../components/Badge';
import { StatusDot, type StatusTone } from '../../components/StatusDot';
import { environmentIcon, environmentTone } from '../../components/environment-meta';
import { AWS_REGIONS, CONNECTION_LABEL, NO_ENVIRONMENT, destinationOf, fileNameOf, groupByEnvironment, sinceLabel } from './ssh-meta';
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

/**
 * The first thing the VPC tab shows: every connection of the project at a glance, by environment, with whether
 * it answered the last time it was checked. Opening one goes to the manager.
 */
export function VpcHome({
  hosts,
  environments,
  activeHostIds,
  checking,
  now,
  onTest,
  onTestAll,
  onConnect,
  onManage,
  onNew
}: {
  hosts: SshHost[];
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
}): React.JSX.Element {
  if (hosts.length === 0) {
    return (
      <EmptyState title="No VPC connections yet" description="Add the servers and bastion hosts you reach over SSH. Steward then shows which ones answer, grouped by environment.">
        <Button variant="primary" icon="plus" onClick={onNew}>
          New connection
        </Button>
      </EmptyState>
    );
  }

  const counts: Record<Bucket, number> = { reachable: 0, attention: 0, down: 0, untested: 0 };
  for (const host of hosts) counts[BUCKET[host.connection.state]] += 1;
  const groups = groupByEnvironment(hosts);
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
      <section className="vpcfleet" aria-label="Fleet status">
        <div className="vpcfleet__top">
          <div className="vpcfleet__meta">
            <span className="vpcfleet__total">{total}</span>
            <span className="vpcfleet__text">
              {total === 1 ? 'connection' : 'connections'} · {groups.length} {groups.length === 1 ? 'environment' : 'environments'}
              {providers.size > 0 ? ` · ${providers.size} ${providers.size === 1 ? 'provider' : 'providers'}` : ''}
              {' · '}
              {lastCheck === null ? 'never checked' : `last check ${sinceLabel(lastCheck, now)} ago`}
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
      </section>

      {groups.map((group) => {
        const name = group.environment ?? NO_ENVIRONMENT;
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
              <span className="vpcgroup__count">{group.hosts.length}</span>
              <span className="vpcgroup__dots" aria-hidden="true">
                {group.hosts.map((host) => (
                  <StatusDot key={host.id} tone={checking.has(host.id) ? 'busy' : BUCKET_DOT[BUCKET[host.connection.state]]} size={7} />
                ))}
              </span>
            </h3>
            <div className="vpcgrid">
              {group.hosts.map((host) => {
                const bucket = BUCKET[host.connection.state];
                const badge = BUCKET_BADGE[bucket];
                const busy = checking.has(host.id);
                const dot: StatusTone = busy ? 'busy' : BUCKET_DOT[bucket];
                const last = host.lastCommand;
                return (
                  <article key={host.id} className={`vpccard vpccard--${busy ? 'busy' : bucket}`} style={{ ['--i' as string]: hosts.indexOf(host) }}>
                    <header className="vpccard__head">
                      <StatusDot tone={dot} size={11} label={busy ? 'Checking' : CONNECTION_LABEL[host.connection.state]} />
                      <button type="button" className="vpccard__name" onClick={() => onManage(host)} title="Open the connection's details">
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
                      {activeHostIds.has(host.id) && (
                        <Badge tone="info" icon="terminal">
                          Shell open
                        </Badge>
                      )}
                    </div>

                    <div className="vpccard__facts">
                      {host.region !== null && <Fact icon="mapPin" label="Region" value={regionLabel(host.region)} />}
                      {host.ipAddress !== null && <Fact icon="network" label="IP" value={host.ipAddress} />}
                      {host.domain !== null && <Fact icon="globe" label="Domain" value={host.domain} />}
                      {(host.vpcName !== null || host.vpcId !== null) && (
                        <Fact icon="cloud" label="VPC" value={host.vpcName ?? host.vpcId ?? ''} sub={host.vpcName !== null ? (host.vpcCidr ?? host.vpcId) : host.vpcCidr} />
                      )}
                      {host.vpcName === null && host.vpcId === null && host.vpcCidr !== null && <Fact icon="cloud" label="CIDR" value={host.vpcCidr} />}
                      {host.identityFile !== null && <Fact icon="key" label="Key" value={fileNameOf(host.identityFile)} />}
                    </div>

                    {last !== null && (
                      <div className={`vpccard__last vpccard__last--${host.operational}`} title={last.command}>
                        <Icon name={host.operational === 'healthy' ? 'checkCircle' : 'xCircle'} size={13} />
                        <code>{last.command}</code>
                        <span>{sinceLabel(last.finishedAt, now)} ago</span>
                      </div>
                    )}

                    {host.connection.hint !== null && bucket !== 'reachable' && <p className="vpccard__hint">{host.connection.hint}</p>}

                    <footer className="vpccard__actions">
                      <Button size="sm" icon="refresh" loading={busy} loadingLabel="Checking…" onClick={() => onTest(host)}>
                        Check
                      </Button>
                      <Button variant="primary" size="sm" icon="terminal" disabled={busy} onClick={() => onConnect(host)}>
                        Connect
                      </Button>
                      <span className="dpitem__spacer" />
                      <IconButton icon="gear" label="Manage" onClick={() => onManage(host)} />
                    </footer>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

import type { SshConnectionState, SshHost } from '@shared/schemas/ssh';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { Pill, type PillTone } from '../../components/Pill';
import { CONNECTION_LABEL, NO_ENVIRONMENT, PROVIDER_LABELS, destinationOf, groupByEnvironment, isProduction, sinceLabel } from './ssh-meta';

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

const BUCKET_PILL: Record<Bucket, { tone: PillTone; icon: 'checkCircle' | 'alert' | 'xCircle' | 'minusCircle' }> = {
  reachable: { tone: 'success', icon: 'checkCircle' },
  attention: { tone: 'warning', icon: 'alert' },
  down: { tone: 'failure', icon: 'xCircle' },
  untested: { tone: 'neutral', icon: 'minusCircle' }
};

const SUMMARY: Array<{ bucket: Bucket; label: string }> = [
  { bucket: 'reachable', label: 'Reachable' },
  { bucket: 'attention', label: 'Needs attention' },
  { bucket: 'down', label: 'Unreachable' },
  { bucket: 'untested', label: 'Not checked' }
];

/**
 * The first thing the VPC tab shows: every connection of the project at a glance, by environment, with whether
 * it answered the last time it was checked. Opening one goes to the manager.
 */
export function VpcHome({
  hosts,
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
        <button type="button" className="button button--primary" onClick={onNew}>
          <Icon name="plus" size={14} /> New connection
        </button>
      </EmptyState>
    );
  }

  const counts: Record<Bucket, number> = { reachable: 0, attention: 0, down: 0, untested: 0 };
  for (const host of hosts) counts[BUCKET[host.connection.state]] += 1;
  const groups = groupByEnvironment(hosts);
  const anyChecking = checking.size > 0;

  return (
    <div className="vpchome">
      <div className="vpchome__summary">
        {SUMMARY.map(({ bucket, label }) => (
          <div key={bucket} className={`vpcstat vpcstat--${bucket}`}>
            <span className="vpcstat__value">{counts[bucket]}</span>
            <span className="vpcstat__label">{label}</span>
          </div>
        ))}
        <span className="dpitem__spacer" />
        <button type="button" className="button" disabled={anyChecking} onClick={onTestAll}>
          <Icon name="refresh" size={14} /> {anyChecking ? 'Checking…' : 'Check all'}
        </button>
      </div>

      {groups.map((group) => {
        const name = group.environment ?? NO_ENVIRONMENT;
        return (
          <section key={name} className="vpcgroup">
            <h3 className="vpcgroup__title">
              {name}
              {isProduction(group.environment) && <Icon name="shield" size={14} />}
              <span className="vpcgroup__count">{group.hosts.length}</span>
            </h3>
            <div className="vpcgrid">
              {group.hosts.map((host) => {
                const bucket = BUCKET[host.connection.state];
                const pill = BUCKET_PILL[bucket];
                const busy = checking.has(host.id);
                return (
                  <article key={host.id} className={`vpccard vpccard--${bucket}`}>
                    <header className="vpccard__head">
                      <button type="button" className="vpccard__name" onClick={() => onManage(host)} title="Open the connection's details">
                        {host.name}
                      </button>
                      {host.provider !== null && host.provider !== 'other' && <span className="vpccard__provider">{PROVIDER_LABELS[host.provider]}</span>}
                    </header>
                    <code className="vpccard__dest" title={destinationOf(host)}>
                      {destinationOf(host)}
                    </code>
                    <div className="vpccard__status">
                      <Pill tone={busy ? 'running' : pill.tone} icon={busy ? 'loader' : pill.icon} title={host.connection.message ?? undefined}>
                        {busy ? 'Checking…' : CONNECTION_LABEL[host.connection.state]}
                      </Pill>
                      <span className="card__hint">
                        {host.connection.checkedAt === null ? 'never checked' : `checked ${sinceLabel(host.connection.checkedAt, now)} ago`}
                      </span>
                    </div>
                    <div className="vpccard__facts">
                      {activeHostIds.has(host.id) && (
                        <Pill tone="info" icon="terminal">
                          Shell open
                        </Pill>
                      )}
                      {host.operational !== 'none' && (
                        <Pill tone={host.operational === 'healthy' ? 'success' : 'failure'} title={host.lastCommand?.command}>
                          Last command {host.operational === 'healthy' ? 'worked' : 'failed'}
                        </Pill>
                      )}
                    </div>
                    {host.connection.hint !== null && bucket !== 'reachable' && <p className="card__hint vpccard__hint">{host.connection.hint}</p>}
                    <footer className="vpccard__actions">
                      <button type="button" className="button button--small" disabled={busy} onClick={() => onTest(host)}>
                        Check
                      </button>
                      <button type="button" className="button button--small button--primary" disabled={busy} onClick={() => onConnect(host)}>
                        <Icon name="terminal" size={13} /> Connect
                      </button>
                      <span className="dpitem__spacer" />
                      <button type="button" className="iconbutton" aria-label={`Manage ${host.name}`} title="Manage" onClick={() => onManage(host)}>
                        <Icon name="gear" size={15} />
                      </button>
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

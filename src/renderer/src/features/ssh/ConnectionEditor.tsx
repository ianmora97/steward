import { useEffect, useRef, useState } from 'react';
import type { Environment } from '@shared/schemas/environments';
import type { Execution } from '@shared/schemas/git';
import { SSH_PROVIDERS, type SshHost, type SshProvider } from '@shared/schemas/ssh';
import type { TerminalSession } from '@shared/schemas/terminal';
import type { StewardError } from '@shared/types/result';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Icon } from '../../components/Icon';
import { EnvironmentEditor } from '../deployments/EnvironmentEditor';
import { CommandRunner, RemoteHistory } from './SshSession';
import {
  AWS_REGIONS,
  CONNECTION_LABEL,
  PROVIDER_LABELS,
  durationLabel,
  fileNameOf,
  sinceLabel
} from './ssh-meta';
import { IconButton } from '../../components/IconButton';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';

/** The select option that opens the "new environment" dialog instead of choosing one. */
const NEW_ENVIRONMENT = '__new__';

export interface HostFields {
  name: string;
  host: string;
  port: number | null;
  username: string | null;
  identityFile: string | null;
  environmentId: string | null;
  provider: SshProvider | null;
  region: string | null;
  domain: string | null;
  ipAddress: string | null;
  description: string | null;
  vpcName: string | null;
  vpcId: string | null;
  vpcCidr: string | null;
}

/** The form edits strings; an empty box means "not set" and is saved as null. */
interface Draft {
  name: string;
  vpcName: string;
  /** '' = no environment. */
  environmentId: string;
  provider: SshProvider | '';
  region: string;
  vpcId: string;
  vpcCidr: string;
  /** Which address ssh connects to. The other one is kept as a reference. */
  via: 'domain' | 'ip';
  domain: string;
  ip: string;
  username: string;
  port: string;
  identityFile: string | null;
}

function draftFromHost(host: SshHost | null): Draft {
  const viaIp = host !== null && host.ipAddress !== null && host.host === host.ipAddress;
  return {
    name: host?.name ?? '',
    vpcName: host?.vpcName ?? '',
    environmentId: host?.environmentId ?? '',
    provider: host === null ? 'aws' : (host.provider ?? ''),
    region: host?.region ?? '',
    vpcId: host?.vpcId ?? '',
    vpcCidr: host?.vpcCidr ?? '',
    via: viaIp ? 'ip' : 'domain',
    // A server saved before domain/IP existed keeps its address in `host`; it shows up as the domain.
    domain: host?.domain ?? (host !== null && !viaIp ? host.host : ''),
    ip: host?.ipAddress ?? '',
    username: host?.username ?? '',
    port: host === null || host.port === null ? '' : String(host.port),
    identityFile: host?.identityFile ?? null
  };
}

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

function fieldsFromDraft(draft: Draft, host: SshHost | null): HostFields | StewardError {
  const target = (draft.via === 'domain' ? draft.domain : draft.ip).trim();
  if (target === '') {
    return {
      code: 'VALIDATION_FAILED',
      message: draft.via === 'domain' ? 'Enter the domain to connect to' : 'Enter the IP address to connect to'
    };
  }
  const port = draft.port.trim() === '' ? null : Number(draft.port);
  if (port !== null && !Number.isInteger(port)) {
    return { code: 'VALIDATION_FAILED', message: 'The SSH port must be a whole number' };
  }
  return {
    name: draft.name,
    host: target,
    port,
    username: orNull(draft.username),
    identityFile: draft.identityFile,
    environmentId: orNull(draft.environmentId),
    provider: draft.provider === '' ? null : draft.provider,
    region: orNull(draft.region),
    domain: orNull(draft.domain),
    ipAddress: orNull(draft.ip),
    description: host?.description ?? null,
    vpcName: orNull(draft.vpcName),
    vpcId: orNull(draft.vpcId),
    vpcCidr: orNull(draft.vpcCidr)
  };
}

function isFields(value: HostFields | StewardError): value is HostFields {
  return 'host' in value;
}

type Tab = 'configuration' | 'history';

export function ConnectionEditor({
  host,
  projectId,
  environments,
  onEnvironmentCreated,
  history,
  sessions,
  hostsById,
  now,
  busy,
  onSave,
  onTest,
  onConnect,
  onReview,
  onDelete,
  onRan,
  onOpenSession
}: {
  /** null = a connection that has not been saved yet. */
  host: SshHost | null;
  projectId: string;
  environments: Environment[];
  /** A new environment was created from this form; the parent adds it to its list. */
  onEnvironmentCreated: (environment: Environment) => void;
  history: Execution[];
  /** Running remote shells of the project, every connection included. */
  sessions: TerminalSession[];
  hostsById: ReadonlyMap<string, SshHost>;
  now: number;
  busy: boolean;
  onSave: (fields: HostFields) => Promise<StewardError | null>;
  onTest: () => void;
  onConnect: () => void;
  onReview: () => void;
  onDelete: () => void;
  onRan: () => void;
  onOpenSession: (sessionId: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => draftFromHost(host));
  const [tab, setTab] = useState<Tab>('configuration');
  const [error, setError] = useState<StewardError | null>(null);
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [creatingEnvironment, setCreatingEnvironment] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent): void {
      if (menuRef.current !== null && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft((current) => ({ ...current, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFromHost(host));
  const chosenEnvironment = environments.find((environment) => environment.id === draft.environmentId) ?? null;
  const prod = chosenEnvironment?.kind === 'production';
  const awsRegion = draft.provider === 'aws';

  async function save(): Promise<void> {
    const fields = fieldsFromDraft(draft, host);
    if (!isFields(fields)) {
      setError(fields);
      return;
    }
    setSaving(true);
    const failure = await onSave(fields);
    setSaving(false);
    setError(failure);
  }

  async function chooseKey(): Promise<void> {
    const picked = await window.steward.ssh.pickKeyFile();
    if (!picked.success) {
      setError(picked.error);
      return;
    }
    if (!picked.data.cancelled && picked.data.localPath !== null) set('identityFile', picked.data.localPath);
  }

  const ownSession = host === null ? undefined : sessions.find((session) => session.sshHostId === host.id);
  const elsewhere = sessions.filter((session) => session.sshHostId !== host?.id);
  const lastShell = history.find((execution) => execution.kind === 'ssh_shell');
  const state = host?.connection.state ?? 'unknown';
  const statusLabel = ownSession !== undefined ? 'SSH active' : CONNECTION_LABEL[state];
  const subtitle = [draft.vpcId.trim() === '' ? null : draft.vpcId.trim(), draft.region.trim() === '' ? null : draft.region.trim()]
    .filter((part): part is string => part !== null)
    .join(' · ');
  const target = (draft.via === 'domain' ? draft.domain : draft.ip).trim();
  const regionKnown = AWS_REGIONS.some((region) => region.code === draft.region);

  return (
    <section className="sshdetail">
      {creatingEnvironment && (
        <EnvironmentEditor
          projectId={projectId}
          environment={null}
          onSaved={(created) => {
            onEnvironmentCreated(created);
            set('environmentId', created.id);
          }}
          onClose={() => setCreatingEnvironment(false)}
        />
      )}
      <header className="sshdetail__head">
        <span className="sshdetail__icon" aria-hidden="true">
          <Icon name="ssh" size={26} />
        </span>
        <div className="sshdetail__titles">
          <h2 className="sshdetail__title">
            <span>{draft.name.trim() === '' ? 'New connection' : draft.name}</span>
            {chosenEnvironment !== null && (
              <span className={`sshenv${prod ? ' sshenv--prod' : ''}`}>{chosenEnvironment.name}</span>
            )}
          </h2>
          {subtitle !== '' && <p className="sshdetail__subtitle">{subtitle}</p>}
        </div>
        <span className={`sshsaved${dirty ? ' sshsaved--dirty' : ''}`}>
          {dirty ? (
            'Unsaved changes'
          ) : (
            <>
              <Icon name="check" size={14} /> All changes saved
            </>
          )}
        </span>
        {host !== null && (
          <div className="sshmenu" ref={menuRef}>
            <IconButton icon="dots" size={18} label="More actions" expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} />
            {menuOpen && (
              <div className="sshmenu__list" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="sshmenu__item sshmenu__item--danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                >
                  <Icon name="trash" size={14} /> Delete connection
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      <nav className="sshtabs" aria-label="Connection sections">
        <button type="button" className={`sshtabs__tab${tab === 'configuration' ? ' sshtabs__tab--active' : ''}`} onClick={() => setTab('configuration')}>
          Configuration
        </button>
        <button type="button" className={`sshtabs__tab${tab === 'history' ? ' sshtabs__tab--active' : ''}`} onClick={() => setTab('history')}>
          Session history
        </button>
      </nav>

      <div className="sshdetail__scroll">
        {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

        {tab === 'history' ? (
          host === null ? (
            <p className="card__hint">Save the connection first: commands and sessions are recorded per connection.</p>
          ) : (
            <div className="sshhistory">
              <CommandRunner host={host} onRan={onRan} />
              <section className="sshrun">
                <h3 className="card__title">Remote history</h3>
                <RemoteHistory executions={history} />
              </section>
            </div>
          )
        ) : (
          <div className="sshconfig">
            <div className="sshconfig__main">
              {prod && (
                <p className="sshwarn">
                  <Icon name="shield" size={15} /> Production environment. Verify the host before connecting.
                </p>
              )}

              <div className="sshrow">
                <label className="field">
                  <span className="field__label">Connection name</span>
                  <input className="field__input" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Primary bastion" autoFocus={host === null} />
                </label>
                <label className="field">
                  <span className="field__label">VPC name</span>
                  <input className="field__input sshmono" value={draft.vpcName} onChange={(e) => set('vpcName', e.target.value)} placeholder="steward-prod-vpc" />
                </label>
              </div>

              <div className="sshrow sshrow--three">
                <label className="field">
                  <span className="field__label">Environment</span>
                  <select
                    className="field__input"
                    value={draft.environmentId}
                    onChange={(e) => {
                      if (e.target.value === NEW_ENVIRONMENT) setCreatingEnvironment(true);
                      else set('environmentId', e.target.value);
                    }}
                  >
                    <option value="">No environment</option>
                    {environments.map((environment) => (
                      <option key={environment.id} value={environment.id}>
                        {environment.name}
                      </option>
                    ))}
                    <option value={NEW_ENVIRONMENT}>+ New environment…</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Provider</span>
                  <select className="field__input" value={draft.provider} onChange={(e) => set('provider', e.target.value as SshProvider | '')}>
                    <option value="">Not set</option>
                    {SSH_PROVIDERS.map((value) => (
                      <option key={value} value={value}>
                        {PROVIDER_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">{awsRegion ? 'AWS region' : 'Region'}</span>
                  {awsRegion ? (
                    <select className="field__input" value={draft.region} onChange={(e) => set('region', e.target.value)}>
                      <option value="">Not set</option>
                      {!regionKnown && draft.region !== '' && <option value={draft.region}>{draft.region}</option>}
                      {AWS_REGIONS.map((region) => (
                        <option key={region.code} value={region.code}>
                          {region.code} ({region.label})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="field__input" value={draft.region} onChange={(e) => set('region', e.target.value)} placeholder="nyc3" />
                  )}
                </label>
              </div>

              <div className="sshrow">
                <label className="field">
                  <span className="field__label">VPC ID</span>
                  <input className="field__input sshmono" value={draft.vpcId} onChange={(e) => set('vpcId', e.target.value)} placeholder="vpc-0a1b2c3d4e5f67890" />
                </label>
                <label className="field">
                  <span className="field__label">VPC CIDR</span>
                  <input className="field__input sshmono" value={draft.vpcCidr} onChange={(e) => set('vpcCidr', e.target.value)} placeholder="10.20.0.0/16" />
                </label>
              </div>

              <div className="sshsection">
                <div className="sshsection__head">
                  <h3 className="sshsection__title">SSH host</h3>
                  <span className="sshsection__aside">Connect using one address</span>
                </div>
                <div className="sshrow">
                  {(['domain', 'ip'] as const).map((via) => (
                    <div key={via} className="sshaddress">
                      <label className="sshaddress__label">
                        <input type="radio" name="ssh-via" checked={draft.via === via} onChange={() => set('via', via)} />
                        <span>{via === 'domain' ? 'Domain' : 'IP address'}</span>
                        {draft.via === via && <span className="sshaddress__using">USING THIS</span>}
                      </label>
                      <input
                        className={`field__input sshmono${draft.via === via ? ' sshaddress__input--active' : ''}`}
                        value={via === 'domain' ? draft.domain : draft.ip}
                        onChange={(e) => set(via === 'domain' ? 'domain' : 'ip', e.target.value)}
                        placeholder={via === 'domain' ? 'bastion.prod.example.com' : '203.0.113.42'}
                        aria-label={via === 'domain' ? 'Domain' : 'IP address'}
                      />
                    </div>
                  ))}
                </div>
                <p className="sshhint">
                  {draft.via === 'domain' ? 'Domain' : 'IP address'} is selected. The other address is an alternative, not
                  an additional requirement. A ~/.ssh/config alias also works as the domain.
                </p>
                <div className="sshrow sshrow--port">
                  <label className="field">
                    <span className="field__label">SSH username</span>
                    <input className="field__input sshmono" value={draft.username} onChange={(e) => set('username', e.target.value)} placeholder="ec2-user" />
                  </label>
                  <label className="field">
                    <span className="field__label">SSH port</span>
                    <input className="field__input sshmono" value={draft.port} onChange={(e) => set('port', e.target.value)} inputMode="numeric" placeholder="22" />
                  </label>
                </div>
              </div>

              <div className="sshsection">
                <div className="sshsection__head">
                  <h3 className="sshsection__title">PEM key</h3>
                  <span className="sshsection__aside">Local file · public-key authentication</span>
                </div>
                <div className="sshkey">
                  <Icon name="file" size={20} />
                  <div className="sshkey__file">
                    {draft.identityFile === null ? (
                      <span className="sshkey__empty">No key file: ssh-agent and default keys are used</span>
                    ) : (
                      <>
                        <span className="sshkey__name">{fileNameOf(draft.identityFile)}</span>
                        <span className="sshkey__path" title={draft.identityFile}>
                          {draft.identityFile}
                        </span>
                      </>
                    )}
                  </div>
                  {draft.identityFile !== null && (
                    <IconButton icon="x" label="Remove key file" size={14} onClick={() => set('identityFile', null)} />
                  )}
                  <Button onClick={() => void chooseKey()}>
                    <Icon name="folder" size={14} /> Choose file
                  </Button>
                </div>
                <p className="sshhint">
                  <Icon name="lock" size={12} /> Only the file path is saved. Your private key stays on this device.
                </p>
              </div>
            </div>

            <aside className="sshconfig__side">
              <section className="sshcard">
                <h3 className="sshcard__title">Connection route</h3>
                <ol className="sshroute">
                  <li className="sshroute__node">
                    <span className="sshroute__icon"><Icon name="laptop" size={16} /></span>
                    <span className="sshroute__text">
                      <span className="sshroute__name">This machine</span>
                      <span className="sshroute__sub">{draft.identityFile === null ? 'ssh-agent / default keys' : 'Local PEM authentication'}</span>
                    </span>
                  </li>
                  <li className="sshroute__node">
                    <span className="sshroute__icon"><Icon name="network" size={16} /></span>
                    <span className="sshroute__text">
                      <span className="sshroute__name">{draft.vpcName.trim() === '' ? 'VPC' : draft.vpcName}</span>
                      <span className="sshroute__sub">
                        {[draft.vpcCidr.trim(), draft.region.trim()].filter((part) => part !== '').join(' · ') || 'No network details'}
                      </span>
                    </span>
                  </li>
                  <li className="sshroute__node">
                    <span className="sshroute__icon"><Icon name="ssh" size={16} /></span>
                    <span className="sshroute__text">
                      <span className="sshroute__name">{draft.name.trim() === '' ? 'Server' : draft.name}</span>
                      <span className="sshroute__sub">
                        {[draft.username.trim(), `TCP ${draft.port.trim() === '' ? '22' : draft.port.trim()}`].filter((part) => part !== '').join(' · ')}
                      </span>
                    </span>
                  </li>
                </ol>
                <p className="sshcard__note">
                  SSH opens a session to {target === '' ? 'the host' : <code>{target}</code>} inside this VPC.
                </p>
              </section>

              <section className="sshcard">
                <h3 className="sshcard__title">SSH session</h3>
                <p className={`sshstate sshstate--${ownSession !== undefined ? 'active' : state}`}>
                  <span className="sshstate__dot" /> {statusLabel}
                </p>
                <p className="sshcard__note">
                  {host === null
                    ? 'Save this configuration to test it and connect.'
                    : (host.connection.message ?? 'This configuration is saved. Connect to start a new SSH session.')}
                  {host?.connection.hint && <span> {host.connection.hint}</span>}
                </p>
                {host !== null && (
                  <div className="sshcard__actions">
                    {state === 'host_key_unknown' && (
                      <Button size="sm" onClick={onReview}>
                        Review host key
                      </Button>
                    )}
                    <Button size="sm" loading={busy} loadingLabel="Checking…" disabled={dirty} onClick={onTest}>Test connection</Button>
                  </div>
                )}
                <div className="sshcard__rule" />
                <p className="sshcard__label">LAST CONNECTED</p>
                <p className="sshcard__value">
                  {lastShell === undefined
                    ? 'Never from Steward'
                    : `${new Date(lastShell.startedAt).toLocaleString()}${lastShell.durationMs === null ? '' : ` · ${durationLabel(lastShell.durationMs)}`}`}
                </p>
              </section>

              {elsewhere.length > 0 && (
                <section className="sshcard">
                  <div className="sshcard__headline">
                    <h3 className="sshcard__title">Active elsewhere</h3>
                    <Badge tone="info">{elsewhere.length} {elsewhere.length === 1 ? 'session' : 'sessions'}</Badge>
                  </div>
                  {elsewhere.map((session) => {
                    const other = session.sshHostId === null ? undefined : hostsById.get(session.sshHostId);
                    return (
                      <div key={session.id} className="sshelsewhere">
                        <span className="sshelsewhere__name">
                          <Icon name="terminal" size={14} /> {other?.name ?? session.profileName}
                        </span>
                        <span className="sshcard__note">
                          {[other?.environment, `connected for ${sinceLabel(session.startedAt, now)}`].filter(Boolean).join(' · ')}
                        </span>
                        <button type="button" className="sshlink" onClick={() => onOpenSession(session.id)}>
                          Open terminal <Icon name="external" size={12} />
                        </button>
                      </div>
                    );
                  })}
                </section>
              )}
            </aside>
          </div>
        )}
      </div>

      <footer className="sshfoot">
        <span className="sshfoot__status">
          <span className={`sshstate__dot sshstate__dot--${ownSession !== undefined ? 'active' : state}`} /> {statusLabel}
          <span className="sshfoot__hint"> · Opens a new terminal tab</span>
        </span>
        <div className="sshfoot__actions">
          <Button disabled={!dirty || saving} onClick={() => void save()}>
            <Icon name="save" size={14} /> {host === null ? 'Create connection' : 'Save changes'}
          </Button>
          <Button variant="primary" disabled={host === null || dirty || busy} title={dirty ? 'Save your changes first' : undefined} onClick={onConnect}>
            <Icon name="plug" size={14} /> Connect via SSH
          </Button>
        </div>
      </footer>
    </section>
  );
}

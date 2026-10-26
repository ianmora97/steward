import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Environment } from '@shared/schemas/environments';
import type { Execution } from '@shared/schemas/git';
import type { SshHost } from '@shared/schemas/ssh';
import type { TerminalSession } from '@shared/schemas/terminal';
import type { StewardError } from '@shared/types/result';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Icon } from '../../components/Icon';
import { useAppStore } from '../../stores/app.store';
import { useTerminalStore } from '../../stores/terminal.store';
import { ConnectionEditor, type HostFields } from './ConnectionEditor';
import { ConnectionList } from './ConnectionList';
import { HostKeyReview } from './SshSession';
import { CONNECTION_LABEL } from './ssh-meta';
import { ProviderLogo } from './ProviderLogo';
import { VpcHome } from './VpcHome';
import './ssh.css';
import './vpc-home.css';
import { Button } from '../../components/Button';
import { toast } from '../../stores/toast.store';

const REFRESH_MS = 5000;
const NO_SESSIONS: TerminalSession[] = [];

export function SshPanel(): React.JSX.Element {
  const projectId = useAppStore((state) => state.selectedProjectId);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const createRemote = useTerminalStore((state) => state.createRemote);
  const loadTerminals = useTerminalStore((state) => state.load);
  const setActiveSession = useTerminalStore((state) => state.setActive);
  const allSessions = useTerminalStore((state) =>
    projectId === null ? NO_SESSIONS : (state.sessionsByProject[projectId] ?? NO_SESSIONS)
  );

  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelection] = useState<string | 'new' | null>(null);
  const [history, setHistory] = useState<Execution[]>([]);
  const [error, setError] = useState<StewardError | null>(null);
  const [reviewing, setReviewing] = useState<SshHost | null>(null);
  const [deleting, setDeleting] = useState<SshHost | null>(null);
  const [testing, setTesting] = useState<ReadonlySet<string>>(new Set());
  const [view, setView] = useState<'home' | 'connections'>('home');
  const [now, setNow] = useState(() => Date.now());

  const markChecking = useCallback((id: string, on: boolean): void => {
    setTesting((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const reload = useCallback(async (): Promise<SshHost[]> => {
    if (projectId === null) return [];
    const result = await window.steward.ssh.list({ projectId });
    if (!result.success) {
      setError(result.error);
      return [];
    }
    setHosts(result.data);
    return result.data;
  }, [projectId]);

  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    void Promise.all([
      window.steward.ssh.list({ projectId }),
      window.steward.environments.list({ projectId })
    ]).then(([hostsResult, environmentsResult]) => {
      if (cancelled) return;
      if (hostsResult.success) setHosts(hostsResult.data);
      else setError(hostsResult.error);
      if (environmentsResult.success) setEnvironments(environmentsResult.data);
      else setError(environmentsResult.error);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Which shells are running (and for how long) changes without a push event, so it is polled while the tab is open.
  useEffect(() => {
    if (projectId === null) return;
    void loadTerminals(projectId);
    const timer = setInterval(() => {
      void loadTerminals(projectId);
      setNow(Date.now());
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [projectId, loadTerminals]);

  const hostsById = useMemo(() => new Map(hosts.map((host) => [host.id, host])), [hosts]);
  // Nothing chosen yet: the first connection, or a blank one when there are none.
  const effective =
    selection !== null && (selection === 'new' || hostsById.has(selection)) ? selection : (hosts[0]?.id ?? 'new');
  const selected = effective === 'new' ? null : (hostsById.get(effective) ?? null);
  const selectedId = selected?.id ?? null;

  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;
    void window.steward.ssh.listExecutions({ id: selectedId, limit: 30 }).then((result) => {
      if (!cancelled && result.success) setHistory(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const remoteSessions = useMemo(
    () => allSessions.filter((session) => session.sshHostId !== null && session.status === 'running'),
    [allSessions]
  );
  const activeHostIds = useMemo(
    () => new Set(remoteSessions.flatMap((session) => (session.sshHostId === null ? [] : [session.sshHostId]))),
    [remoteSessions]
  );

  if (projectId === null) return <div className="panel" />;

  function replaceHost(updated: SshHost): void {
    setHosts((current) => current.map((host) => (host.id === updated.id ? updated : host)));
  }

  async function refreshHistory(): Promise<void> {
    if (selectedId === null) return;
    const result = await window.steward.ssh.listExecutions({ id: selectedId, limit: 30 });
    if (result.success) setHistory(result.data);
  }

  async function test(host: SshHost, announce = true): Promise<void> {
    markChecking(host.id, true);
    const result = await window.steward.ssh.test({ id: host.id });
    markChecking(host.id, false);
    if (result.success) {
      setError(null);
      replaceHost(result.data);
      if (announce) {
        if (result.data.connection.state === 'connected') toast.success(`${host.name} answered`);
        else toast.error(`${host.name}: ${CONNECTION_LABEL[result.data.connection.state]}`);
      }
    } else {
      setError(result.error);
    }
    void refreshHistory();
  }

  async function connect(host: SshHost): Promise<void> {
    // Checked first so an untrusted or unreachable host is explained here, not as a silent failure inside the shell.
    markChecking(host.id, true);
    const checked = await window.steward.ssh.test({ id: host.id });
    markChecking(host.id, false);
    if (!checked.success) {
      setError(checked.error);
      return;
    }
    replaceHost(checked.data);
    const state = checked.data.connection.state;
    if (state === 'host_key_unknown') {
      setReviewing(checked.data);
      return;
    }
    if (state !== 'connected' && state !== 'auth_failed') return;
    // Auth failure without prompts is expected for password logins; the shell can still ask for one.
    if (await createRemote(projectId as string, host.id)) setActiveTab('terminal');
  }

  /** Every connection, three at a time: a slow or dead one must not hold up the rest, nor open dozens of ssh at once. */
  async function testAll(): Promise<void> {
    const queue = [...hosts];
    const worker = async (): Promise<void> => {
      for (let host = queue.shift(); host !== undefined; host = queue.shift()) await test(host, false);
    };
    await Promise.all([worker(), worker(), worker()]);
    toast.info(`${hosts.length} connection${hosts.length === 1 ? '' : 's'} checked`);
  }

  async function save(fields: HostFields): Promise<StewardError | null> {
    const result =
      selected === null
        ? await window.steward.ssh.create({ projectId: projectId as string, ...fields })
        : await window.steward.ssh.update({ id: selected.id, ...fields });
    if (!result.success) return result.error;
    toast.success(selected === null ? 'Connection added' : 'Connection saved');
    await reload();
    setSelection(result.data.id);
    return null;
  }

  async function remove(host: SshHost): Promise<void> {
    setDeleting(null);
    const result = await window.steward.ssh.remove({ id: host.id });
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success('Connection removed');
    setSelection(null);
    setHistory([]);
    await reload();
  }

  return (
    <div className="panel sshpage">
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <header className="sshpage__head">
        <div>
          <h2 className="sshpage__title">
            VPC connections
            {hosts.some((host) => host.provider === 'aws') && <ProviderLogo provider="aws" height={26} />}
          </h2>
          <p className="sshpage__subtitle">
            Manage SSH access to your instances and bastion hosts, organized by environment.
          </p>
        </div>
        <Button variant="primary" onClick={() => {
            setSelection('new');
            setView('connections');
          }}>
          <Icon name="plus" size={14} /> New connection
        </Button>
      </header>

      <nav className="subtabs" aria-label="VPC sections">
        {(['home', 'connections'] as const).map((value) => (
          <button key={value} type="button" className={`subtabs__tab${view === value ? ' subtabs__tab--active' : ''}`} onClick={() => setView(value)}>
            {value === 'home' ? 'Home' : 'Connections'}
          </button>
        ))}
      </nav>

      {loaded && view === 'home' && (
        <VpcHome
          hosts={hosts}
          environments={environments}
          activeHostIds={activeHostIds}
          checking={testing}
          now={now}
          onTest={(host) => void test(host)}
          onTestAll={() => void testAll()}
          onConnect={(host) => void connect(host)}
          onManage={(host) => {
            setSelection(host.id);
            setView('connections');
          }}
          onNew={() => {
            setSelection('new');
            setView('connections');
          }}
        />
      )}

      {loaded && view === 'connections' && (
        <div className="sshpage__body">
          <ConnectionList hosts={hosts} activeHostIds={activeHostIds} selection={effective} onSelect={setSelection} />
          <ConnectionEditor
            key={effective}
            host={selected}
            projectId={projectId}
            environments={environments}
            onEnvironmentCreated={(created) => setEnvironments((current) => [...current, created])}
            history={history}
            sessions={remoteSessions}
            hostsById={hostsById}
            now={now}
            busy={selected !== null && testing.has(selected.id)}
            onSave={save}
            onTest={() => selected !== null && void test(selected)}
            onConnect={() => selected !== null && void connect(selected)}
            onReview={() => selected !== null && setReviewing(selected)}
            onDelete={() => selected !== null && setDeleting(selected)}
            onRan={() => {
              void reload();
              void refreshHistory();
            }}
            onOpenSession={(sessionId) => {
              setActiveSession(projectId, sessionId);
              setActiveTab('terminal');
            }}
          />
        </div>
      )}

      {reviewing !== null && (
        <HostKeyReview
          host={reviewing}
          onDecline={() => setReviewing(null)}
          onDone={(updated) => {
            setReviewing(null);
            replaceHost(updated);
          }}
        />
      )}

      {deleting !== null && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete connection"
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        >
          <p>
            The connection and its open shells are removed from Steward. Nothing changes on the machine itself, and its
            history entries stay in the Activity log.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DockerStatus, DockerTarget } from '@shared/schemas/docker';
import type { SshHost } from '@shared/schemas/ssh';
import type { StewardError } from '@shared/types/result';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Icon } from '../../components/Icon';
import { Badge } from '../../components/Badge';
import { useAppStore } from '../../stores/app.store';
import { ComposeView } from './ComposeView';
import { ContainersView } from './ContainersView';
import { ImagesView } from './ImagesView';
import { ResourcesView } from './ResourcesView';
import { targetKey } from './docker-meta';
import './docker.css';
import { Button } from '../../components/Button';

type View = 'containers' | 'images' | 'resources' | 'compose';

const VIEW_LABEL: Record<View, string> = {
  containers: 'Containers',
  images: 'Images',
  resources: 'Volumes & networks',
  compose: 'Compose'
};

const LOCAL = 'local';

export function DockerPanel(): React.JSX.Element {
  const projectId = useAppStore((state) => state.selectedProjectId);
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [choice, setChoice] = useState<string>(LOCAL);
  const [view, setView] = useState<View>('containers');
  // The answer is stored with the target and refresh it belongs to, so a stale one is never shown for another.
  const [answer, setAnswer] = useState<{ key: string; refresh: number; status: DockerStatus } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<StewardError | null>(null);

  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    void window.steward.ssh.list({ projectId }).then((result) => {
      if (cancelled) return;
      if (result.success) setHosts(result.data);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // A server deleted while selected falls back to this machine.
  const selected = choice === LOCAL || hosts.some((host) => host.id === choice) ? choice : LOCAL;
  // Stable between renders, so the views below can list it in their effect dependencies.
  const target = useMemo<DockerTarget>(
    () => (selected === LOCAL ? { kind: 'local' } : { kind: 'ssh', sshHostId: selected }),
    [selected]
  );
  const key = targetKey(target);

  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    void window.steward.docker.status({ projectId, target }).then((result) => {
      if (cancelled) return;
      if (result.success) setAnswer({ key, refresh, status: result.data });
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, target, key, refresh]);

  // The last answer for this target stays on screen while the next one is read, so polling never flickers.
  const status = answer !== null && answer.key === key ? answer.status : null;
  const checking = answer === null || answer.key !== key || answer.refresh !== refresh;
  const statusState = status?.state ?? null;
  const check = (): void => setRefresh((value) => value + 1);

  // Docker Desktop is started for the user, once per visit to the tab and only on this machine: a
  // server's daemon is never started from here. Afterwards `status` reports "starting" until it answers.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (statusState !== 'daemon_down' || key !== 'local' || projectId === null || autoStarted.current) return;
    autoStarted.current = true;
    void window.steward.docker.startEngine({ projectId }).then((result) => {
      if (!result.success) setError(result.error);
      setRefresh((value) => value + 1);
    });
  }, [statusState, key, projectId]);

  useEffect(() => {
    if (statusState !== 'starting') return;
    const timer = setInterval(() => setRefresh((value) => value + 1), 3000);
    return () => clearInterval(timer);
  }, [statusState]);

  function startDocker(): void {
    if (projectId === null) return;
    void window.steward.docker.startEngine({ projectId }).then((result) => {
      if (!result.success) setError(result.error);
      setRefresh((value) => value + 1);
    });
  }

  if (projectId === null) return <div className="panel" />;

  const isLocal = target.kind === 'local';
  const activeView: View = !isLocal && view === 'compose' ? 'containers' : view;
  const views = (Object.keys(VIEW_LABEL) as View[]).filter((value) => isLocal || value !== 'compose');
  const selectedHost = isLocal ? null : (hosts.find((host) => host.id === selected) ?? null);

  return (
    <div className="panel dppage dkpage">
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <header className="dppage__head">
        <div>
          <h2 className="dppage__title">Docker</h2>
          <p className="dppage__subtitle">
            Containers, images and Compose projects, on this machine or on one of the project&apos;s servers.
          </p>
        </div>
        <div className="dktarget">
          <label className="field">
            <span className="field__label">Where</span>
            <select
              className="field__input"
              value={selected}
              onChange={(event) => setChoice(event.target.value)}
              aria-label="Docker target"
            >
              <option value={LOCAL}>This machine</option>
              {hosts.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.name}
                  {host.environment === null ? '' : ` · ${host.environment}`}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={checking} onClick={check}>
            <Icon name="refresh" size={14} /> Refresh
          </Button>
        </div>
      </header>

      {selectedHost !== null && (
        <p className="card__hint dkwhere">
          <Icon name="ssh" size={14} /> Commands run on <strong>{selectedHost.name}</strong> over SSH.
        </p>
      )}

      {status === null && <p className="card__hint">Checking Docker…</p>}

      {status !== null && status.state !== 'ready' && (
        <EmptyState
          title={
            status.state === 'starting'
              ? 'Starting Docker…'
              : status.state === 'not_installed'
                ? 'Docker is not installed here'
                : status.state === 'daemon_down'
                  ? 'Docker is not running'
                  : status.state === 'permission_denied'
                    ? 'No permission to use Docker'
                    : status.state === 'unreachable'
                      ? 'Could not reach the server'
                      : 'Docker is not available'
          }
          description={[status.message, status.hint].filter((part) => part !== null && part !== '').join(' ')}
        >
          {status.state === 'starting' ? (
            <Badge tone="running" icon="loader">
              Waiting for the Docker daemon
            </Badge>
          ) : (
            <>
              {status.state === 'daemon_down' && isLocal && (
                <Button variant="primary" onClick={startDocker}>
                  Start Docker
                </Button>
              )}
              <Button onClick={check}>
                Try again
              </Button>
            </>
          )}
        </EmptyState>
      )}

      {status !== null && status.state === 'ready' && (
        <>
          <div className="dkbar">
            <div className="segmented" role="group" aria-label="Docker view">
              {views.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`segmented__option${activeView === value ? ' segmented__option--active' : ''}`}
                  onClick={() => setView(value)}
                >
                  {VIEW_LABEL[value]}
                </button>
              ))}
            </div>
            <Badge tone="success" icon="checkCircle">
              Docker {status.serverVersion ?? status.cliVersion ?? ''}
            </Badge>
          </div>

          {activeView === 'containers' && (
            <ContainersView key={key} projectId={projectId} target={target} onError={setError} />
          )}
          {activeView === 'images' && (
            <ImagesView
              key={key}
              projectId={projectId}
              target={target}
              serverName={selectedHost?.name ?? 'this machine'}
              onError={setError}
            />
          )}
          {activeView === 'resources' && (
            <ResourcesView key={key} projectId={projectId} target={target} onError={setError} />
          )}
          {activeView === 'compose' && <ComposeView projectId={projectId} onError={setError} />}
        </>
      )}
    </div>
  );
}

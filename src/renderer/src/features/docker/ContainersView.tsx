import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DockerContainer,
  DockerContainerAction,
  DockerContainerStats,
  DockerTarget
} from '@shared/schemas/docker';
import type { StewardError } from '@shared/types/result';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { Badge } from '../../components/Badge';
import { ContainerDetail } from './ContainerDetail';
import { DestructiveDialog, type DestructiveRequest } from './DestructiveDialog';
import { containerBadge } from './docker-meta';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Loading } from '../../components/Loading';
import { toast } from '../../stores/toast.store';

/** How often the list and the CPU/memory numbers are re-read while the window is visible. */
const POLL_MS = 5000;

type StateFilter = 'all' | 'running' | 'stopped';

const ACTION_DONE: Record<string, string> = {
  start: 'started',
  stop: 'stopped',
  restart: 'restarted',
  unpause: 'unpaused'
};

export function ContainersView({
  projectId,
  target,
  onError
}: {
  projectId: string;
  target: DockerTarget;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const [containers, setContainers] = useState<DockerContainer[] | null>(null);
  const [stats, setStats] = useState<Map<string, DockerContainerStats>>(new Map());
  const [text, setText] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [pending, setPending] = useState<{ id: string; action: DockerContainerAction } | null>(null);
  const [selected, setSelected] = useState<DockerContainer | null>(null);
  const [destructive, setDestructive] = useState<DestructiveRequest | null>(null);
  const inFlight = useRef(false);
  const failing = useRef(false);

  const reload = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [list, usage] = await Promise.all([
        window.steward.docker.listContainers({ projectId, target }),
        window.steward.docker.containerStats({ projectId, target })
      ]);
      if (!list.success) {
        // A poll that keeps failing would stack the same banner every few seconds.
        if (!failing.current) onError(list.error);
        failing.current = true;
        return;
      }
      failing.current = false;
      setContainers(list.data);
      if (usage.success) setStats(new Map(usage.data.map((entry) => [entry.id, entry])));
    } finally {
      inFlight.current = false;
    }
  }, [projectId, target, onError]);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      if (!document.hidden) void reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const visible = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return (containers ?? []).filter((container) => {
      if (stateFilter === 'running' && container.state !== 'running') return false;
      if (stateFilter === 'stopped' && container.state === 'running') return false;
      if (needle === '') return true;
      return [container.name, container.image, container.id, container.composeProject ?? ''].some((value) =>
        value.toLowerCase().includes(needle)
      );
    });
  }, [containers, text, stateFilter]);

  async function act(container: DockerContainer, action: DockerContainerAction): Promise<void> {
    setPending({ id: container.id, action });
    const result = await window.steward.docker.containerAction({
      projectId,
      target,
      containerId: container.id,
      action
    });
    setPending(null);
    if (!result.success) onError(result.error);
    else toast.success(`${container.name} ${ACTION_DONE[action] ?? 'updated'}`);
    await reload();
  }

  function askRemove(container: DockerContainer): void {
    setDestructive({
      title: `Remove ${container.name}?`,
      body: (
        <p>
          The container <strong>{container.name}</strong> is deleted. Its image stays, but anything written inside it
          that is not in a volume is lost.
          {container.state === 'running' && ' It is running: stop it first.'}
        </p>
      ),
      confirmLabel: 'Remove container',
      doneMessage: `${container.name} removed`,
      thing: 'container',
      expectedName: container.name,
      run: (confirmation) =>
        window.steward.docker.containerAction({
          projectId,
          target,
          containerId: container.id,
          action: 'remove',
          confirmed: true,
          ...(confirmation === undefined ? {} : { confirmation })
        })
    });
  }

  if (containers === null) return <Loading lines={5} label="Loading containers…" />;

  return (
    <section className="dpsection">
      <div className="dkbar">
        <div className="dkfilters">
          <label className="dksearch">
            <Icon name="search" size={14} />
            <input
              className="field__input"
              placeholder="Filter by name, image or project"
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-label="Filter containers"
            />
          </label>
          <select
            className="field__input"
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value as StateFilter)}
            aria-label="State filter"
          >
            <option value="all">All</option>
            <option value="running">Running</option>
            <option value="stopped">Not running</option>
          </select>
        </div>
        <span className="card__hint">
          {visible.length} of {containers.length}
        </span>
      </div>

      {containers.length === 0 && (
        <EmptyState title="No containers" description="Nothing has been created on this Docker yet." />
      )}

      {visible.length > 0 && (
        <ul className="dklist">
          {visible.map((container) => {
            const badge = containerBadge(container.state, container.status);
            const usage = stats.get(container.id) ?? null;
            const busy = pending?.id === container.id;
            const running = container.state === 'running';
            return (
              <li key={container.id} className="dkrow">
                <Badge tone={badge.tone} icon={badge.icon} title={container.status}>
                  {badge.label}
                </Badge>
                <button type="button" className="dkrow__main" onClick={() => setSelected(container)}>
                  <span className="dkrow__name">{container.name}</span>
                  <span className="dkrow__meta dpmono">{container.image}</span>
                </button>
                <span className="dkrow__ports dpmono" title={container.ports}>
                  {container.ports === '' ? '—' : container.ports}
                </span>
                <span className="dkrow__usage">
                  {usage === null || !running ? (
                    <span className="card__hint">—</span>
                  ) : (
                    <>
                      <span>{usage.cpuPercent === null ? '—' : `${usage.cpuPercent.toFixed(1)}% CPU`}</span>
                      <span className="card__hint">{usage.memoryUsage.split('/')[0]?.trim()}</span>
                    </>
                  )}
                </span>
                <span className="dkrow__actions">
                  {running ? (
                    <>
                      <Button size="sm" loading={busy && pending?.action === 'restart'} loadingLabel="Restarting…" disabled={busy} onClick={() => void act(container, 'restart')}>
                        Restart
                      </Button>
                      <Button size="sm" loading={busy && pending?.action === 'stop'} loadingLabel="Stopping…" disabled={busy} onClick={() => void act(container, 'stop')}>
                        Stop
                      </Button>
                    </>
                  ) : container.state === 'paused' ? (
                    <Button size="sm" loading={busy && pending?.action === 'unpause'} loadingLabel="Unpausing…" disabled={busy} onClick={() => void act(container, 'unpause')}>
                      Unpause
                    </Button>
                  ) : (
                    <Button size="sm" loading={busy && pending?.action === 'start'} loadingLabel="Starting…" disabled={busy} onClick={() => void act(container, 'start')}>
                      Start
                    </Button>
                  )}
                  <IconButton icon="trash" label={running ? 'Stop it before removing' : 'Remove'} disabled={busy || running} size={14} onClick={() => askRemove(container)} />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {selected !== null && (
        <ContainerDetail
          projectId={projectId}
          target={target}
          container={selected}
          onClose={() => setSelected(null)}
          onError={onError}
          onChanged={() => void reload()}
        />
      )}

      {destructive !== null && (
        <DestructiveDialog
          request={destructive}
          onDone={() => {
            setDestructive(null);
            void reload();
          }}
          onError={onError}
          onCancel={() => setDestructive(null)}
        />
      )}
    </section>
  );
}

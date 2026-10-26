import { useEffect, useState } from 'react';
import type { DockerContainer, DockerContainerDetail, DockerTarget } from '@shared/schemas/docker';
import type { StewardError } from '@shared/types/result';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/Badge';
import { useAppStore } from '../../stores/app.store';
import { useTerminalStore } from '../../stores/terminal.store';
import { DestructiveDialog, type DestructiveRequest } from './DestructiveDialog';
import { LogsPane } from './LogsPane';
import { containerBadge } from './docker-meta';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';

type Tab = 'info' | 'logs';

export function ContainerDetail({
  projectId,
  target,
  container,
  onClose,
  onError,
  onChanged
}: {
  projectId: string;
  target: DockerTarget;
  container: DockerContainer;
  onClose: () => void;
  onError: (error: StewardError) => void;
  onChanged: () => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('info');
  const [detail, setDetail] = useState<DockerContainerDetail | null>(null);
  const [destructive, setDestructive] = useState<DestructiveRequest | null>(null);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const createDocker = useTerminalStore((state) => state.createDocker);

  useEffect(() => {
    let cancelled = false;
    void window.steward.docker
      .inspectContainer({ projectId, target, containerId: container.id })
      .then((result) => {
        if (cancelled) return;
        if (result.success) setDetail(result.data);
        else onError(result.error);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, target, container.id, onError]);

  const badge = containerBadge(container.state, container.status);
  const running = container.state === 'running';

  async function openShell(): Promise<void> {
    const started = await createDocker(projectId, container.id, target.kind === 'ssh' ? target.sshHostId : null);
    if (started) {
      onClose();
      setActiveTab('terminal');
    }
  }

  function askKill(): void {
    setDestructive({
      title: `Kill ${container.name}?`,
      body: (
        <p>
          <strong>{container.name}</strong> is stopped immediately with SIGKILL, without a chance to shut down cleanly.
          Prefer Stop unless it is stuck.
        </p>
      ),
      confirmLabel: 'Kill container',
      doneMessage: `${container.name} killed`,
      thing: 'container',
      expectedName: container.name,
      run: (confirmation) =>
        window.steward.docker.containerAction({
          projectId,
          target,
          containerId: container.id,
          action: 'kill',
          confirmed: true,
          ...(confirmation === undefined ? {} : { confirmation })
        })
    });
  }

  return (
    <Modal title={container.name} onClose={onClose} className="dkdetail">
      <div className="dkdetail__body">
        <div className="dkdetail__head">
          <Badge tone={badge.tone} icon={badge.icon} title={container.status}>
            {badge.label}
          </Badge>
          <span className="card__hint">{container.status}</span>
          <span className="dpitem__spacer" />
          {running && (
            <>
              <Button size="sm" onClick={() => void openShell()}>
                <Icon name="terminal" size={14} /> Shell
              </Button>
              <Button size="sm" dangerText onClick={askKill}>
                Kill
              </Button>
            </>
          )}
        </div>

        <div className="segmented" role="group" aria-label="Container view">
          {(['info', 'logs'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`segmented__option${tab === value ? ' segmented__option--active' : ''}`}
              onClick={() => setTab(value)}
            >
              {value === 'info' ? 'Info' : 'Logs'}
            </button>
          ))}
        </div>

        {tab === 'info' && <InfoPane detail={detail} />}
        {tab === 'logs' && <LogsPane projectId={projectId} target={target} containerId={container.id} onError={onError} />}
      </div>

      {destructive !== null && (
        <DestructiveDialog
          request={destructive}
          onDone={() => {
            setDestructive(null);
            onChanged();
            onClose();
          }}
          onError={onError}
          onCancel={() => setDestructive(null)}
        />
      )}
    </Modal>
  );
}

function InfoPane({ detail }: { detail: DockerContainerDetail | null }): React.JSX.Element {
  if (detail === null) return <Loading variant="line" lines={6} label="Loading the container…" />;
  return (
    <div className="dkinfo">
      <dl className="dpsummary">
        <dt>Image</dt>
        <dd className="dpmono">{detail.image}</dd>
        <dt>Command</dt>
        <dd className="dpmono">{detail.command === '' ? '—' : detail.command}</dd>
        <dt>Created</dt>
        <dd>{detail.createdAt}</dd>
        {detail.startedAt !== null && (
          <>
            <dt>Started</dt>
            <dd>{detail.startedAt}</dd>
          </>
        )}
        {!detail.running && (
          <>
            <dt>Exit code</dt>
            <dd>{detail.exitCode ?? '—'}</dd>
          </>
        )}
        {detail.health !== null && (
          <>
            <dt>Health</dt>
            <dd>{detail.health}</dd>
          </>
        )}
        <dt>Restarts</dt>
        <dd>
          {detail.restartCount} · policy {detail.restartPolicy}
        </dd>
        {detail.workingDir !== '' && (
          <>
            <dt>Working dir</dt>
            <dd className="dpmono">{detail.workingDir}</dd>
          </>
        )}
        {detail.user !== '' && (
          <>
            <dt>User</dt>
            <dd className="dpmono">{detail.user}</dd>
          </>
        )}
      </dl>

      <h4 className="dkinfo__title">Ports</h4>
      {detail.ports.length === 0 ? (
        <p className="card__hint">None published.</p>
      ) : (
        <ul className="dkinfo__list dpmono">
          {detail.ports.map((port) => (
            <li key={port}>{port}</li>
          ))}
        </ul>
      )}

      <h4 className="dkinfo__title">Networks</h4>
      <ul className="dkinfo__list dpmono">
        {detail.networks.map((network) => (
          <li key={network.name}>
            {network.name} {network.ipAddress !== '' && `· ${network.ipAddress}`}
          </li>
        ))}
      </ul>

      <h4 className="dkinfo__title">Mounts</h4>
      {detail.mounts.length === 0 ? (
        <p className="card__hint">No mounts.</p>
      ) : (
        <ul className="dkinfo__list dpmono">
          {detail.mounts.map((mount) => (
            <li key={`${mount.destination}`}>
              {mount.type}: {mount.source} → {mount.destination} {mount.readWrite ? '' : '(read-only)'}
            </li>
          ))}
        </ul>
      )}

      <h4 className="dkinfo__title">Environment</h4>
      {detail.env.length === 0 ? (
        <p className="card__hint">No variables.</p>
      ) : (
        <>
          <ul className="dkinfo__list dpmono">
            {detail.env.map((variable) => (
              <li key={variable.name}>
                {variable.name}={variable.value === null ? <span className="card__hint">•••• hidden</span> : variable.value}
              </li>
            ))}
          </ul>
          <p className="card__hint">Values of names that look like secrets never leave the app&apos;s main process.</p>
        </>
      )}

      {detail.labels.length > 0 && (
        <details>
          <summary className="dkinfo__title">Labels ({detail.labels.length})</summary>
          <ul className="dkinfo__list dpmono">
            {detail.labels.map((label) => (
              <li key={label.name}>
                {label.name}={label.value}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

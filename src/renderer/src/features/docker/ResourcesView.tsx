import { useCallback, useEffect, useState } from 'react';
import type { DockerNetwork, DockerTarget, DockerVolume } from '@shared/schemas/docker';
import type { StewardError } from '@shared/types/result';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { DestructiveDialog, type DestructiveRequest } from './DestructiveDialog';
import { BUILTIN_NETWORKS } from './docker-meta';

export function ResourcesView({
  projectId,
  target,
  onError
}: {
  projectId: string;
  target: DockerTarget;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const [volumes, setVolumes] = useState<DockerVolume[] | null>(null);
  const [networks, setNetworks] = useState<DockerNetwork[] | null>(null);
  const [destructive, setDestructive] = useState<DestructiveRequest | null>(null);

  const fetchAll = useCallback(
    () =>
      Promise.all([
        window.steward.docker.listVolumes({ projectId, target }),
        window.steward.docker.listNetworks({ projectId, target })
      ]),
    [projectId, target]
  );
  const apply = useCallback(
    ([volumeResult, networkResult]: Awaited<ReturnType<typeof fetchAll>>): void => {
      if (volumeResult.success) setVolumes(volumeResult.data);
      else onError(volumeResult.error);
      if (networkResult.success) setNetworks(networkResult.data);
      else onError(networkResult.error);
    },
    [onError]
  );

  useEffect(() => {
    let cancelled = false;
    void fetchAll().then((results) => {
      if (!cancelled) apply(results);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchAll, apply]);

  const reload = async (): Promise<void> => apply(await fetchAll());

  function askRemoveVolume(volume: DockerVolume): void {
    setDestructive({
      title: `Remove volume ${volume.name}?`,
      body: (
        <p>
          The volume <strong>{volume.name}</strong> and <strong>all the data in it</strong> are deleted. Docker refuses
          if a container still uses it.
        </p>
      ),
      confirmLabel: 'Remove volume',
      thing: 'volume',
      expectedName: volume.name,
      run: (confirmation) =>
        window.steward.docker.removeVolume({
          projectId,
          target,
          name: volume.name,
          confirmed: true,
          ...(confirmation === undefined ? {} : { confirmation })
        })
    });
  }

  function askRemoveNetwork(network: DockerNetwork): void {
    setDestructive({
      title: `Remove network ${network.name}?`,
      body: (
        <p>
          The network <strong>{network.name}</strong> is deleted. Docker refuses if a container is still connected.
        </p>
      ),
      confirmLabel: 'Remove network',
      thing: 'network',
      expectedName: network.name,
      run: (confirmation) =>
        window.steward.docker.removeNetwork({
          projectId,
          target,
          name: network.name,
          confirmed: true,
          ...(confirmation === undefined ? {} : { confirmation })
        })
    });
  }

  if (volumes === null || networks === null) return <p className="card__hint">Loading…</p>;

  return (
    <div className="dpcolumns">
      <section className="dpcolumn">
        <h3 className="dpcolumn__title">Volumes ({volumes.length})</h3>
        {volumes.length === 0 ? (
          <EmptyState title="No volumes" description="Containers have not stored anything in named volumes." />
        ) : (
          <ul className="dklist">
            {volumes.map((volume) => (
              <li key={volume.name} className="dkrow dkrow--simple">
                <span className="dkrow__main dkrow__main--static">
                  <span className="dkrow__name dpmono">{volume.name}</span>
                  <span className="dkrow__meta">
                    {volume.driver} · {volume.scope}
                  </span>
                </span>
                <button
                  type="button"
                  className="iconbutton"
                  aria-label={`Remove volume ${volume.name}`}
                  title="Remove"
                  onClick={() => askRemoveVolume(volume)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dpcolumn">
        <h3 className="dpcolumn__title">Networks ({networks.length})</h3>
        <ul className="dklist">
          {networks.map((network) => (
            <li key={network.id} className="dkrow dkrow--simple">
              <span className="dkrow__main dkrow__main--static">
                <span className="dkrow__name dpmono">{network.name}</span>
                <span className="dkrow__meta">
                  {network.driver} · {network.scope}
                </span>
              </span>
              <button
                type="button"
                className="iconbutton"
                aria-label={`Remove network ${network.name}`}
                title={BUILTIN_NETWORKS.includes(network.name) ? 'Docker keeps its default networks' : 'Remove'}
                disabled={BUILTIN_NETWORKS.includes(network.name)}
                onClick={() => askRemoveNetwork(network)}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      </section>

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
    </div>
  );
}

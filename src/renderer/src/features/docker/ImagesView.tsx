import { useCallback, useEffect, useState } from 'react';
import type { DockerImage, DockerPruneKind, DockerTarget } from '@shared/schemas/docker';
import type { StewardError } from '@shared/types/result';
import { EmptyState } from '../../components/EmptyState';

import { Badge } from '../../components/Badge';
import { DestructiveDialog, type DestructiveRequest } from './DestructiveDialog';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Loading } from '../../components/Loading';
import { toast } from '../../stores/toast.store';

const PRUNE_LABEL: Record<DockerPruneKind, string> = {
  containers: 'Stopped containers',
  images: 'Dangling images',
  volumes: 'Unused volumes',
  networks: 'Unused networks',
  system: 'Everything unused (system prune)'
};

const PRUNE_EXPLANATION: Record<DockerPruneKind, string> = {
  containers: 'Every stopped container is deleted.',
  images: 'Images with no tag and no container are deleted.',
  volumes: 'Volumes no container uses are deleted, with their data.',
  networks: 'Networks no container uses are deleted.',
  system: 'Stopped containers, unused networks and dangling images are deleted. Volumes are kept.'
};

/** What `docker system df` says, loaded when the prune dialog opens so the numbers are in front of the confirmation. */
function DiskUsage({ projectId, target }: { projectId: string; target: DockerTarget }): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.steward.docker.systemDf({ projectId, target }).then((result) => {
      if (!cancelled) setText(result.success ? result.data.output : 'Could not read disk usage.');
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, target]);
  return <pre className="dpcommand">{text ?? 'Reading disk usage…'}</pre>;
}

function referenceOf(image: DockerImage): string {
  return image.dangling || image.tag === '' || image.tag === '<none>' ? image.id : `${image.repository}:${image.tag}`;
}

export function ImagesView({
  projectId,
  target,
  serverName,
  onError
}: {
  projectId: string;
  target: DockerTarget;
  /** The word to type to confirm a prune on a protected server. */
  serverName: string;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const [images, setImages] = useState<DockerImage[] | null>(null);
  const [pullRef, setPullRef] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullOutput, setPullOutput] = useState<string | null>(null);
  const [pruneKind, setPruneKind] = useState<DockerPruneKind>('images');
  const [destructive, setDestructive] = useState<DestructiveRequest | null>(null);

  const fetchImages = useCallback(() => window.steward.docker.listImages({ projectId, target }), [projectId, target]);
  const apply = useCallback(
    (result: Awaited<ReturnType<typeof fetchImages>>): void => {
      if (result.success) setImages(result.data);
      else onError(result.error);
    },
    [onError]
  );

  useEffect(() => {
    let cancelled = false;
    void fetchImages().then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchImages, apply]);

  const reload = async (): Promise<void> => apply(await fetchImages());

  async function pull(): Promise<void> {
    setPulling(true);
    setPullOutput(null);
    const result = await window.steward.docker.pullImage({ projectId, target, image: pullRef.trim() });
    setPulling(false);
    if (!result.success) {
      onError(result.error);
      return;
    }
    setPullOutput(result.data.output);
    toast.success(`Pulled ${pullRef.trim()}`);
    setPullRef('');
    await reload();
  }

  function askRemove(image: DockerImage): void {
    const reference = referenceOf(image);
    setDestructive({
      title: `Remove ${reference}?`,
      body: (
        <p>
          The image <strong>{reference}</strong> is deleted from this Docker. It can be pulled again if it came from a
          registry; a locally built image cannot.
          {image.usedBy.length > 0 && ` Containers use it: ${image.usedBy.join(', ')}.`}
        </p>
      ),
      confirmLabel: 'Remove image',
      doneMessage: `${reference} removed`,
      thing: 'image',
      expectedName: reference,
      run: (confirmation) =>
        window.steward.docker.removeImage({
          projectId,
          target,
          image: reference,
          confirmed: true,
          ...(confirmation === undefined ? {} : { confirmation })
        })
    });
  }

  function askPrune(): void {
    setDestructive({
      title: `Prune: ${PRUNE_LABEL[pruneKind].toLowerCase()}`,
      body: (
        <>
          <p>{PRUNE_EXPLANATION[pruneKind]} This cannot be undone. Current disk usage:</p>
          <DiskUsage projectId={projectId} target={target} />
        </>
      ),
      confirmLabel: 'Prune',
      doneMessage: 'Prune finished',
      thing: 'server',
      expectedName: serverName,
      run: (confirmation) =>
        window.steward.docker.prune({
          projectId,
          target,
          kind: pruneKind,
          confirmed: true,
          ...(confirmation === undefined ? {} : { confirmation })
        })
    });
  }

  if (images === null) return <Loading lines={5} label="Loading images…" />;

  return (
    <section className="dpsection">
      <div className="dkbar">
        <form
          className="dkpull"
          onSubmit={(event) => {
            event.preventDefault();
            if (pullRef.trim() !== '') void pull();
          }}
        >
          <input
            className="field__input"
            placeholder="Pull an image, e.g. nginx:1.27"
            value={pullRef}
            onChange={(event) => setPullRef(event.target.value)}
            disabled={pulling}
            spellCheck={false}
            aria-label="Image to pull"
          />
          <Button variant="primary" loading={pulling} loadingLabel="Pulling…" disabled={pullRef.trim() === ''} type="submit">Pull</Button>
        </form>
        <div className="dkprune">
          <select
            className="field__input"
            value={pruneKind}
            onChange={(event) => setPruneKind(event.target.value as DockerPruneKind)}
            aria-label="What to prune"
          >
            {(Object.keys(PRUNE_LABEL) as DockerPruneKind[]).map((kind) => (
              <option key={kind} value={kind}>
                {PRUNE_LABEL[kind]}
              </option>
            ))}
          </select>
          <Button dangerText onClick={askPrune}>
            Prune…
          </Button>
        </div>
      </div>

      {pullOutput !== null && <pre className="dpcommand">{pullOutput}</pre>}

      {images.length === 0 ? (
        <EmptyState title="No images" description="Pull one above, or build one with docker build." />
      ) : (
        <ul className="dklist">
          {images.map((image) => (
            <li key={`${image.id}:${image.repository}:${image.tag}`} className="dkrow dkrow--image">
              <span className="dkrow__main dkrow__main--static">
                <span className="dkrow__name dpmono">
                  {image.dangling ? '<untagged>' : `${image.repository}:${image.tag}`}
                </span>
                <span className="dkrow__meta dpmono">{image.id}</span>
              </span>
              <span className="dkrow__usage">
                <span>{image.size}</span>
                <span className="card__hint">{image.createdSince}</span>
              </span>
              <span className="dkrow__chips">
                {image.usedBy.length > 0 ? (
                  <Badge tone="info" icon="docker" title={image.usedBy.join(', ')}>
                    {image.usedBy.length} container{image.usedBy.length === 1 ? '' : 's'}
                  </Badge>
                ) : image.dangling ? (
                  <Badge tone="warning" icon="alert">
                    Dangling
                  </Badge>
                ) : (
                  <span className="card__hint">Not in use</span>
                )}
              </span>
              <IconButton icon="trash" label="Remove" size={14} onClick={() => askRemove(image)} />
            </li>
          ))}
        </ul>
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

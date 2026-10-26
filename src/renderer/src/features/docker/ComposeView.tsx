import { useCallback, useEffect, useState } from 'react';
import type { DockerComposeAction, DockerComposeProject, DockerComposeService } from '@shared/schemas/docker';
import type { StewardError } from '@shared/types/result';
import { EmptyState } from '../../components/EmptyState';
import { Badge } from '../../components/Badge';
import { DestructiveDialog, type DestructiveRequest } from './DestructiveDialog';
import { containerBadge } from './docker-meta';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';
import { toast } from '../../stores/toast.store';

const ACTION_LABEL: Record<DockerComposeAction, string> = {
  up: 'Up',
  restart: 'Restart',
  stop: 'Stop',
  pull: 'Pull',
  down: 'Down'
};

function ProjectCard({
  projectId,
  project,
  onError
}: {
  projectId: string;
  project: DockerComposeProject;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const [services, setServices] = useState<DockerComposeService[] | null>(null);
  const [busy, setBusy] = useState<DockerComposeAction | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [destructive, setDestructive] = useState<DestructiveRequest | null>(null);

  const fetchServices = useCallback(
    () => window.steward.docker.composeServices({ projectId, repositoryId: project.repositoryId }),
    [projectId, project.repositoryId]
  );
  const apply = useCallback(
    (result: Awaited<ReturnType<typeof fetchServices>>): void => {
      if (result.success) setServices(result.data);
      else {
        setServices([]);
        onError(result.error);
      }
    },
    [onError]
  );

  useEffect(() => {
    let cancelled = false;
    void fetchServices().then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchServices, apply]);

  const reload = async (): Promise<void> => apply(await fetchServices());

  async function run(action: DockerComposeAction): Promise<void> {
    setBusy(action);
    setOutput(null);
    const result = await window.steward.docker.composeAction({
      projectId,
      repositoryId: project.repositoryId,
      action
    });
    setBusy(null);
    if (result.success) {
      setOutput(result.data.output);
      toast.success(`${project.repositoryName}: ${ACTION_LABEL[action]} finished`);
    } else onError(result.error);
    await reload();
  }

  function askDownWithVolumes(): void {
    setDestructive({
      title: `Take down ${project.repositoryName} and delete its volumes?`,
      body: (
        <p>
          <code>docker compose down -v</code> removes the containers, the networks <strong>and the named volumes</strong>{' '}
          of this project. The data in those volumes is lost.
        </p>
      ),
      confirmLabel: 'Down and delete volumes',
      doneMessage: `${project.repositoryName} taken down, volumes deleted`,
      thing: 'project',
      expectedName: project.repositoryName,
      // Compose projects live in local repositories, so a protected server never asks for a typed name here.
      run: async () => {
        const result = await window.steward.docker.composeAction({
          projectId,
          repositoryId: project.repositoryId,
          action: 'down',
          removeVolumes: true,
          confirmed: true
        });
        if (result.success) setOutput(result.data.output);
        return result;
      }
    });
  }

  return (
    <article className="dptarget">
      <header className="dptarget__head">
        <span className="dptarget__name">{project.repositoryName}</span>
        <span className="card__hint dpmono">{project.file}</span>
      </header>

      {services === null ? (
        <Loading variant="line" lines={3} label="Reading services…" />
      ) : services.length === 0 ? (
        <p className="card__hint">No containers yet. Run Up to create them.</p>
      ) : (
        <ul className="dklist">
          {services.map((service) => {
            const badge = containerBadge(service.state, service.status);
            return (
              <li key={service.name} className="dkrow dkrow--simple">
                <Badge tone={badge.tone} icon={badge.icon} title={service.status}>
                  {badge.label}
                </Badge>
                <span className="dkrow__main dkrow__main--static">
                  <span className="dkrow__name">{service.service}</span>
                  <span className="dkrow__meta dpmono">{service.ports === '' ? service.status : `${service.ports} · ${service.status}`}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="dkcompose__actions">
        {(Object.keys(ACTION_LABEL) as DockerComposeAction[]).map((action) => (
          <Button
            key={action}
            size="sm"
            dangerText={action === 'down'}
            loading={busy === action}
            loadingLabel={`${ACTION_LABEL[action]}…`}
            disabled={busy !== null}
            onClick={() => void run(action)}
          >
            {ACTION_LABEL[action]}
          </Button>
        ))}
        <Button size="sm" dangerText disabled={busy !== null} onClick={askDownWithVolumes}>
          Down + volumes…
        </Button>
      </footer>

      {output !== null && output !== '' && <pre className="dplog">{output}</pre>}

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
    </article>
  );
}

export function ComposeView({
  projectId,
  onError
}: {
  projectId: string;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const [projects, setProjects] = useState<DockerComposeProject[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.steward.docker.composeList({ projectId }).then((result) => {
      if (cancelled) return;
      if (result.success) setProjects(result.data);
      else onError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, onError]);

  if (projects === null) return <p className="card__hint">Looking for Compose files…</p>;
  if (projects.length === 0) {
    return (
      <EmptyState
        title="No Compose files"
        description="None of this project's repositories has a compose.yaml or docker-compose.yml at its root."
      />
    );
  }

  return (
    <section className="dpsection">
      <p className="card__hint">
        Compose projects found at the root of this project&apos;s repositories. They run on this machine.
      </p>
      <div className="dkcompose">
        {projects.map((project) => (
          <ProjectCard key={project.repositoryId} projectId={projectId} project={project} onError={onError} />
        ))}
      </div>
    </section>
  );
}

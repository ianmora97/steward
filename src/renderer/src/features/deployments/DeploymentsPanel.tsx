import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DeployTarget } from '@shared/schemas/deploy-targets';
import type { Deployment } from '@shared/schemas/deployments';
import type { Environment } from '@shared/schemas/environments';
import type { Repository } from '@shared/schemas/repository';
import type { SshHost } from '@shared/schemas/ssh';
import type { StewardError } from '@shared/types/result';
import { ErrorBanner } from '../../components/ErrorBanner';
import { useAppStore } from '../../stores/app.store';
import { DeployModal } from './DeployModal';
import { EnvironmentsView } from './EnvironmentsView';
import { HistoryView } from './HistoryView';
import { TargetsView } from './TargetsView';
import { isActive, targetDestination } from './deployment-meta';
import './deployments.css';
import { Loading } from '../../components/Loading';
import { PageHeader } from '../../components/PageHeader';
import { toast } from '../../stores/toast.store';

type View = 'targets' | 'history' | 'environments';

const VIEW_LABEL: Record<View, string> = { targets: 'Targets', history: 'History', environments: 'Environments' };

/** How often a running deployment is re-read, and how often "x min ago" is refreshed. */
const POLL_MS = 3000;
const CLOCK_MS = 30_000;
const HISTORY_LIMIT = 50;

export function DeploymentsPanel(): React.JSX.Element {
  const projectId = useAppStore((state) => state.selectedProjectId);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [targets, setTargets] = useState<DeployTarget[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<StewardError | null>(null);
  // Until the user picks one, a project with no environments starts where it can create them.
  const [chosenView, setChosenView] = useState<View | null>(null);
  const [deploying, setDeploying] = useState<DeployTarget | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reloadTargets = useCallback(async (): Promise<void> => {
    if (projectId === null) return;
    const result = await window.steward.deployTargets.list({ projectId });
    if (result.success) setTargets(result.data);
    else setError(result.error);
  }, [projectId]);

  const reloadDeployments = useCallback(async (): Promise<void> => {
    if (projectId === null) return;
    const result = await window.steward.deployments.list({ projectId, limit: HISTORY_LIMIT });
    if (result.success) setDeployments(result.data);
    else setError(result.error);
  }, [projectId]);

  useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    void Promise.all([
      window.steward.environments.list({ projectId }),
      window.steward.deployTargets.list({ projectId }),
      window.steward.deployments.list({ projectId, limit: HISTORY_LIMIT }),
      window.steward.ssh.list({ projectId }),
      window.steward.repositories.list({ projectId })
    ]).then(([environmentsResult, targetsResult, deploymentsResult, hostsResult, repositoriesResult]) => {
      if (cancelled) return;
      for (const result of [environmentsResult, targetsResult, deploymentsResult, hostsResult, repositoriesResult]) {
        if (!result.success) setError(result.error);
      }
      if (environmentsResult.success) setEnvironments(environmentsResult.data);
      if (targetsResult.success) setTargets(targetsResult.data);
      if (deploymentsResult.success) setDeployments(deploymentsResult.data);
      if (hostsResult.success) setHosts(hostsResult.data);
      if (repositoriesResult.success) setRepositories(repositoriesResult.data);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Polling runs only while something is waiting for an outcome, and stops by itself when nothing is.
  const hasActive = deployments.some(isActive);
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => {
      void reloadDeployments();
      setNow(Date.now());
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [hasActive, reloadDeployments]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  const hostsById = useMemo(() => new Map(hosts.map((host) => [host.id, host])), [hosts]);
  const repositoriesById = useMemo(
    () => new Map(repositories.map((repository) => [repository.id, repository])),
    [repositories]
  );

  if (projectId === null) return <div className="panel" />;

  const view: View = chosenView ?? (environments.length === 0 ? 'environments' : 'targets');
  const deployingEnvironment =
    deploying === null ? null : (environments.find((environment) => environment.id === deploying.environmentId) ?? null);

  return (
    <div className="panel dppage">
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      <PageHeader
        title="Deployments"
        subtitle="Environments, deploy targets and what was deployed where. A deployment is reported as succeeded only when the provider or the exit code says so."
        actions={
          <div className="segmented" role="group" aria-label="Deployments view">
            {(Object.keys(VIEW_LABEL) as View[]).map((value) => (
              <button
                key={value}
                type="button"
                className={`segmented__option${view === value ? ' segmented__option--active' : ''}`}
                onClick={() => setChosenView(value)}
              >
                {VIEW_LABEL[value]}
              </button>
            ))}
          </div>
        }
      />

      {!loaded && <Loading lines={4} label="Loading deployments…" />}

      {loaded && view === 'targets' && (
        <TargetsView
          projectId={projectId}
          environments={environments}
          targets={targets}
          hosts={hosts}
          repositories={repositories}
          deployments={deployments}
          now={now}
          onDeploy={setDeploying}
          onChanged={() => void reloadTargets()}
          onError={setError}
          onGoToEnvironments={() => setChosenView('environments')}
        />
      )}
      {loaded && view === 'history' && <HistoryView projectId={projectId} deployments={deployments} now={now} />}
      {loaded && view === 'environments' && (
        <EnvironmentsView
          projectId={projectId}
          environments={environments}
          onChanged={setEnvironments}
          onError={setError}
        />
      )}

      {deploying !== null && deployingEnvironment !== null && (
        <DeployModal
          projectId={projectId}
          target={deploying}
          environment={deployingEnvironment}
          destination={targetDestination(deploying, hostsById, repositoriesById)}
          onClose={() => setDeploying(null)}
          onStarted={(started) => {
            toast.success(`Deploy of ${deploying.name} started`);
            setDeployments((current) => [started, ...current]);
            setChosenView('history');
          }}
        />
      )}
    </div>
  );
}

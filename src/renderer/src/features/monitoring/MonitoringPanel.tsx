import { useEffect, useState } from 'react';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Loading } from '../../components/Loading';
import { PageHeader } from '../../components/PageHeader';
import { useAppStore } from '../../stores/app.store';
import { useMonitoringStore } from '../../stores/monitoring.store';
import { DashboardsView } from './DashboardsView';
import { InvestigateView } from './InvestigateView';
import { IssuesView } from './IssuesView';
import { LogsView } from './LogsView';
import { MetricsView } from './MetricsView';
import { ServicesView } from './ServicesView';
import { hasCapability } from './monitoring-meta';
import { SourcesView } from './SourcesView';
import './monitoring.css';

type View = 'sources' | 'investigate' | 'dashboards' | 'logs' | 'metrics' | 'issues' | 'services';

const VIEW_LABEL: Record<View, string> = {
  sources: 'Sources',
  investigate: 'Investigate',
  dashboards: 'Dashboards',
  logs: 'Logs',
  metrics: 'Metrics',
  issues: 'Issues',
  services: 'Services'
};

export function MonitoringPanel(): React.JSX.Element {
  const projectId = useAppStore((state) => state.selectedProjectId);
  const sources = useMonitoringStore((state) => (projectId === null ? undefined : state.sources[projectId]));
  const error = useMonitoringStore((state) => state.error);
  const dismissError = useMonitoringStore((state) => state.dismissError);
  const load = useMonitoringStore((state) => state.load);
  const loadCatalog = useMonitoringStore((state) => state.loadCatalog);
  const [view, setView] = useState<View>('sources');

  useEffect(() => {
    if (projectId === null) return;
    void load(projectId);
    void loadCatalog(projectId);
  }, [projectId, load, loadCatalog]);

  if (projectId === null) return <div className="panel" />;

  // The tabs follow what the configured sources can do, not a fixed list.
  const views: View[] = ['sources'];
  // Investigate and Services need a log or a metrics source to mean anything.
  const canInvestigate = sources !== undefined && (hasCapability(sources, 'logs') || hasCapability(sources, 'metrics'));
  if (canInvestigate) views.push('investigate');
  if (sources !== undefined && hasCapability(sources, 'dashboards')) views.push('dashboards');
  if (sources !== undefined && hasCapability(sources, 'logs')) views.push('logs');
  if (sources !== undefined && hasCapability(sources, 'metrics')) views.push('metrics');
  if (sources !== undefined && hasCapability(sources, 'issues')) views.push('issues');
  if (canInvestigate) views.push('services');
  const shown: View = views.includes(view) ? view : 'sources';

  return (
    <div className="panel mnpage">
      {error !== null && <ErrorBanner error={error} onDismiss={dismissError} />}

      <PageHeader title="Monitoring" subtitle="Logs, metrics and alerts from the tools your team already runs." />

      {sources === undefined ? (
        <Loading lines={3} label="Loading sources…" />
      ) : (
        <>
          <nav className="subtabs" aria-label="Monitoring views">
            {views.map((value) => (
              <button
                key={value}
                type="button"
                className={`subtabs__tab${shown === value ? ' subtabs__tab--active' : ''}`}
                onClick={() => setView(value)}
              >
                {VIEW_LABEL[value]}
              </button>
            ))}
          </nav>

          {shown === 'sources' && <SourcesView projectId={projectId} />}
          {shown === 'investigate' && <InvestigateView projectId={projectId} sources={sources} />}
          {shown === 'dashboards' && <DashboardsView sources={sources} />}
          {shown === 'logs' && <LogsView sources={sources} />}
          {shown === 'metrics' && <MetricsView sources={sources} />}
          {shown === 'issues' && <IssuesView sources={sources} />}
          {shown === 'services' && <ServicesView projectId={projectId} />}
        </>
      )}
    </div>
  );
}

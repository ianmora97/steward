import { useState } from 'react';
import type { ObservabilityServiceEntry, ObservabilitySignal } from '@shared/schemas/observability';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { ListRow } from '../../components/ListRow';
import { Loading } from '../../components/Loading';
import { useAction } from '../../components/useAction';
import { useMonitoringStore } from '../../stores/monitoring.store';
import { ServiceDialog } from './ServiceDialog';
import { SignalDialog } from './SignalDialog';

function describe(service: ObservabilityServiceEntry): string {
  const parts = [service.logSelector, service.metricMatcher === null ? null : `{ ${service.metricMatcher} }`, service.dockerContainer === null ? null : `container ${service.dockerContainer}`];
  const shown = parts.filter((part) => part !== null);
  return shown.length === 0 ? 'Nothing mapped yet' : shown.join('  ·  ');
}

export function ServicesView({ projectId }: { projectId: string }): React.JSX.Element {
  const services = useMonitoringStore((state) => state.services[projectId]);
  const signals = useMonitoringStore((state) => state.signals[projectId]);
  const setServices = useMonitoringStore((state) => state.setServices);
  const setSignals = useMonitoringStore((state) => state.setSignals);
  const [serviceDialog, setServiceDialog] = useState<{ existing: ObservabilityServiceEntry | null } | null>(null);
  const [signalDialog, setSignalDialog] = useState<{ existing: ObservabilitySignal | null } | null>(null);
  const [removingService, setRemovingService] = useState<ObservabilityServiceEntry | null>(null);
  const [removingSignal, setRemovingSignal] = useState<ObservabilitySignal | null>(null);

  const removeService = useAction((service: ObservabilityServiceEntry) => window.steward.observability.removeService({ id: service.id }), {
    success: 'Service removed'
  });
  const removeSignal = useAction((signal: ObservabilitySignal) => window.steward.observability.removeSignal({ id: signal.id }), {
    success: 'Signal removed'
  });
  const reorder = useAction((orderedIds: string[]) => window.steward.observability.reorderSignals({ projectId, orderedIds }), {
    errorTarget: 'toast'
  });

  if (services === undefined || signals === undefined) return <Loading lines={4} label="Loading services…" />;

  async function move(signal: ObservabilitySignal, direction: -1 | 1): Promise<void> {
    const ids = (signals ?? []).map((candidate) => candidate.id);
    const from = ids.indexOf(signal.id);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to] as string, ids[from] as string];
    const next = await reorder.run(ids);
    if (next !== undefined) setSignals(projectId, next);
  }

  return (
    <div className="mnsection">
      <Card>
        <Card.Header title="Services">
          <Button size="sm" icon="plus" onClick={() => setServiceDialog({ existing: null })}>
            Add service
          </Button>
        </Card.Header>
        <Card.Body>
          {services.length === 0 ? (
            <EmptyState
              icon="box"
              title="No services yet"
              description="A service says how to find one part of your system: its log selector in Loki, its labels in Prometheus, and the server and container it runs on. Investigate works from these."
            >
              <Button variant="primary" onClick={() => setServiceDialog({ existing: null })}>
                Add the first service
              </Button>
            </EmptyState>
          ) : (
            <div className="mnlist">
              {services.map((service) => (
                <ListRow
                  key={service.id}
                  icon="box"
                  title={service.name}
                  meta={<span className="mnmono">{describe(service)}</span>}
                  badges={
                    service.environmentName === null ? undefined : (
                      <Badge tone="neutral" icon="tag">
                        {service.environmentName}
                      </Badge>
                    )
                  }
                  actions={
                    <>
                      <IconButton icon="edit" label={`Edit ${service.name}`} onClick={() => setServiceDialog({ existing: service })} />
                      <IconButton icon="trash" tone="danger" label={`Remove ${service.name}`} onClick={() => setRemovingService(service)} />
                    </>
                  }
                />
              ))}
            </div>
          )}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header title="Signals">
          <Button size="sm" icon="plus" onClick={() => setSignalDialog({ existing: null })}>
            Add signal
          </Button>
        </Card.Header>
        <Card.Body>
          <p className="card__hint">
            The queries Investigate draws for a service, written once with {'{{matcher}}'} and {'{{selector}}'}. The first ones are common
            exporter names: edit them to match your metrics.
          </p>
          {signals.length === 0 ? (
            <p className="card__hint">
              {services.length === 0 ? 'Adding the first service brings the usual signals.' : 'No signals. Add the queries you want to watch.'}
            </p>
          ) : (
            <div className="mnlist">
              {signals.map((signal, index) => (
                <ListRow
                  key={signal.id}
                  icon={signal.kind === 'promql' ? 'trendingUp' : 'list'}
                  title={signal.name}
                  meta={<span className="mnmono">{signal.queryTemplate}</span>}
                  badges={signal.unit === '' ? undefined : <Badge tone="neutral" size="sm">{signal.unit}</Badge>}
                  actions={
                    <>
                      <IconButton icon="chevronUp" label={`Move ${signal.name} up`} disabled={index === 0 || reorder.pending} onClick={() => void move(signal, -1)} />
                      <IconButton icon="chevronDown" label={`Move ${signal.name} down`} disabled={index === signals.length - 1 || reorder.pending} onClick={() => void move(signal, 1)} />
                      <IconButton icon="edit" label={`Edit ${signal.name}`} onClick={() => setSignalDialog({ existing: signal })} />
                      <IconButton icon="trash" tone="danger" label={`Remove ${signal.name}`} onClick={() => setRemovingSignal(signal)} />
                    </>
                  }
                />
              ))}
            </div>
          )}
        </Card.Body>
      </Card>

      {serviceDialog !== null && (
        <ServiceDialog
          projectId={projectId}
          existing={serviceDialog.existing}
          onClose={() => setServiceDialog(null)}
          onSaved={() => {
            setServiceDialog(null);
            // The first service also brings the default signals, so both lists are read again.
            void useMonitoringStore.getState().loadCatalog(projectId);
          }}
        />
      )}

      {signalDialog !== null && (
        <SignalDialog
          projectId={projectId}
          existing={signalDialog.existing}
          services={services}
          onClose={() => setSignalDialog(null)}
          onSaved={() => {
            setSignalDialog(null);
            void useMonitoringStore.getState().loadCatalog(projectId);
          }}
        />
      )}

      {removingService !== null && (
        <ConfirmDialog
          title={`Remove ${removingService.name}?`}
          confirmLabel="Remove service"
          onCancel={() => setRemovingService(null)}
          onConfirm={() => {
            const target = removingService;
            setRemovingService(null);
            void removeService.run(target).then((done) => {
              if (done !== undefined) setServices(projectId, (services ?? []).filter((candidate) => candidate.id !== target.id));
            });
          }}
        >
          <p>The service is forgotten by Steward. Nothing changes on your servers, and the signals stay.</p>
        </ConfirmDialog>
      )}

      {removingSignal !== null && (
        <ConfirmDialog
          title={`Remove ${removingSignal.name}?`}
          confirmLabel="Remove signal"
          onCancel={() => setRemovingSignal(null)}
          onConfirm={() => {
            const target = removingSignal;
            setRemovingSignal(null);
            void removeSignal.run(target).then((done) => {
              if (done !== undefined) setSignals(projectId, (signals ?? []).filter((candidate) => candidate.id !== target.id));
            });
          }}
        >
          <p>The signal disappears from every service.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

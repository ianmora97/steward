import { useState } from 'react';
import type { ObservabilitySource } from '@shared/schemas/observability';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { ListRow } from '../../components/ListRow';
import { Loading } from '../../components/Loading';
import { useAction } from '../../components/useAction';
import { useMonitoringStore } from '../../stores/monitoring.store';
import { KIND_ICON, KIND_LABEL, connectionBadge, formatLatency, operationalBadge } from './monitoring-meta';
import { SourceDialog } from './SourceDialog';

function statusLine(source: ObservabilitySource): string {
  const { connection } = source.status;
  if (connection.state === 'connected') {
    return [connection.version === null ? null : `v${connection.version}`, connection.identity, formatLatency(connection.latencyMs)]
      .filter((part) => part !== null)
      .join(' · ');
  }
  return connection.message ?? '';
}

function SourceRow({
  source,
  checking,
  onEdit,
  onRemove
}: {
  source: ObservabilitySource;
  checking: boolean;
  onEdit: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const check = useMonitoringStore((state) => state.check);
  const connection = connectionBadge(source.status.connection.state);
  const operational = operationalBadge(source.status.operational.state);
  const open = useAction(() => window.steward.observability.openUrl({ sourceId: source.id }), { errorTarget: 'toast' });
  const connected = source.status.connection.state === 'connected';

  return (
    <ListRow
      icon={KIND_ICON[source.kind]}
      title={source.name}
      titleHint={source.baseUrl}
      meta={
        <>
          <span className="mnurl">{source.baseUrl}</span>
          {statusLine(source) !== '' && <span> · {statusLine(source)}</span>}
        </>
      }
      badges={
        <>
          <Badge tone="neutral">{KIND_LABEL[source.kind]}</Badge>
          {source.environmentName !== null && (
            <Badge tone="neutral" icon="tag">
              {source.environmentName}
            </Badge>
          )}
          {source.allowInsecureTls && (
            <Badge tone="failure" icon="alert" title="This source accepts any certificate, so its traffic can be impersonated">
              Certificates not verified
            </Badge>
          )}
          <Badge tone={connection.tone} icon={connection.icon} title={source.status.connection.message ?? undefined}>
            {checking ? 'Checking…' : connection.label}
          </Badge>
          {connected && (
            <Badge tone={operational.tone} icon={operational.icon} title={source.status.operational.reasons.join('\n') || undefined}>
              {operational.label}
            </Badge>
          )}
        </>
      }
      actions={
        <>
          <IconButton icon="refresh" label="Test the connection" onClick={() => void check(source.id)} disabled={checking} />
          {source.kind === 'grafana' && <IconButton icon="external" label="Open in the browser" onClick={() => void open.run()} />}
          <IconButton icon="edit" label="Edit the source" onClick={onEdit} />
          <IconButton icon="trash" tone="danger" label="Remove the source" onClick={onRemove} />
        </>
      }
    />
  );
}

export function SourcesView({ projectId }: { projectId: string }): React.JSX.Element {
  const sources = useMonitoringStore((state) => state.sources[projectId]);
  const checking = useMonitoringStore((state) => state.checking);
  const upsert = useMonitoringStore((state) => state.upsert);
  const drop = useMonitoringStore((state) => state.drop);
  const [dialog, setDialog] = useState<{ existing: ObservabilitySource | null } | null>(null);
  const [removing, setRemoving] = useState<ObservabilitySource | null>(null);

  const remove = useAction(
    (source: ObservabilitySource) => window.steward.observability.removeSource({ id: source.id }),
    { success: 'Source removed' }
  );

  async function confirmRemove(source: ObservabilitySource): Promise<void> {
    setRemoving(null);
    if ((await remove.run(source)) !== undefined) drop(projectId, source.id);
  }

  if (sources === undefined) return <Loading lines={3} label="Loading sources…" />;

  return (
    <div className="mnsection">
      <div className="mnsection__bar">
        <p className="card__hint">Read-only: Steward never changes anything on these servers.</p>
        <Button variant="primary" icon="plus" onClick={() => setDialog({ existing: null })}>
          Add source
        </Button>
      </div>

      {sources.length === 0 ? (
        <EmptyState
          icon="pulse"
          title="No sources yet"
          description="Connect Grafana to list its dashboards and active alerts. Use a service account token with the Viewer role."
        >
          <Button variant="primary" onClick={() => setDialog({ existing: null })}>
            Add Grafana
          </Button>
        </EmptyState>
      ) : (
        <div className="mnlist">
          {sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              checking={checking[source.id] === true}
              onEdit={() => setDialog({ existing: source })}
              onRemove={() => setRemoving(source)}
            />
          ))}
        </div>
      )}

      {dialog !== null && (
        <SourceDialog
          projectId={projectId}
          existing={dialog.existing}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            upsert(saved);
            // A new or edited source starts with no answer; ask for it now.
            void useMonitoringStore.getState().check(saved.id);
          }}
        />
      )}

      {removing !== null && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          confirmLabel="Remove source"
          onCancel={() => setRemoving(null)}
          onConfirm={() => void confirmRemove(removing)}
        >
          <p>The source and its stored token are deleted from Steward. Nothing changes on the server.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

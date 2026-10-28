import { useEffect, useMemo, useState } from 'react';
import type { Check, CheckResult, DomainSummary } from '@shared/schemas/cloud';
import type { MetricSeries } from '@shared/schemas/observability';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { Loading } from '../../components/Loading';
import { useAction } from '../../components/useAction';
import { useCloudStore } from '../../stores/cloud.store';
import { timeAgo } from '../github/run-format';
import { TimeSeriesChart, type ChartMarker } from '../monitoring/TimeSeriesChart';
import { CheckDialog } from './CheckDialog';
import { DomainDialog } from './DomainDialog';
import {
  CHECK_KIND_ICON,
  CHECK_KIND_LABEL,
  PROXY_LABEL,
  certificateBadge,
  connectionBadge,
  formatInterval,
  formatLatency,
  operationalBadge,
  resultBadge
} from './cloud-meta';
import { ResultDetail } from './ResultDetail';

/** How many past results are listed before "Show all". */
const HISTORY_SHOWN = 8;
/** Failures marked on the latency chart; more than this is noise. */
const MAX_MARKERS = 12;

function whenText(iso: string): string {
  return `${timeAgo(iso)} · ${new Date(iso).toLocaleString()}`;
}

/** Latency over time, oldest first, with the failures marked on it. */
function chartOf(results: readonly CheckResult[]): { series: MetricSeries[]; markers: ChartMarker[] } {
  const ascending = [...results].reverse();
  const points: [number, number][] = [];
  const markers: ChartMarker[] = [];
  for (const result of ascending) {
    const at = Date.parse(result.ts);
    if (result.latencyMs !== null) points.push([at, result.latencyMs]);
    if (result.status === 'fail') markers.push({ atMs: at, label: 'failed', tone: 'danger' });
  }
  return { series: points.length < 2 ? [] : [{ labels: { __name__: 'response time' }, points }], markers: markers.slice(-MAX_MARKERS) };
}

function History({ results }: { results: readonly CheckResult[] }): React.JSX.Element {
  const [all, setAll] = useState(false);
  const shown = all ? results : results.slice(0, HISTORY_SHOWN);
  return (
    <div className="cdhistory">
      <h4 className="cdhistory__title">History</h4>
      <ul className="cdhistory__list">
        {shown.map((result) => {
          const badge = resultBadge(result.status);
          return (
            <li key={result.id} className="cdhistory__row">
              <Badge tone={badge.tone} icon={badge.icon} size="sm">
                {badge.label}
              </Badge>
              <span className="cdhistory__summary" title={result.summary}>
                {result.summary}
              </span>
              {result.latencyMs !== null && <span className="card__hint">{formatLatency(result.latencyMs)}</span>}
              <span className="card__hint" title={new Date(result.ts).toLocaleString()}>
                {timeAgo(result.ts)}
              </span>
            </li>
          );
        })}
      </ul>
      {!all && results.length > HISTORY_SHOWN && (
        <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
          Show all {results.length}
        </Button>
      )}
    </div>
  );
}

function CheckCard({
  check,
  onEdit,
  onRemove
}: {
  check: Check;
  onEdit: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const results = useCloudStore((state) => state.results[check.id]);
  const loadResults = useCloudStore((state) => state.loadResults);
  const upsertCheck = useCloudStore((state) => state.upsertCheck);

  useEffect(() => {
    void loadResults(check.id);
  }, [check.id, loadResults]);

  const runNow = useAction(() => window.steward.cloud.runCheck({ id: check.id }), { errorTarget: 'toast' });
  const toggle = useAction((enabled: boolean) => window.steward.cloud.updateCheck({ id: check.id, enabled }), { errorTarget: 'toast' });

  const chart = useMemo(() => chartOf(results ?? []), [results]);
  const last = check.lastResult;
  const lastBadge = last === null ? null : resultBadge(last.status);

  async function onToggle(enabled: boolean): Promise<void> {
    const updated = await toggle.run(enabled);
    if (updated !== undefined) upsertCheck(updated);
  }

  return (
    <Card>
      <Card.Header
        title={
          <span className="cdcheck__title">
            {CHECK_KIND_LABEL[check.kind]} <span className="cdmono cdcheck__target">{check.target}</span>
          </span>
        }
      >
        <div className="cdcheck__actions">
          {lastBadge !== null && (
            <Badge tone={lastBadge.tone} icon={lastBadge.icon}>
              {lastBadge.label}
            </Badge>
          )}
          <Badge tone="neutral" icon="clock">
            every {formatInterval(check.intervalSeconds)}
          </Badge>
          <label className="cdswitch" title="A switched-off check does not run and does not count towards the limit of 20">
            <input type="checkbox" checked={check.enabled} disabled={toggle.pending} onChange={(event) => void onToggle(event.target.checked)} />
            <span>Active</span>
          </label>
          <IconButton icon="refresh" label="Run now" loading={runNow.pending} onClick={() => void runNow.run()} />
          <IconButton icon="edit" label="Edit the check" onClick={onEdit} />
          <IconButton icon="trash" tone="danger" label="Delete the check" onClick={onRemove} />
        </div>
      </Card.Header>
      <Card.Body>
        {last === null ? (
          <p className="card__hint">{check.enabled ? 'Waiting for the first result…' : 'Switched off. Run it now to see a result.'}</p>
        ) : (
          <>
            <p className="cdcheck__summary">
              {last.summary} <span className="card__hint">· {whenText(last.ts)}</span>
            </p>
            <ResultDetail kind={check.kind} result={last} />
          </>
        )}
        {chart.series.length > 0 && <TimeSeriesChart series={chart.series} markers={chart.markers} height={150} unit="ms" showLegend={false} />}
        {results === undefined ? <Loading lines={2} label="Loading history…" /> : results.length > 0 && <History results={results} />}
      </Card.Body>
    </Card>
  );
}

export function DomainDetail({
  projectId,
  domainId,
  onBack
}: {
  projectId: string;
  domainId: string;
  onBack: () => void;
}): React.JSX.Element {
  const domain: DomainSummary | undefined = useCloudStore((state) => state.domains[projectId]?.find((candidate) => candidate.id === domainId));
  const checks = useCloudStore((state) => state.checks[domainId]);
  const loadChecks = useCloudStore((state) => state.loadChecks);
  const upsertCheck = useCloudStore((state) => state.upsertCheck);
  const dropCheck = useCloudStore((state) => state.dropCheck);
  const [dialog, setDialog] = useState<{ existing: Check | null } | null>(null);
  const [removing, setRemoving] = useState<Check | null>(null);
  const [editingDomain, setEditingDomain] = useState(false);
  const [removingDomain, setRemovingDomain] = useState(false);
  const upsertDomain = useCloudStore((state) => state.upsert);
  const dropDomain = useCloudStore((state) => state.drop);

  useEffect(() => {
    void loadChecks(domainId);
  }, [domainId, loadChecks]);

  const remove = useAction((check: Check) => window.steward.cloud.removeCheck({ id: check.id, confirmed: true }), { success: 'Check deleted' });
  const removeDomain = useAction((id: string) => window.steward.cloud.removeDomain({ id, confirmed: true }), { success: 'Domain removed' });

  async function confirmRemoveDomain(): Promise<void> {
    setRemovingDomain(false);
    if ((await removeDomain.run(domainId)) !== undefined) {
      dropDomain(projectId, domainId);
      onBack();
    }
  }

  async function confirmRemove(check: Check): Promise<void> {
    setRemoving(null);
    if ((await remove.run(check)) !== undefined) dropCheck(domainId, check.id);
  }

  // The domain was deleted from somewhere else, or the project changed: nothing left to show.
  if (domain === undefined) {
    return (
      <EmptyState icon="globe" title="That domain is gone" description="It was removed, or it belongs to another project.">
        <Button onClick={onBack}>Back to the VPC</Button>
      </EmptyState>
    );
  }

  const connection = connectionBadge(domain.connection);
  const operational = operationalBadge(domain.operational);
  const certificate = domain.certDaysLeft === null ? null : certificateBadge(domain.certDaysLeft);

  return (
    <div className="cdsection">
      <div className="cdsection__bar">
        <div className="cddomainhead">
          <IconButton icon="chevronLeft" label="Back to the VPC" bordered onClick={onBack} />
          <h3 className="cddomainhead__name cdmono">{domain.hostname}</h3>
          <Badge tone={connection.tone} icon={connection.icon}>
            {connection.label}
          </Badge>
          <Badge tone={operational.tone} icon={operational.icon}>
            {operational.label}
          </Badge>
          {certificate !== null && <Badge tone={certificate.tone}>{certificate.label}</Badge>}
          {domain.proxy !== null && <Badge tone="neutral">{PROXY_LABEL[domain.proxy]}</Badge>}
          {domain.sshHostName !== null && (
            <Badge tone="neutral" icon="hardDrive">
              {domain.sshHostName}
            </Badge>
          )}
        </div>
        <div className="cddomainhead__actions">
          <IconButton icon="edit" label="Edit the domain" onClick={() => setEditingDomain(true)} />
          <IconButton icon="trash" tone="danger" label="Remove the domain" onClick={() => setRemovingDomain(true)} />
          <Button variant="primary" icon="plus" onClick={() => setDialog({ existing: null })}>
            Add check
          </Button>
        </div>
      </div>

      {checks === undefined ? (
        <Loading lines={3} label="Loading checks…" />
      ) : checks.length === 0 ? (
        <EmptyState
          icon={CHECK_KIND_ICON.http}
          title="No checks on this domain"
          description="Add a check for its DNS, its certificate or its web page. Checks run only while Steward is open."
        >
          <Button variant="primary" onClick={() => setDialog({ existing: null })}>
            Add a check
          </Button>
        </EmptyState>
      ) : (
        <div className="cdchecks">
          {checks.map((check) => (
            <CheckCard key={check.id} check={check} onEdit={() => setDialog({ existing: check })} onRemove={() => setRemoving(check)} />
          ))}
        </div>
      )}

      {dialog !== null && (
        <CheckDialog
          domain={domain}
          existing={dialog.existing}
          onClose={() => setDialog(null)}
          onSaved={(saved) => {
            setDialog(null);
            upsertCheck(saved);
          }}
        />
      )}

      {editingDomain && (
        <DomainDialog
          projectId={projectId}
          existing={domain}
          onClose={() => setEditingDomain(false)}
          onSaved={(saved) => {
            setEditingDomain(false);
            upsertDomain(saved);
          }}
        />
      )}

      {removingDomain && (
        <ConfirmDialog
          title={`Remove ${domain.hostname}?`}
          confirmLabel="Remove domain"
          onCancel={() => setRemovingDomain(false)}
          onConfirm={() => void confirmRemoveDomain()}
        >
          <p>The domain, its checks and their history are deleted from Steward. Nothing changes on the domain itself.</p>
        </ConfirmDialog>
      )}

      {removing !== null && (
        <ConfirmDialog
          title={`Delete the ${CHECK_KIND_LABEL[removing.kind]} check?`}
          confirmLabel="Delete check"
          onCancel={() => setRemoving(null)}
          onConfirm={() => void confirmRemove(removing)}
        >
          <p>The check and its history are deleted from Steward. Nothing changes on {domain.hostname}.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

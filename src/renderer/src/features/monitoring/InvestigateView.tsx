import { useEffect, useMemo, useState } from 'react';
import type {
  InvestigatePreset,
  InvestigateResult,
  LogLine,
  ObservabilityServiceEntry,
  ObservabilitySource,
  SignalSeries
} from '@shared/schemas/observability';
import type { StewardError } from '@shared/types/result';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBanner } from '../../components/ErrorBanner';
import { IconButton } from '../../components/IconButton';
import { ListRow } from '../../components/ListRow';
import { Loading } from '../../components/Loading';
import { useAppStore } from '../../stores/app.store';
import { useMonitoringStore } from '../../stores/monitoring.store';
import { chartMarkers, formatChange, formatWhen } from './investigate-format';
import { LogDetail, LogList, lineKey } from './LogList';
import { formatMetricValue, TimeSeriesChart } from './TimeSeriesChart';
import { Timeline } from './Timeline';

const PRESET_LABEL: Record<InvestigatePreset, string> = {
  '15m': '15 m',
  '1h': '1 h',
  '6h': '6 h',
  '24h': '24 h',
  since_last_deploy: 'Since last deploy'
};

const STATE_TONE: Record<string, 'success' | 'failure' | 'warning' | 'neutral'> = {
  running: 'success',
  exited: 'failure',
  dead: 'failure',
  missing: 'failure',
  paused: 'warning',
  restarting: 'warning'
};

function serviceLabel(service: ObservabilityServiceEntry): string {
  return service.environmentName === null ? service.name : `${service.name} · ${service.environmentName}`;
}

function SignalCard({ signal, markers }: { signal: SignalSeries; markers: ReturnType<typeof chartMarkers> }): React.JSX.Element {
  return (
    <Card>
      <Card.Header title={signal.name}>{signal.unit !== '' && <Badge tone="neutral" size="sm">{signal.unit}</Badge>}</Card.Header>
      <Card.Body>
        {signal.result.ok ? (
          <>
            <TimeSeriesChart series={signal.result.data.series} markers={markers} height={160} unit={signal.unit} showLegend={signal.result.data.series.length > 1} />
            {signal.result.data.truncated && <p className="card__hint">Drawing {signal.result.data.series.length} of {signal.result.data.totalSeries} series.</p>}
          </>
        ) : (
          <p className="mnsignal__error">
            {signal.result.message}
            {signal.result.details !== undefined && <span className="card__hint"> {signal.result.details}</span>}
          </p>
        )}
      </Card.Body>
    </Card>
  );
}

export function InvestigateView({ projectId, sources }: { projectId: string; sources: ObservabilitySource[] }): React.JSX.Element {
  const services = useMonitoringStore((state) => state.services[projectId]);
  const setActiveTab = useAppStore((state) => state.setActiveTab);

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [preset, setPreset] = useState<InvestigatePreset>('1h');
  const [pattern, setPattern] = useState('');
  const [appliedPattern, setAppliedPattern] = useState('');
  const [logsSourceId, setLogsSourceId] = useState('');
  const [metricsSourceId, setMetricsSourceId] = useState('');
  const [token, setToken] = useState(0);
  // The answer carries the request it belongs to: a newer request never shows an older answer, and "loading" is just "not there yet".
  const [answer, setAnswer] = useState<{ key: string; result: InvestigateResult | null; error: StewardError | null } | null>(null);
  const [selectedLine, setSelectedLine] = useState<LogLine | null>(null);

  const service = services?.find((candidate) => candidate.id === serviceId) ?? services?.[0] ?? null;
  const currentServiceId = service?.id ?? null;
  const key = `${currentServiceId}|${preset}|${appliedPattern}|${logsSourceId}|${metricsSourceId}|${token}`;
  const loading = currentServiceId !== null && (answer === null || answer.key !== key);

  const lokis = sources.filter((source) => source.kind === 'loki');
  const prometheuses = sources.filter((source) => source.kind === 'prometheus');

  useEffect(() => {
    if (currentServiceId === null) return;
    let cancelled = false;
    void window.steward.observability
      .investigate({
        projectId,
        serviceId: currentServiceId,
        preset,
        ...(appliedPattern === '' ? {} : { errorPattern: appliedPattern }),
        ...(logsSourceId === '' ? {} : { logsSourceId }),
        ...(metricsSourceId === '' ? {} : { metricsSourceId })
      })
      .then((response) => {
        if (cancelled) return;
        setAnswer({ key, result: response.success ? response.data : null, error: response.success ? null : response.error });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, currentServiceId, preset, appliedPattern, logsSourceId, metricsSourceId, key]);

  const result = answer !== null && answer.key === key ? answer.result : null;
  const error = answer !== null && answer.key === key ? answer.error : null;

  const deploys = result?.deploys.ok === true ? result.deploys.data : null;
  const alerts = result?.alerts.ok === true ? result.alerts.data : null;
  const markers = useMemo(
    () => (result === null ? [] : chartMarkers(deploys ?? [], alerts ?? [], result.window.fetchFromMs, result.window.toMs)),
    [result, deploys, alerts]
  );

  if (services === undefined) return <Loading lines={3} label="Loading services…" />;

  if (service === null) {
    return (
      <EmptyState
        icon="compass"
        title="No services to investigate"
        description="Describe a service first: where to find it in Loki and Prometheus and where it runs. Investigate works from that."
      />
    );
  }

  return (
    <div className="mnsection">
      <Card>
        <Card.Body>
          <div className="mnsection__bar">
            <div className="mnrange">
              <select className="field__input mnselect" value={service.id} onChange={(event) => setServiceId(event.target.value)} aria-label="Service">
                {services.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {serviceLabel(candidate)}
                  </option>
                ))}
              </select>
              <div className="segmented" role="group" aria-label="Window">
                {(Object.keys(PRESET_LABEL) as InvestigatePreset[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`segmented__option${preset === value ? ' segmented__option--active' : ''}`}
                    onClick={() => setPreset(value)}
                  >
                    {PRESET_LABEL[value]}
                  </button>
                ))}
              </div>
              <IconButton icon="refresh" label="Investigate again" loading={loading} onClick={() => setToken((value) => value + 1)} />
            </div>
          </div>
          {(lokis.length > 1 || prometheuses.length > 1) && (
            <div className="mnrange">
              {lokis.length > 1 && (
                <select className="field__input mnselect" value={logsSourceId} onChange={(event) => setLogsSourceId(event.target.value)} aria-label="Loki source">
                  <option value="">Loki: automatic</option>
                  {lokis.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              )}
              {prometheuses.length > 1 && (
                <select className="field__input mnselect" value={metricsSourceId} onChange={(event) => setMetricsSourceId(event.target.value)} aria-label="Prometheus source">
                  <option value="">Prometheus: automatic</option>
                  {prometheuses.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {result !== null && (
            <p className="card__hint">
              {formatWhen(result.window.fromMs)} – {formatWhen(result.window.toMs)}
              {result.window.clamped ? ' · limited to the last 24 hours, the most Loki answers at a time' : ''}
              {result.window.noDeployFound ? ' · this service has no deploy yet, so the last hour is shown' : ''}
              {result.sources.logs === null && result.sources.metrics === null ? ' · no Loki or Prometheus source is connected' : ''}
            </p>
          )}
        </Card.Body>
      </Card>

      {error !== null && <ErrorBanner error={error} onDismiss={() => setAnswer(null)} />}
      {loading && <Loading variant="card" lines={3} label="Investigating…" />}

      {result !== null && !loading && (
        <>
          <Card>
            <Card.Header title="Timeline" />
            <Card.Body>
              {result.deploys.ok ? (
                <Timeline
                  deploys={result.deploys.data}
                  alerts={alerts ?? []}
                  fromMs={result.window.fetchFromMs}
                  toMs={result.window.toMs}
                  onOpenDeployments={() => setActiveTab('deployments')}
                />
              ) : (
                <p className="mnsignal__error">{result.deploys.message}</p>
              )}
              {!result.alerts.ok && <p className="card__hint">Alerts: {result.alerts.message}</p>}
            </Card.Body>
          </Card>

          {result.container.ok && result.container.data !== null && (
            <Card>
              <Card.Header title="Container">
                <Button size="sm" icon="docker" onClick={() => setActiveTab('docker')}>
                  Open Docker
                </Button>
              </Card.Header>
              <Card.Body>
                <div className="mnresult">
                  <Badge tone={STATE_TONE[result.container.data.state] ?? 'neutral'}>{result.container.data.state}</Badge>
                  <span className="mnresult__text">
                    <span className="mnmono">{result.container.data.name}</span> on {result.container.data.serverName} · {result.container.data.status}
                    {result.container.data.image === '' ? '' : ` · ${result.container.data.image}`}
                  </span>
                </div>
              </Card.Body>
            </Card>
          )}
          {!result.container.ok && <p className="card__hint">Container: {result.container.message}</p>}

          {result.signals.length > 0 && (
            <div className="mngrid">
              {result.signals.map((signal) => (
                <SignalCard key={signal.signalId} signal={signal} markers={markers} />
              ))}
            </div>
          )}

          <Card>
            <Card.Header title="Error logs">
              {result.sources.logs !== null && <span className="card__hint">{result.sources.logs.name}</span>}
            </Card.Header>
            <Card.Body>
              <div className="mnbuilder">
                <input
                  className="field__input mnsearch mnmono"
                  value={pattern}
                  onChange={(event) => setPattern(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setAppliedPattern(pattern.trim());
                  }}
                  placeholder="(?i)error|exception|panic|fatal"
                  aria-label="Error line pattern"
                  spellCheck={false}
                />
                <Button size="sm" onClick={() => setAppliedPattern(pattern.trim())}>
                  Apply pattern
                </Button>
              </div>
              {result.errorLogs.ok ? (
                <>
                  <p className="card__hint mnmono">{result.errorLogs.data.query}</p>
                  {result.errorLogs.data.result.lines.length === 0 ? (
                    <p className="card__hint">No error lines in this window.</p>
                  ) : (
                    <LogList
                      lines={result.errorLogs.data.result.lines}
                      selected={selectedLine !== null && result.errorLogs.data.result.lines.some((line) => lineKey(line) === lineKey(selectedLine)) ? selectedLine : null}
                      onSelect={setSelectedLine}
                    />
                  )}
                  {result.errorLogs.data.result.truncated && <p className="card__hint">Showing the {result.errorLogs.data.result.lines.length} most recent error lines.</p>}
                  {selectedLine !== null && <LogDetail line={selectedLine} onClose={() => setSelectedLine(null)} />}
                </>
              ) : (
                <p className="mnsignal__error">
                  {result.errorLogs.message}
                  {result.errorLogs.details !== undefined && <span className="card__hint"> {result.errorLogs.details}</span>}
                </p>
              )}
            </Card.Body>
          </Card>

          {result.issues.ok && (
            <Card>
              <Card.Header title="Sentry issues" />
              <Card.Body>
                {result.issues.data.byRelease.length > 0 && (
                  <ul className="mntimeline__list">
                    {result.issues.data.byRelease.map((row) => (
                      <li key={row.deployId} className="mntimeline__item">
                        <span className="mnmono">release {row.release.slice(0, 12)}</span>
                        <Badge tone={row.count === 0 ? 'success' : 'warning'} size="sm">
                          {row.count === 0 ? 'no unresolved issues' : `${row.count} unresolved`}
                        </Badge>
                        {row.titles.length > 0 && <span className="card__hint">{row.titles.join(' · ')}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {result.issues.data.issues.length === 0 ? (
                  <p className="card__hint">No unresolved issue seen in this window.</p>
                ) : (
                  <div className="mnlist">
                    {result.issues.data.issues.map((issue) => (
                      <ListRow
                        key={issue.id}
                        icon="bug"
                        title={issue.title}
                        meta={`${issue.shortId} · ${issue.count} events`}
                        badges={<Badge tone={issue.level === 'error' || issue.level === 'fatal' ? 'failure' : 'warning'} size="sm">{issue.level}</Badge>}
                      />
                    ))}
                  </div>
                )}
                <p className="card__hint">Releases are matched to deploys by commit: name each Sentry release after the commit it was built from.</p>
              </Card.Body>
            </Card>
          )}
          {!result.issues.ok && result.issues.code !== 'OBS_NOT_SUPPORTED' && <p className="card__hint">Sentry: {result.issues.message}</p>}

          <Card>
            <Card.Header title="Before and after each deploy" />
            <Card.Body>
              <p className="card__hint">
                The average of each signal in the same stretch of time before and after a deploy. A difference is a lead to follow, not proof of
                cause: other things change at the same time.
              </p>
              {result.comparison.length === 0 ? (
                <p className="card__hint">No finished deploy in this window, or no signal answered.</p>
              ) : (
                <table className="mntable">
                  <thead>
                    <tr>
                      <th>Deploy</th>
                      <th>Signal</th>
                      <th className="mntable__num">Before</th>
                      <th className="mntable__num">After</th>
                      <th className="mntable__num">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...result.comparison]
                      .sort((a, b) => b.deployAtMs - a.deployAtMs)
                      .map((row) => (
                        <tr key={`${row.deployId}-${row.signalId}`}>
                          <td>
                            <span className="mnmono">{row.deployLabel}</span> <span className="card__hint">{formatWhen(row.deployAtMs)} · ±{row.windowMinutes} min</span>
                          </td>
                          <td>{row.signalName}</td>
                          {row.note === 'ok' ? (
                            <>
                              <td className="mntable__num mntable__mono">{row.before === null ? '—' : formatMetricValue(row.before, row.unit)}</td>
                              <td className="mntable__num mntable__mono">{row.after === null ? '—' : formatMetricValue(row.after, row.unit)}</td>
                              <td className="mntable__num mntable__mono">{formatChange(row.changePct)}</td>
                            </>
                          ) : (
                            <td colSpan={3} className="mntable__num card__hint">
                              {row.note === 'too_recent' ? 'Too recent to compare' : 'No data around this deploy'}
                            </td>
                          )}
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </Card.Body>
          </Card>
        </>
      )}
    </div>
  );
}

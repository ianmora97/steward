import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogLine, LokiQueryResult, LokiVolumeResult, ObservabilitySource } from '@shared/schemas/observability';
import { LOKI_DEFAULT_LIMIT } from '@shared/schemas/observability';
import type { StewardError } from '@shared/types/result';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Field } from '../../components/Field';
import { toast } from '../../stores/toast.store';
import { addMatcher } from './log-format';
import { lineKey, LogDetail, LogList } from './LogList';
import { DEFAULT_RANGE, resolveRange, TimeRange, type RangeChoice, type RangePreset } from './TimeRange';
import { seriesLabel, TimeSeriesChart } from './TimeSeriesChart';

const PRESETS: readonly RangePreset[] = ['15m', '1h', '6h', '24h'];
const LIMITS = [500, 1000, 2000, 5000] as const;
/** Live mode keeps this many lines; older ones fall off so a busy service cannot grow the page without end. */
const MAX_LIVE_LINES = 5000;

/** One Loki: the query, its volume, the lines and the live tail. Remounted (by `key`) for another source. */
function LokiExplorer({ source }: { source: ObservabilitySource }): React.JSX.Element {
  const sourceId = source.id;
  const [labels, setLabels] = useState<string[] | null>(null);
  const [labelsError, setLabelsError] = useState<StewardError | null>(null);
  const [builderLabel, setBuilderLabel] = useState('');
  const [values, setValues] = useState<{ label: string; values: string[] } | null>(null);
  const [builderValue, setBuilderValue] = useState('');

  const [query, setQuery] = useState('');
  const [range, setRange] = useState<RangeChoice>(DEFAULT_RANGE);
  const [limit, setLimit] = useState<number>(LOKI_DEFAULT_LIMIT);
  const [result, setResult] = useState<LokiQueryResult | null>(null);
  const [volume, setVolume] = useState<LokiVolumeResult | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<StewardError | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<LogLine | null>(null);

  const [live, setLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const liveId = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const pending = useRef<LogLine[]>([]);
  const runId = useRef(0);

  // The labels of this Loki, for the selector builder.
  useEffect(() => {
    let cancelled = false;
    void window.steward.observability.lokiLabels({ sourceId }).then((response) => {
      if (cancelled) return;
      if (response.success) setLabels(response.data.labels);
      else {
        setLabels([]);
        setLabelsError(response.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  // Lines of a live tail arrive as events; only the tail this view started is listened to.
  useEffect(() => {
    const offLines = window.steward.observability.onLiveLogs((event) => {
      if (event.subscriptionId !== liveId.current) return;
      const newestFirst = [...event.lines].reverse();
      if (pausedRef.current) {
        pending.current = [...newestFirst, ...pending.current].slice(0, MAX_LIVE_LINES);
        setPendingCount(pending.current.length);
      } else {
        setLines((current) => [...newestFirst, ...current].slice(0, MAX_LIVE_LINES));
      }
    });
    const offEnd = window.steward.observability.onLiveLogsEnd((event) => {
      if (event.subscriptionId !== liveId.current) return;
      liveId.current = null;
      setLive(false);
      setPaused(false);
      pausedRef.current = false;
      toast.error(event.reason);
    });
    return () => {
      offLines();
      offEnd();
      // Leaving the view ends the tail: nothing may keep polling Loki without a page to show it.
      const id = liveId.current;
      liveId.current = null;
      if (id !== null) void window.steward.observability.lokiStopLive({ subscriptionId: id });
    };
  }, []);

  async function chooseLabel(name: string): Promise<void> {
    setBuilderLabel(name);
    setBuilderValue('');
    setValues(null);
    if (name === '') return;
    const response = await window.steward.observability.lokiLabelValues({ sourceId, name });
    if (response.success) setValues({ label: name, values: response.data.values });
    else setError(response.error);
  }

  async function stopLive(): Promise<void> {
    const id = liveId.current;
    liveId.current = null;
    setLive(false);
    setPaused(false);
    pausedRef.current = false;
    pending.current = [];
    setPendingCount(0);
    if (id !== null) await window.steward.observability.lokiStopLive({ subscriptionId: id });
  }

  async function run(): Promise<void> {
    if (query.trim() === '') return;
    const resolved = resolveRange(range, PRESETS);
    if (resolved === null) {
      setError({ code: 'VALIDATION_FAILED', message: 'Pick both ends of the custom range.' });
      return;
    }
    if (live) await stopLive();
    const current = (runId.current += 1);
    setRunning(true);
    setError(null);
    setSelected(null);
    const [queried, counted] = await Promise.all([
      window.steward.observability.lokiQuery({ sourceId, query, fromMs: resolved.fromMs, toMs: resolved.toMs, limit }),
      // The histogram is a nicety: a query it cannot wrap (a metric query) just goes without one.
      window.steward.observability.lokiVolume({ sourceId, query, fromMs: resolved.fromMs, toMs: resolved.toMs })
    ]);
    if (current !== runId.current) return;
    setRunning(false);
    if (!queried.success) {
      setError(queried.error);
      setResult(null);
      setLines([]);
      setVolume(null);
      return;
    }
    setResult(queried.data);
    setLines(queried.data.lines);
    setVolume(counted.success && queried.data.matrix === null ? counted.data : null);
  }

  async function startLive(): Promise<void> {
    if (query.trim() === '') return;
    setError(null);
    setSelected(null);
    runId.current += 1;
    const started = await window.steward.observability.lokiStartLive({ sourceId, query });
    if (!started.success) {
      setError(started.error);
      return;
    }
    liveId.current = started.data.subscriptionId;
    pending.current = [];
    setPendingCount(0);
    setResult({ lines: [], truncated: false, matrix: null });
    setVolume(null);
    setLines([]);
    setLive(true);
  }

  function togglePause(): void {
    if (paused) {
      const queued = pending.current;
      pending.current = [];
      setPendingCount(0);
      setLines((current) => [...queued, ...current].slice(0, MAX_LIVE_LINES));
    }
    pausedRef.current = !paused;
    setPaused(!paused);
  }

  const needle = filter.trim().toLowerCase();
  const visible = useMemo(() => (needle === '' ? lines : lines.filter((line) => line.line.toLowerCase().includes(needle))), [lines, needle]);
  const stillThere = selected !== null && visible.some((line) => lineKey(line) === lineKey(selected));

  return (
    <>
      <Card>
        <Card.Body>
          {labelsError !== null && <ErrorBanner error={labelsError} onDismiss={() => setLabelsError(null)} />}
          <div className="mnbuilder">
            <select className="field__input mnselect" value={builderLabel} onChange={(event) => void chooseLabel(event.target.value)} aria-label="Label" disabled={labels === null}>
              <option value="">{labels === null ? 'Loading labels…' : 'Label…'}</option>
              {(labels ?? []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className="field__input mnselect"
              value={builderValue}
              onChange={(event) => setBuilderValue(event.target.value)}
              aria-label="Label value"
              disabled={values === null || values.label !== builderLabel}
            >
              <option value="">Value…</option>
              {(values?.label === builderLabel ? values.values : []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              icon="plus"
              disabled={builderLabel === '' || builderValue === ''}
              onClick={() => setQuery((current) => addMatcher(current, builderLabel, builderValue))}
            >
              Add to selector
            </Button>
          </div>

          <Field label="LogQL" hint="Ctrl + Enter runs the query. Lines are scanned for tokens and passwords before they are shown: a net of patterns, not a guarantee.">
            <textarea
              className="field__input mnquery"
              rows={2}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void run();
                }
              }}
              placeholder='{app="api"} |= "error"'
              spellCheck={false}
              aria-label="LogQL query"
            />
          </Field>

          <div className="mnsection__bar">
            <TimeRange value={range} onChange={setRange} presets={PRESETS} />
            <div className="mnrange">
              <select className="field__input mnselect" value={limit} onChange={(event) => setLimit(Number(event.target.value))} aria-label="Line limit">
                {LIMITS.map((value) => (
                  <option key={value} value={value}>
                    {value} lines
                  </option>
                ))}
              </select>
              <Button variant="primary" icon="arrowRight" loading={running} loadingLabel="Running…" disabled={query.trim() === ''} onClick={() => void run()}>
                Run query
              </Button>
              <Button
                icon="pulse"
                disabled={query.trim() === '' && !live}
                onClick={() => void (live ? stopLive() : startLive())}
                className={live ? 'mnlive mnlive--on' : 'mnlive'}
              >
                {live ? 'Stop live' : 'Live'}
              </Button>
            </div>
          </div>
        </Card.Body>
      </Card>

      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {result !== null && result.matrix !== null && (
        <Card>
          <Card.Header title="Result" />
          <Card.Body>
            <TimeSeriesChart series={result.matrix} />
            <ul className="mnchart__legend">
              {result.matrix.slice(0, 6).map((series, position) => (
                <li key={`${seriesLabel(series.labels)}-${position}`}>{seriesLabel(series.labels)}</li>
              ))}
            </ul>
          </Card.Body>
        </Card>
      )}

      {result !== null && result.matrix === null && (
        <Card>
          <Card.Header title={live ? 'Live' : 'Logs'}>
            <div className="mnrange">
              {live && (
                <>
                  <Badge tone={paused ? 'warning' : 'success'} icon={paused ? 'minusCircle' : 'pulse'}>
                    {paused ? `Paused · ${pendingCount} new` : 'Following'}
                  </Badge>
                  <Button size="sm" onClick={togglePause}>
                    {paused ? 'Resume' : 'Pause'}
                  </Button>
                </>
              )}
              <input
                className="field__input mnsearch"
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter these lines"
                aria-label="Filter these lines"
              />
            </div>
          </Card.Header>
          <Card.Body>
            {volume !== null && volume.series.length > 0 && (
              <div className="mnvolume">
                <TimeSeriesChart series={volume.series} variant="bars" height={96} showLegend={false} />
                <p className="card__hint">Lines per {volume.stepSeconds} s</p>
              </div>
            )}
            {visible.length === 0 ? (
              <p className="card__hint">
                {live ? 'Waiting for new lines…' : lines.length === 0 ? 'No lines matched in this range.' : 'No line contains that text.'}
              </p>
            ) : (
              <LogList lines={visible} selected={stillThere ? selected : null} onSelect={setSelected} keepPosition={live} />
            )}
            {!live && result.truncated && (
              <p className="card__hint">
                Showing the {lines.length} most recent lines. Narrow the selector or the range to see the rest.
              </p>
            )}
            {!live && lines.length > 0 && (
              <p className="card__hint">
                {needle === '' ? `${lines.length} lines` : `${visible.length} of ${lines.length} lines`}
              </p>
            )}
            {stillThere && selected !== null && <LogDetail line={selected} onClose={() => setSelected(null)} />}
          </Card.Body>
        </Card>
      )}
    </>
  );
}

export function LogsView({ sources }: { sources: ObservabilitySource[] }): React.JSX.Element {
  const lokis = sources.filter((source) => source.kind === 'loki');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const source = lokis.find((candidate) => candidate.id === selectedId) ?? lokis[0] ?? null;

  if (source === null) {
    return <EmptyState icon="list" title="No Loki source" description="Add a Loki source (directly or through Grafana) in the Sources view." />;
  }

  return (
    <div className="mnsection">
      {lokis.length > 1 && (
        <div className="mnsection__bar">
          <select className="field__input mnselect" value={source.id} onChange={(event) => setSelectedId(event.target.value)} aria-label="Loki source">
            {lokis.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <LokiExplorer key={source.id} source={source} />
    </div>
  );
}

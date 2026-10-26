import { useRef, useState } from 'react';
import type { ObservabilitySource, PrometheusInstantResult, PrometheusRangeResult } from '@shared/schemas/observability';
import type { StewardError } from '@shared/types/result';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Field } from '../../components/Field';
import { PrometheusStatus } from './PrometheusStatus';
import { DEFAULT_RANGE, resolveRange, TimeRange, type RangeChoice, type RangePreset } from './TimeRange';
import { seriesLabel, TimeSeriesChart } from './TimeSeriesChart';

const PRESETS: readonly RangePreset[] = ['15m', '1h', '6h', '24h', '7d'];
const TOKEN = /[A-Za-z_:][A-Za-z0-9_:]*$/;

type Section = 'query' | 'targets' | 'alerts';
type Mode = 'graph' | 'table';

const SECTION_LABEL: Record<Section, string> = { query: 'Query', targets: 'Targets', alerts: 'Alerts' };

/** The metric name being typed at the caret, unless the caret is inside a `{label="…"}` matcher. */
function tokenAt(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  if (before.lastIndexOf('{') > before.lastIndexOf('}')) return null;
  const match = TOKEN.exec(before);
  return match !== null && match[0].length >= 2 ? match[0] : null;
}

/** One Prometheus: the query, its graph and table. Remounted (by `key`) for another source, so nothing of the old one lingers. */
function PrometheusQuery({ source }: { source: ObservabilitySource }): React.JSX.Element {
  const sourceId = source.id;
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<RangeChoice>(DEFAULT_RANGE);
  const [mode, setMode] = useState<Mode>('graph');
  const [graph, setGraph] = useState<PrometheusRangeResult | null>(null);
  const [table, setTable] = useState<PrometheusInstantResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<StewardError | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  // Only the latest run may write its answer: an older, slower one would otherwise overwrite a newer result.
  const runId = useRef(0);

  async function run(): Promise<void> {
    if (query.trim() === '') return;
    const resolved = resolveRange(range, PRESETS);
    if (resolved === null) {
      setError({ code: 'VALIDATION_FAILED', message: 'Pick both ends of the custom range.' });
      return;
    }
    const current = (runId.current += 1);
    setRunning(true);
    setError(null);
    const [rangeResult, instantResult] = await Promise.all([
      window.steward.observability.prometheusRange({ sourceId, query, fromMs: resolved.fromMs, toMs: resolved.toMs }),
      window.steward.observability.prometheusQuery({ sourceId, query, timeMs: resolved.toMs })
    ]);
    if (current !== runId.current) return;
    setRunning(false);
    setGraph(rangeResult.success ? rangeResult.data : null);
    setTable(instantResult.success ? instantResult.data : null);
    // A query that only works one way (a range selector has no graph) still shows the part that does.
    setError(!rangeResult.success && !instantResult.success ? rangeResult.error : !rangeResult.success && mode === 'graph' ? rangeResult.error : null);
  }

  function onQueryChange(value: string, caret: number): void {
    setQuery(value);
    const prefix = tokenAt(value, caret);
    if (prefix === null) {
      setSuggestions([]);
      return;
    }
    void window.steward.observability.prometheusMetricNames({ sourceId, prefix }).then((result) => {
      // The text may have moved on while the answer travelled.
      if (result.success && area.current !== null && tokenAt(area.current.value, area.current.selectionStart) === prefix) {
        setSuggestions(result.data.names.filter((name) => name !== prefix).slice(0, 8));
      }
    });
  }

  function accept(name: string): void {
    const element = area.current;
    if (element === null) return;
    const caret = element.selectionStart;
    const prefix = tokenAt(element.value, caret);
    if (prefix === null) return;
    setQuery(`${element.value.slice(0, caret - prefix.length)}${name}${element.value.slice(caret)}`);
    setSuggestions([]);
    const position = caret - prefix.length + name.length;
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(position, position);
    });
  }

  return (
    <>
      <Card>
        <Card.Body>
          <Field label="PromQL" hint="Ctrl + Enter runs the query.">
            <textarea
              ref={area}
              className="field__input mnquery"
              rows={3}
              value={query}
              onChange={(event) => onQueryChange(event.target.value, event.target.selectionStart)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void run();
                }
              }}
              placeholder='rate(http_requests_total{job="api"}[5m])'
              spellCheck={false}
              aria-label="PromQL query"
            />
          </Field>
          {suggestions.length > 0 && (
            <div className="mnsuggest" role="listbox" aria-label="Metric names">
              {suggestions.map((name) => (
                <button key={name} type="button" role="option" aria-selected={false} className="mnsuggest__item" onClick={() => accept(name)}>
                  {name}
                </button>
              ))}
            </div>
          )}
          <div className="mnsection__bar">
            <TimeRange value={range} onChange={setRange} presets={PRESETS} />
            <Button variant="primary" icon="arrowRight" loading={running} loadingLabel="Running…" disabled={query.trim() === ''} onClick={() => void run()}>
              Run query
            </Button>
          </div>
        </Card.Body>
      </Card>

      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

      {(graph !== null || table !== null) && (
        <Card>
          <Card.Header title="Result">
            <div className="segmented" role="group" aria-label="Result view">
              {(['graph', 'table'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`segmented__option${mode === value ? ' segmented__option--active' : ''}`}
                  onClick={() => setMode(value)}
                >
                  {value === 'graph' ? 'Graph' : 'Table'}
                </button>
              ))}
            </div>
          </Card.Header>
          <Card.Body>
            {mode === 'graph' && graph !== null && (
              <>
                <TimeSeriesChart series={graph.series} />
                <p className="card__hint">
                  One point every {graph.stepSeconds} s · {graph.totalSeries} series
                  {graph.truncated ? ` (the first ${graph.series.length} are drawn: narrow the query)` : ''}
                </p>
              </>
            )}
            {mode === 'graph' && graph === null && <p className="card__hint">This query could not be drawn as a graph.</p>}
            {mode === 'table' && table !== null && (
              <>
                {table.samples.length === 0 ? (
                  <p className="card__hint">The query returned nothing at this moment.</p>
                ) : (
                  <table className="mntable">
                    <thead>
                      <tr>
                        <th>Series</th>
                        <th className="mntable__num">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.samples.map((sample, position) => (
                        <tr key={`${seriesLabel(sample.labels)}-${position}`}>
                          <td className="mntable__mono">{seriesLabel(sample.labels, table.resultType)}</td>
                          <td className="mntable__num mntable__mono">{sample.text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {table.truncated && <p className="card__hint">Showing {table.samples.length} of {table.totalSamples} series.</p>}
              </>
            )}
            {mode === 'table' && table === null && <p className="card__hint">This query has no instant value. Use the graph.</p>}
          </Card.Body>
        </Card>
      )}
    </>
  );
}

export function MetricsView({ sources }: { sources: ObservabilitySource[] }): React.JSX.Element {
  const prometheuses = sources.filter((source) => source.kind === 'prometheus');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('query');
  const source = prometheuses.find((candidate) => candidate.id === selectedId) ?? prometheuses[0] ?? null;

  if (source === null) {
    return <EmptyState icon="trendingUp" title="No Prometheus source" description="Add a Prometheus source (directly or through Grafana) in the Sources view." />;
  }

  return (
    <div className="mnsection">
      <div className="mnsection__bar">
        <div className="segmented" role="group" aria-label="Metrics views">
          {(Object.keys(SECTION_LABEL) as Section[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`segmented__option${section === value ? ' segmented__option--active' : ''}`}
              onClick={() => setSection(value)}
            >
              {SECTION_LABEL[value]}
            </button>
          ))}
        </div>
        {prometheuses.length > 1 && (
          <select className="field__input mnselect" value={source.id} onChange={(event) => setSelectedId(event.target.value)} aria-label="Prometheus source">
            {prometheuses.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {section === 'query' ? (
        <PrometheusQuery key={source.id} source={source} />
      ) : (
        <PrometheusStatus key={`${source.id}:${section}`} sourceId={source.id} section={section} />
      )}
    </div>
  );
}

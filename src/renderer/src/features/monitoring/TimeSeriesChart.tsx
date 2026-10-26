import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { MetricSeries } from '@shared/schemas/observability';

export interface ChartMarker {
  atMs: number;
  label: string;
  tone: 'info' | 'success' | 'danger' | 'warning';
}

/** The colours of the lines, as theme tokens: they follow light/dark and the rest of the app. */
const SERIES_TOKENS = ['--accent', '--tone-success-fg', '--tone-warning-fg', '--tone-merged-fg', '--tone-failure-fg', '--tone-info-fg'];
const MARKER_TOKENS: Record<ChartMarker['tone'], string> = {
  info: '--tone-info-fg',
  success: '--tone-success-fg',
  danger: '--tone-failure-fg',
  warning: '--tone-warning-fg'
};
/** With this many lines or fewer, the legend shows the value under the cursor; with more it is a plain list. */
const LIVE_LEGEND_MAX = 6;
const LEGEND_SHOWN = 12;
const NO_MARKERS: ChartMarker[] = [];

function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

/** `http_requests_total{job="api"}`, or just the metric name when it is the only label. */
export function seriesLabel(labels: Record<string, string>, fallback = 'value'): string {
  const { __name__: name, ...rest } = labels;
  const pairs = Object.entries(rest).map(([key, value]) => `${key}="${value}"`);
  if (name === undefined) return pairs.length === 0 ? fallback : `{${pairs.join(', ')}}`;
  return pairs.length === 0 ? name : `${name}{${pairs.join(', ')}}`;
}

export function formatMetricValue(value: number, unit = ''): string {
  const magnitude = Math.abs(value);
  let scaled = value;
  let suffix = '';
  if (magnitude >= 1e12) [scaled, suffix] = [value / 1e12, 'T'];
  else if (magnitude >= 1e9) [scaled, suffix] = [value / 1e9, 'G'];
  else if (magnitude >= 1e6) [scaled, suffix] = [value / 1e6, 'M'];
  else if (magnitude >= 1e3) [scaled, suffix] = [value / 1e3, 'k'];
  const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : Math.abs(scaled) >= 1 || scaled === 0 ? 2 : 3;
  const glued = unit === '%' || unit === 'B';
  return `${Number(scaled.toFixed(digits))}${suffix}${unit === '' ? '' : glued ? unit : ` ${unit}`}`;
}

/** Series have their own timestamps (a gap is a missing one); the chart needs one shared, sorted x axis. */
function align(series: MetricSeries[]): uPlot.AlignedData {
  const stamps = new Set<number>();
  for (const item of series) for (const [at] of item.points) stamps.add(at);
  const xs = [...stamps].sort((a, b) => a - b);
  const index = new Map(xs.map((at, position) => [at, position]));
  const columns = series.map((item) => {
    const column: (number | null)[] = new Array<number | null>(xs.length).fill(null);
    for (const [at, value] of item.points) {
      const position = index.get(at);
      if (position !== undefined) column[position] = value;
    }
    return column;
  });
  return [xs.map((at) => at / 1000), ...columns] as uPlot.AlignedData;
}

export function TimeSeriesChart({
  series,
  markers = NO_MARKERS,
  height = 240,
  unit = '',
  variant = 'line',
  showLegend = true
}: {
  series: MetricSeries[];
  markers?: ChartMarker[];
  height?: number;
  unit?: string;
  /** Bars suit counts per interval (log volume); lines suit everything else. */
  variant?: 'line' | 'bars';
  showLegend?: boolean;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const data = useMemo(() => align(series), [series]);
  const labels = useMemo(() => series.map((item) => seriesLabel(item.labels)), [series]);
  const live = showLegend && series.length <= LIVE_LEGEND_MAX;

  useEffect(() => {
    const element = host.current;
    if (element === null || series.length === 0) return;
    const muted = token('--text-muted', '#8b93a1');
    const grid = token('--border', '#2a2f3a');
    const colours = series.map((_, position) => token(SERIES_TOKENS[position % SERIES_TOKENS.length] ?? '--accent', '#4f8cff'));

    const options: uPlot.Options = {
      width: Math.max(element.clientWidth, 200),
      height,
      legend: { show: live },
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: true } },
      axes: [
        { stroke: muted, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid } },
        { stroke: muted, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid }, size: 64, values: (_u, ticks) => ticks.map((tick) => formatMetricValue(tick, unit)) }
      ],
      series: [
        {},
        ...series.map((_, position) => ({
          label: labels[position] ?? 'value',
          stroke: colours[position] ?? '#4f8cff',
          width: 1.5,
          spanGaps: false,
          points: { show: false },
          ...(variant === 'bars' ? { paths: uPlot.paths.bars?.({ size: [0.9, 100] }), fill: colours[position] ?? '#4f8cff' } : {}),
          value: (_u: uPlot, raw: number | null) => (raw === null ? '—' : formatMetricValue(raw, unit))
        }))
      ],
      hooks: {
        draw: [
          (u) => {
            const { ctx, bbox } = u;
            ctx.save();
            ctx.font = `${11 * devicePixelRatio}px system-ui, sans-serif`;
            for (const marker of markers) {
              const x = u.valToPos(marker.atMs / 1000, 'x', true);
              if (!Number.isFinite(x) || x < bbox.left || x > bbox.left + bbox.width) continue;
              const colour = token(MARKER_TOKENS[marker.tone], '#4f8cff');
              ctx.strokeStyle = colour;
              ctx.fillStyle = colour;
              ctx.lineWidth = devicePixelRatio;
              ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
              ctx.beginPath();
              ctx.moveTo(x, bbox.top);
              ctx.lineTo(x, bbox.top + bbox.height);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillText(marker.label, Math.min(x + 4 * devicePixelRatio, bbox.left + bbox.width - 80 * devicePixelRatio), bbox.top + 12 * devicePixelRatio);
            }
            ctx.restore();
          }
        ]
      }
    };

    const instance = new uPlot(options, data, element);
    plot.current = instance;
    const observer = new ResizeObserver(() => {
      instance.setSize({ width: Math.max(element.clientWidth, 200), height });
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      instance.destroy();
      plot.current = null;
    };
  }, [series, data, labels, markers, height, unit, live, variant]);

  if (series.length === 0) return <p className="card__hint">No data in this range.</p>;

  return (
    <div className="mnchart">
      <div ref={host} className="mnchart__plot" />
      {showLegend && !live && (
        <ul className="mnchart__legend">
          {labels.slice(0, LEGEND_SHOWN).map((label, position) => (
            <li key={`${label}-${position}`} title={label}>
              <span className="mnchart__swatch" style={{ background: `var(${SERIES_TOKENS[position % SERIES_TOKENS.length] ?? '--accent'})` }} />
              <span className="mnchart__label">{label}</span>
            </li>
          ))}
          {labels.length > LEGEND_SHOWN && <li className="card__hint">+{labels.length - LEGEND_SHOWN} more</li>}
        </ul>
      )}
    </div>
  );
}

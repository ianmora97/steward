import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphCommit, GraphRef } from '@shared/schemas/graph';
import { layoutGraph, type GraphRow } from '@shared/graph/layout';
import { useGitStore } from '../../stores/git.store';

const ROW_HEIGHT = 28;
const LANE_WIDTH = 16;
const MAX_VISIBLE_LANES = 14;
const OVERSCAN = 12;
const NODE_RADIUS = 4;

function laneX(column: number): number {
  return column * LANE_WIDTH + LANE_WIDTH / 2;
}

function clampColumn(column: number): number {
  return Math.min(column, MAX_VISIBLE_LANES - 1);
}

/** A line between two lane columns within one row; curves when it changes lane. */
function segmentPath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M${x1} ${y1} L${x2} ${y2}`;
  const mid = (y1 + y2) / 2;
  return `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
}

function RowGraphic({ row, merge, width }: { row: GraphRow; merge: boolean; width: number }): React.JSX.Element {
  const mid = ROW_HEIGHT / 2;
  const stroke = (color: number): string => `var(--lane-${color})`;

  return (
    <svg className="graph__lanes" width={width} height={ROW_HEIGHT} aria-hidden="true">
      {row.through.map((segment, index) => (
        <path
          key={`t${index}`}
          d={segmentPath(laneX(clampColumn(segment.from)), 0, laneX(clampColumn(segment.to)), ROW_HEIGHT)}
          stroke={stroke(segment.color)}
          className="graph__line"
        />
      ))}
      {row.incoming.map((segment, index) => (
        <path
          key={`i${index}`}
          d={segmentPath(laneX(clampColumn(segment.from)), 0, laneX(clampColumn(segment.to)), mid)}
          stroke={stroke(segment.color)}
          className="graph__line"
        />
      ))}
      {row.outgoing.map((segment, index) => (
        <path
          key={`o${index}`}
          d={segmentPath(laneX(clampColumn(segment.from)), mid, laneX(clampColumn(segment.to)), ROW_HEIGHT)}
          stroke={stroke(segment.color)}
          className="graph__line"
        />
      ))}
      <circle
        cx={laneX(clampColumn(row.column))}
        cy={mid}
        r={NODE_RADIUS}
        stroke={stroke(row.color)}
        className={merge ? 'graph__node graph__node--merge' : 'graph__node'}
        fill={merge ? 'var(--bg)' : stroke(row.color)}
      />
    </svg>
  );
}

function RefChip({ reference }: { reference: GraphRef }): React.JSX.Element {
  return (
    <span className={`ref ref--${reference.kind}${reference.current ? ' ref--current' : ''}`} title={reference.kind}>
      {reference.name}
    </span>
  );
}

function CommitRow({
  commit,
  row,
  width,
  top,
  selected,
  onSelect
}: {
  commit: GraphCommit;
  row: GraphRow;
  width: number;
  top: number;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`graph__row${selected ? ' graph__row--selected' : ''}`}
      style={{ top, height: ROW_HEIGHT }}
      onClick={onSelect}
      title={`${commit.sha}\n${commit.subject}`}
    >
      <RowGraphic row={row} merge={commit.parents.length > 1} width={width} />
      <span className="graph__refs">
        {commit.refs.map((reference) => (
          <RefChip key={`${reference.kind}-${reference.name}`} reference={reference} />
        ))}
      </span>
      <span className="graph__subject">{commit.subject}</span>
      <span className="graph__author">{commit.author}</span>
      <span className="graph__date">{new Date(commit.date).toLocaleDateString()}</span>
      <code className="graph__sha">{commit.sha.slice(0, 7)}</code>
    </button>
  );
}

/**
 * The commit graph. History arrives a page at a time and only the rows in view
 * are rendered, so a repository with tens of thousands of commits stays
 * responsive. Lanes are recomputed over what is loaded so far.
 */
export function GraphView(): React.JSX.Element {
  const commits = useGitStore((state) => state.commits);
  const historyLoaded = useGitStore((state) => state.historyLoaded);
  const loading = useGitStore((state) => state.historyLoading);
  const hasMore = useGitStore((state) => state.hasMoreHistory);
  const scope = useGitStore((state) => state.historyScope);
  const selectedCommit = useGitStore((state) => state.selectedCommit);
  const changeCount = useGitStore((state) => state.status?.files.length ?? 0);
  const loadHistory = useGitStore((state) => state.loadHistory);
  const setScope = useGitStore((state) => state.setHistoryScope);
  const selectCommit = useGitStore((state) => state.selectCommit);

  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(520);

  useEffect(() => {
    if (!historyLoaded) void loadHistory(true);
  }, [historyLoaded, loadHistory]);

  useEffect(() => {
    const element = viewport.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    setHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => layoutGraph(commits), [commits]);
  const graphWidth = Math.min(layout.laneCount, MAX_VISIBLE_LANES) * LANE_WIDTH + 4;

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(commits.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);

  // Fetch the next page when the viewport nears the end of what is loaded.
  useEffect(() => {
    if (hasMore && !loading && last >= commits.length - OVERSCAN) void loadHistory(false);
  }, [hasMore, loading, last, commits.length, loadHistory]);

  const visible: React.JSX.Element[] = [];
  for (let index = first; index < last; index += 1) {
    const commit = commits[index];
    const row = layout.rows[index];
    if (commit === undefined || row === undefined) continue;
    visible.push(
      <CommitRow
        key={commit.sha}
        commit={commit}
        row={row}
        width={graphWidth}
        top={index * ROW_HEIGHT}
        selected={commit.sha === selectedCommit}
        onSelect={() => void selectCommit(commit.sha === selectedCommit ? null : commit.sha)}
      />
    );
  }

  return (
    <div className="graphview">
      <div className="graphview__main">
        <div className="graphview__toolbar">
          <div className="segmented" role="group" aria-label="History scope">
            <button
              type="button"
              className={`segmented__option${scope === 'all' ? ' segmented__option--active' : ''}`}
              onClick={() => void setScope('all')}
            >
              All branches
            </button>
            <button
              type="button"
              className={`segmented__option${scope === 'head' ? ' segmented__option--active' : ''}`}
              onClick={() => void setScope('head')}
            >
              Current branch
            </button>
          </div>
          <span className="graphview__count">
            {commits.length.toLocaleString()} commit{commits.length === 1 ? '' : 's'} loaded
            {hasMore ? ' — more load as you scroll' : ''}
            {loading ? ' · loading…' : ''}
          </span>
        </div>

        <button
          type="button"
          className={`graph__wip${selectedCommit === null ? ' graph__wip--selected' : ''}`}
          onClick={() => void selectCommit(null)}
        >
          <span className="graph__wip-dot" aria-hidden="true" />
          Working changes
          <span className="chip">{changeCount === 0 ? 'clean' : `${changeCount} file${changeCount === 1 ? '' : 's'}`}</span>
        </button>

        {historyLoaded && commits.length === 0 && !loading ? (
          <p className="diff__placeholder">This repository has no commits yet.</p>
        ) : (
          <div
            ref={viewport}
            className="graph"
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            role="list"
            aria-label="Commit history"
          >
            <div className="graph__spacer" style={{ height: commits.length * ROW_HEIGHT }}>
              {visible}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

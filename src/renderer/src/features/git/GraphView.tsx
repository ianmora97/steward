import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphCommit, GraphRef } from '@shared/schemas/graph';
import { layoutGraph, type GraphRow } from '@shared/graph/layout';
import { Icon } from '../../components/Icon';
import { useGitStore } from '../../stores/git.store';
import { Badge } from '../../components/Badge';
import { Spinner } from '../../components/Spinner';

const ROW_HEIGHT = 32;
const VISIBLE_REFS = 2;
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

function RowGraphic({
  row,
  merge,
  linked,
  width
}: {
  row: GraphRow;
  merge: boolean;
  /** True when the commit has branch labels: a short line ties them to the node. */
  linked: boolean;
  width: number;
}): React.JSX.Element {
  const mid = ROW_HEIGHT / 2;
  const stroke = (color: number): string => `var(--lane-${color})`;

  return (
    <svg className="graph__lanes" width={width} height={ROW_HEIGHT} aria-hidden="true">
      {linked && (
        <line
          x1={0}
          y1={mid}
          x2={laneX(clampColumn(row.column))}
          y2={mid}
          stroke={stroke(row.color)}
          className="graph__link"
        />
      )}
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

interface RefGroup {
  name: string;
  kind: GraphRef['kind'];
  current: boolean;
  /** A local branch and its remote counterpart on the same commit collapse into one label. */
  remote: boolean;
}

function groupRefs(refs: GraphRef[]): RefGroup[] {
  const groups: RefGroup[] = [];
  for (const reference of refs) {
    if (reference.kind === 'remote') continue;
    groups.push({ name: reference.name, kind: reference.kind, current: reference.current, remote: false });
  }
  for (const reference of refs) {
    if (reference.kind !== 'remote') continue;
    const branch = reference.name.slice(reference.name.indexOf('/') + 1);
    const local = groups.find((group) => group.kind === 'local' && group.name === branch);
    if (local === undefined) groups.push({ name: reference.name, kind: 'remote', current: false, remote: true });
    else local.remote = true;
  }
  // The checked-out branch leads, then branches, then remotes and tags.
  const rank = (group: RefGroup): number => (group.current ? 0 : group.kind === 'local' ? 1 : group.kind === 'remote' ? 2 : 3);
  return groups.sort((a, b) => rank(a) - rank(b));
}

function RefChip({ group }: { group: RefGroup }): React.JSX.Element {
  const title =
    group.kind === 'tag'
      ? `Tag ${group.name}`
      : group.kind === 'remote'
        ? `Remote branch ${group.name}`
        : `${group.current ? 'Current branch ' : 'Branch '}${group.name}${group.remote ? ' (also on the remote)' : ''}`;
  return (
    <span className={`ref ref--${group.kind}${group.current ? ' ref--current' : ''}`} title={title}>
      <Icon name={group.current ? 'check' : group.kind === 'tag' ? 'tag' : group.kind === 'remote' ? 'cloud' : 'laptop'} size={11} />
      <span className="ref__name">{group.name}</span>
      {group.kind === 'local' && group.remote && <Icon name="cloud" size={11} />}
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
  const groups = groupRefs(commit.refs);
  const shown = groups.slice(0, VISIBLE_REFS);
  const hidden = groups.slice(VISIBLE_REFS);
  return (
    <button
      type="button"
      className={`graph__row${selected ? ' graph__row--selected' : ''}`}
      style={{ top, height: ROW_HEIGHT, '--ref-color': `var(--lane-${row.color})` } as React.CSSProperties}
      onClick={onSelect}
      title={`${commit.sha}\n${commit.subject}`}
    >
      <span className="graph__refs">
        {shown.map((group) => (
          <RefChip key={`${group.kind}-${group.name}`} group={group} />
        ))}
        {hidden.length > 0 && (
          <span className="ref ref--more" title={hidden.map((group) => group.name).join('\n')}>
            +{hidden.length}
          </span>
        )}
      </span>
      <RowGraphic row={row} merge={commit.parents.length > 1} linked={groups.length > 0} width={width} />

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
            {loading && <Spinner size={11} />}
          </span>
        </div>

        <button
          type="button"
          className={`graph__wip${selectedCommit === null ? ' graph__wip--selected' : ''}`}
          onClick={() => void selectCommit(null)}
        >
          <span className="graph__wip-dot" aria-hidden="true" />
          Working changes
          <Badge tone="neutral">{changeCount === 0 ? 'clean' : `${changeCount} file${changeCount === 1 ? '' : 's'}`}</Badge>
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
            <div className="graph__head" aria-hidden="true">
              <span className="graph__refs">Branch / tag</span>
              <span style={{ width: graphWidth, marginLeft: -14 }}>Graph</span>
              <span className="graph__subject">Commit</span>
              <span className="graph__author">Author</span>
              <span className="graph__date">Date</span>
              <span className="graph__sha">SHA</span>
            </div>
            <div className="graph__spacer" style={{ height: commits.length * ROW_HEIGHT }}>
              {visible}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

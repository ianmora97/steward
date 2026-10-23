/**
 * Lane assignment for the commit graph. Pure and dependency-free: it runs in
 * the renderer over whatever pages have been loaded, so loading another page
 * just recomputes the layout from the top.
 *
 * Input must be topologically ordered (every commit before its parents), which
 * is what `git log --topo-order` produces. Each lane is a vertical track that
 * waits for one particular commit; a commit takes the lane waiting for it,
 * hands that lane to its first parent, and opens new lanes for further parents.
 */
export interface LayoutInput {
  sha: string;
  parents: readonly string[];
}

export interface LaneSegment {
  /** Column at the top edge of the row, or the node column for `out` segments. */
  from: number;
  /** Column at the bottom edge of the row, or the node column for `in` segments. */
  to: number;
  color: number;
}

export interface GraphRow {
  sha: string;
  column: number;
  color: number;
  /** Lines passing straight through the row without touching the commit. */
  through: LaneSegment[];
  /** Lines arriving from above into the commit's dot. */
  incoming: LaneSegment[];
  /** Lines leaving the commit's dot toward its parents below. */
  outgoing: LaneSegment[];
}

export interface GraphLayout {
  rows: GraphRow[];
  /** Widest row, in lanes: the graph column's width. */
  laneCount: number;
}

interface Lane {
  sha: string;
  color: number;
}

export const LANE_COLOR_COUNT = 8;

export function layoutGraph(commits: readonly LayoutInput[]): GraphLayout {
  const lanes: Array<Lane | null> = [];
  const rows: GraphRow[] = [];
  let nextColor = 0;
  let laneCount = 1;

  const freshColor = (): number => {
    const color = nextColor % LANE_COLOR_COUNT;
    nextColor += 1;
    return color;
  };

  const firstFree = (): number => {
    const free = lanes.indexOf(null);
    return free === -1 ? lanes.length : free;
  };

  for (const commit of commits) {
    const waiting: number[] = [];
    lanes.forEach((lane, index) => {
      if (lane !== null && lane.sha === commit.sha) waiting.push(index);
    });

    const column = waiting[0] ?? firstFree();
    const color = waiting.length > 0 ? (lanes[column]?.color ?? freshColor()) : freshColor();

    const through: LaneSegment[] = [];
    const incoming: LaneSegment[] = [];
    const outgoing: LaneSegment[] = [];

    lanes.forEach((lane, index) => {
      if (lane === null) return;
      if (waiting.includes(index)) incoming.push({ from: index, to: column, color: lane.color });
      else through.push({ from: index, to: index, color: lane.color });
    });

    for (const index of waiting) lanes[index] = null;

    const [firstParent, ...otherParents] = commit.parents;

    if (firstParent !== undefined) {
      const existing = lanes.findIndex((lane) => lane !== null && lane.sha === firstParent);
      if (existing === -1) {
        lanes[column] = { sha: firstParent, color };
        outgoing.push({ from: column, to: column, color });
      } else {
        outgoing.push({ from: column, to: existing, color: lanes[existing]?.color ?? color });
      }
    }

    for (const parent of otherParents) {
      const existing = lanes.findIndex((lane) => lane !== null && lane.sha === parent);
      if (existing !== -1) {
        outgoing.push({ from: column, to: existing, color: lanes[existing]?.color ?? color });
        continue;
      }
      const slot = firstFree();
      const laneColor = freshColor();
      lanes[slot] = { sha: parent, color: laneColor };
      outgoing.push({ from: column, to: slot, color: laneColor });
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    const widest = Math.max(
      column + 1,
      ...through.map((segment) => segment.from + 1),
      ...incoming.map((segment) => segment.from + 1),
      ...outgoing.map((segment) => segment.to + 1)
    );
    laneCount = Math.max(laneCount, widest);

    rows.push({ sha: commit.sha, column, color, through, incoming, outgoing });
  }

  return { rows, laneCount };
}

import type { ActivityEntry } from '@shared/schemas/overview';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { ListRow, ListRows } from '../../components/ListRow';
import { Modal } from '../../components/Modal';
import { Skeleton } from '../../components/Skeleton';
import { useDelayedFlag } from '../../components/useDelayedFlag';
import { ACTIVITY_STATUS, activityKind, timeAgo } from './overview-meta';

/** How many entries the card shows; the rest are one click away in a modal. */
export const ACTIVITY_PREVIEW = 5;

function ActivityList({ entries, onOpen }: { entries: ActivityEntry[]; onOpen: (entry: ActivityEntry) => void }): React.JSX.Element {
  return (
    <ListRows>
      {entries.map((entry) => {
        const kind = activityKind(entry.kind);
        const status = ACTIVITY_STATUS[entry.status];
        return (
          <li key={entry.id}>
            <ListRow
              icon={kind.icon}
              title={entry.summary}
              titleMono
              titleHint={entry.summary}
              meta={`${entry.projectName} · ${kind.label} · ${timeAgo(entry.startedAt)}`}
              badges={<Badge tone={status.tone}>{status.label}</Badge>}
              onClick={() => onOpen(entry)}
            />
          </li>
        );
      })}
    </ListRows>
  );
}

export function RecentActivity({
  entries,
  refreshing,
  onOpen,
  onRefresh,
  onViewAll
}: {
  /** `null` until the first answer arrives. */
  entries: ActivityEntry[] | null;
  refreshing: boolean;
  onOpen: (entry: ActivityEntry) => void;
  onRefresh: () => void;
  onViewAll: () => void;
}): React.JSX.Element {
  const showSkeleton = useDelayedFlag(entries === null);

  return (
    <Card className="recentactivity">
      <Card.Header title="Recent activity">
        <IconButton icon="refresh" label="Refresh activity" loading={refreshing} onClick={onRefresh} />
      </Card.Header>
      {entries === null && showSkeleton && <Skeleton variant="row" lines={ACTIVITY_PREVIEW} />}
      {entries !== null && entries.length === 0 && (
        <EmptyState bare title="Nothing yet. Commits, pushes, SSH commands, Docker actions and database writes show up here." />
      )}
      {entries !== null && entries.length > 0 && <ActivityList entries={entries.slice(0, ACTIVITY_PREVIEW)} onOpen={onOpen} />}
      {entries !== null && entries.length > ACTIVITY_PREVIEW && (
        <div className="activity__more">
          <Button variant="ghost" size="sm" onClick={onViewAll}>
            View all ({entries.length})
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Every entry, in a scrolling dialog. Opening one closes the dialog and goes to its project. */
export function ActivityModal({
  entries,
  onOpen,
  onClose
}: {
  entries: ActivityEntry[];
  onOpen: (entry: ActivityEntry) => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Modal title={`Recent activity (${entries.length})`} className="activitymodal" onClose={onClose}>
      <div className="activitymodal__list">
        <ActivityList
          entries={entries}
          onOpen={(entry) => {
            onClose();
            onOpen(entry);
          }}
        />
      </div>
    </Modal>
  );
}

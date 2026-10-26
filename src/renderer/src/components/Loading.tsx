import { Skeleton } from './Skeleton';
import { useDelayedFlag } from './useDelayedFlag';

/**
 * What a view shows while its first load is in flight: placeholders shaped like the content, but only if the
 * wait is longer than a blink. Mount it while loading and unmount it when the data arrives.
 */
export function Loading({
  variant = 'row',
  lines = 3,
  label = 'Loading…'
}: {
  variant?: 'line' | 'block' | 'row' | 'card';
  lines?: number;
  label?: string;
}): React.JSX.Element {
  const visible = useDelayedFlag(true);
  return (
    <div role="status" aria-live="polite" className="loading">
      <span className="sr-only">{label}</span>
      {visible && <Skeleton variant={variant} lines={lines} />}
    </div>
  );
}

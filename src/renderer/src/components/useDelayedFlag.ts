import { useEffect, useState } from 'react';

/**
 * `true` only once `active` has been true for `delayMs`. A skeleton gated by this never flashes
 * for a load that finishes at once.
 */
export function useDelayedFlag(active: boolean, delayMs = 150): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [active, delayMs]);

  return active && elapsed;
}

import { useEffect } from 'react';
import { useCloudStore } from '../../stores/cloud.store';

/**
 * Keeps the domains of a project in the store while a view that shows them is mounted: loads them, and follows the
 * checks as they finish. What a detail view has open updates at once; the list's signals are worked out in main,
 * so the list reloads, once for a burst of results.
 */
export function useCloudFeed(projectId: string | null): void {
  const load = useCloudStore((state) => state.load);
  const applyFinished = useCloudStore((state) => state.applyFinished);

  useEffect(() => {
    if (projectId !== null) void load(projectId);
  }, [projectId, load]);

  useEffect(() => {
    if (projectId === null) return;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const stop = window.steward.cloud.onCheckFinished((event) => {
      if (event.projectId !== projectId) return;
      applyFinished(event);
      if (pending !== null) return;
      pending = setTimeout(() => {
        pending = null;
        void load(projectId);
      }, 500);
    });
    return () => {
      stop();
      if (pending !== null) clearTimeout(pending);
    };
  }, [projectId, load, applyFinished]);
}

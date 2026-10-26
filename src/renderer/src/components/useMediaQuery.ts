import { useCallback, useSyncExternalStore } from 'react';

/** Follows a CSS media query. The viewport is in CSS pixels, so zooming in narrows it just like a smaller window does. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    [query]
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

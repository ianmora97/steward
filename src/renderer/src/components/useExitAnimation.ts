import { useCallback, useEffect, useRef, useState } from 'react';

export const EXIT_MS = 160;

/**
 * Lets a component play its exit animation before its owner removes it:
 * `requestClose(action)` flips `closing` (CSS plays the exit) and runs the action
 * once the animation is done.
 */
export function useExitAnimation(): { closing: boolean; requestClose: (action: () => void) => void } {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    []
  );

  const requestClose = useCallback((action: () => void) => {
    if (timer.current !== null) return;
    setClosing(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setClosing(false);
      action();
    }, EXIT_MS);
  }, []);

  return { closing, requestClose };
}

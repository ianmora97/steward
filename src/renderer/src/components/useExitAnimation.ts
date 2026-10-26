import { useCallback, useEffect, useRef, useState } from 'react';

/** Must match `--dur-base` in styles/tokens.css: the exit animation lasts this long. */
export const EXIT_MS = 180;

function exitDelay(): number {
  // With reduced motion the CSS plays no exit, so there is nothing to wait for.
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : EXIT_MS;
}

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
    }, exitDelay());
  }, []);

  return { closing, requestClose };
}

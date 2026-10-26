import { useCallback, useEffect, useRef, useState } from 'react';
import type { StewardError, StewardResult } from '@shared/types/result';
import { toast } from '../stores/toast.store';

export interface UseActionOptions<T> {
  /** Toast text on success; a function receives the result. Omit for actions whose effect is already visible. */
  success?: string | ((data: T) => string);
  /** `'none'` leaves a failure to the caller (read `error`), e.g. a form that shows it inline. */
  errorTarget?: 'toast' | 'none';
}

/**
 * Runs an operation that returns a `StewardResult` with the feedback every action owes the user:
 * `pending` for the button's spinner, a toast when it works, a toast when it fails, and no double
 * submit while it is running. It resolves to the data, or `undefined` if it failed.
 */
export function useAction<A extends unknown[], T>(
  run: (...args: A) => Promise<StewardResult<T>>,
  options: UseActionOptions<T> = {}
): { run: (...args: A) => Promise<T | undefined>; pending: boolean; error: StewardError | null } {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<StewardError | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const latest = useRef({ run, options });

  useEffect(() => {
    latest.current = { run, options };
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const execute = useCallback(async (...args: A): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const { run: operation, options: current } = latest.current;

    try {
      const result = await operation(...args);
      if (!result.success) {
        if (mounted.current) setError(result.error);
        if (current.errorTarget !== 'none') toast.error(result.error.message);
        return undefined;
      }
      const message = typeof current.success === 'function' ? current.success(result.data) : current.success;
      if (message !== undefined) toast.success(message);
      return result.data;
    } catch {
      toast.error('Steward could not reach its main process');
      return undefined;
    } finally {
      inFlight.current = false;
      // The user may have left the screen meanwhile; the toast above still tells them how it went.
      if (mounted.current) setPending(false);
    }
  }, []);

  return { run: execute, pending, error };
}

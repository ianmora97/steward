import { useDelayedFlag } from './useDelayedFlag';

/** A thin indeterminate bar along the top of the window while the app is working; quick operations never show it. */
export function TopProgress({ active }: { active: boolean }): React.JSX.Element | null {
  const visible = useDelayedFlag(active, 200);
  return visible ? <div className="topprogress" role="progressbar" aria-label="Working" /> : null;
}

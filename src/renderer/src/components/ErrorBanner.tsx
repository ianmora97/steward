import type { StewardError } from '@shared/types/result';
import { Button } from './Button';

/**
 * Failures belong in the interface, not only in the console: the user has to
 * be able to act on them.
 */
export function ErrorBanner({
  error,
  onDismiss
}: {
  error: StewardError;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div className="banner banner--error" role="alert">
      <div className="banner__body">
        <p className="banner__message">{error.message}</p>
        {error.details !== undefined && <p className="banner__details">{error.details}</p>}
        <span className="banner__code">{error.code}</span>
      </div>
      <Button variant="ghost" onClick={onDismiss} aria-label="Dismiss">
        Dismiss
      </Button>
    </div>
  );
}

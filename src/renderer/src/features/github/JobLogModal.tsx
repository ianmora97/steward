import { useCallback, useEffect, useState } from 'react';
import type { GithubJobLog } from '@shared/schemas/github';
import type { StewardError, StewardResult } from '@shared/types/result';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Modal } from '../../components/Modal';
import { useGithubStore } from '../../stores/github.store';
import { Button } from '../../components/Button';
import { Loading } from '../../components/Loading';

/** Shows the end of a job log as plain text. The text is never interpreted as HTML. */
export function JobLogModal({
  projectId,
  jobId,
  jobName,
  jobUrl,
  onClose,
  loadLog,
  onOpenUrl
}: {
  projectId: string;
  jobId: number;
  jobName: string;
  jobUrl: string;
  onClose: () => void;
  /**
   * The GitHub tab's store reads logs for the repository selected there. A caller that works on a
   * different repository (Deployments) supplies its own loader and link opener.
   */
  loadLog?: (jobId: number) => Promise<StewardResult<GithubJobLog>>;
  onOpenUrl?: (url: string) => void;
}): React.JSX.Element {
  const storeFetch = useGithubStore((state) => state.fetchJobLog);
  const storeOpen = useGithubStore((state) => state.openUrl);
  const fetchJobLog = useCallback(
    (project: string, job: number) => (loadLog === undefined ? storeFetch(project, job) : loadLog(job)),
    [loadLog, storeFetch]
  );
  const openUrl = (url: string): void => {
    if (onOpenUrl === undefined) void storeOpen(url);
    else onOpenUrl(url);
  };
  const [log, setLog] = useState<GithubJobLog | null>(null);
  const [error, setError] = useState<StewardError | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchJobLog(projectId, jobId);
      if (cancelled) return;
      if (result.success) setLog(result.data);
      else setError(result.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, jobId, fetchJobLog]);

  // GitHub deletes logs after 90 days, so a 404 here usually means "expired", not "broken".
  const unavailable = error?.code === 'GITHUB_NOT_FOUND';

  return (
    <Modal title={`Log: ${jobName}`} onClose={onClose} className="ghlog">
      <div className="dialog__body ghlog__body">
        {error !== null && !unavailable && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        {unavailable && (
          <p className="card__hint">The log is not available (GitHub deletes logs after 90 days).</p>
        )}
        {error === null && log === null && <Loading variant="line" lines={6} label="Loading log…" />}
        {log !== null && log.tooLarge && (
          <p className="card__hint">This log is too large to show here. Open the job on GitHub.</p>
        )}
        {log !== null && !log.tooLarge && (
          <>
            {log.truncated && <p className="card__hint">Showing the last 200 KB of this log.</p>}
            {log.text.trim() === '' ? (
              <p className="card__hint">This log is empty.</p>
            ) : (
              <pre className="ghlog__text">{log.text}</pre>
            )}
          </>
        )}
      </div>
      <div className="dialog__actions">
        {jobUrl !== '' && (
          <Button onClick={() => openUrl(jobUrl)}>
            Open on GitHub
          </Button>
        )}
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

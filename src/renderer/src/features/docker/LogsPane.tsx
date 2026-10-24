import { useEffect, useRef, useState } from 'react';
import type { DockerLogEndEvent, DockerLogEvent, DockerTarget } from '@shared/schemas/docker';
import type { StewardError } from '@shared/types/result';

/** What the view keeps. Older lines are dropped; Docker still has them. */
const MAX_LINES = 2000;

interface Line {
  id: number;
  stream: 'out' | 'err';
  text: string;
}

export function LogsPane({
  projectId,
  target,
  containerId,
  onError
}: {
  projectId: string;
  target: DockerTarget;
  containerId: string;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const [lines, setLines] = useState<Line[]>([]);
  const [ended, setEnded] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const pausedRef = useRef(false);
  const heldRef = useRef<Line[]>([]);
  const nextId = useRef(0);
  const scroller = useRef<HTMLPreElement | null>(null);
  const stick = useRef(true);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused && heldRef.current.length > 0) {
      const held = heldRef.current;
      heldRef.current = [];
      setLines((current) => [...current, ...held].slice(-MAX_LINES));
    }
  }, [paused]);

  useEffect(() => {
    let subscriptionId: string | null = null;
    let closed = false;
    // Events can arrive before startLogs answers with the id, so they wait here until it is known.
    const early: DockerLogEvent[] = [];
    let earlyEnd: DockerLogEndEvent | null = null;

    const append = (event: DockerLogEvent): void => {
      const added = event.lines.map((text) => ({ id: nextId.current++, stream: event.stream, text }));
      if (pausedRef.current) {
        heldRef.current = [...heldRef.current, ...added].slice(-MAX_LINES);
        return;
      }
      setLines((current) => [...current, ...added].slice(-MAX_LINES));
    };
    const finish = (event: DockerLogEndEvent): void => {
      setEnded(event.message ?? (event.reason === 'stopped' ? null : 'The container stopped producing logs.'));
    };

    const offLog = window.steward.docker.onLog((event) => {
      if (subscriptionId === null) early.push(event);
      else if (event.subscriptionId === subscriptionId) append(event);
    });
    const offEnd = window.steward.docker.onLogEnd((event) => {
      if (subscriptionId === null) earlyEnd = event;
      else if (event.subscriptionId === subscriptionId) finish(event);
    });

    void window.steward.docker.startLogs({ projectId, target, containerId }).then((result) => {
      if (!result.success) {
        onError(result.error);
        return;
      }
      subscriptionId = result.data.subscriptionId;
      if (closed) {
        void window.steward.docker.stopLogs({ subscriptionId });
        return;
      }
      for (const event of early) if (event.subscriptionId === subscriptionId) append(event);
      if (earlyEnd !== null && (earlyEnd as DockerLogEndEvent).subscriptionId === subscriptionId) finish(earlyEnd);
    });

    return () => {
      closed = true;
      offLog();
      offEnd();
      if (subscriptionId !== null) void window.steward.docker.stopLogs({ subscriptionId });
    };
  }, [projectId, target, containerId, onError]);

  useEffect(() => {
    const element = scroller.current;
    if (element !== null && stick.current) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const needle = filter.trim().toLowerCase();
  const shown = needle === '' ? lines : lines.filter((line) => line.text.toLowerCase().includes(needle));

  return (
    <div className="dklogs">
      <div className="dkbar">
        <input
          className="field__input"
          placeholder="Filter lines"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter log lines"
        />
        <button type="button" className="button button--small" onClick={() => setPaused((value) => !value)}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="button button--small" onClick={() => setLines([])}>
          Clear
        </button>
      </div>
      <pre
        ref={scroller}
        className="dplog dklogs__view"
        onScroll={(event) => {
          const element = event.currentTarget;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
      >
        {shown.length === 0 && <span className="card__hint">No log lines yet.</span>}
        {shown.map((line) => (
          <div key={line.id} className={line.stream === 'err' ? 'dklogs__err' : undefined}>
            {line.text}
          </div>
        ))}
      </pre>
      {ended !== null && <p className="card__hint">{ended}</p>}
      <p className="card__hint">
        Last {MAX_LINES} lines are kept in this view{paused ? ' (paused: new lines are held)' : ''}. Lines are redacted
        for tokens and URL credentials.
      </p>
    </div>
  );
}

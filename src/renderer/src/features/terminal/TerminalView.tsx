import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TerminalDataEvent, TerminalSession } from '@shared/schemas/terminal';

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

/**
 * One xterm bound to one session. Unmounting disposes the widget only: the
 * process keeps running in the main process and the next mount replays its
 * buffer through `attach`.
 */
export function TerminalView({
  session,
  active
}: {
  session: TerminalSession;
  active: boolean;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const sessionId = session.id;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: cssVar('--bg-sunken', '#090b0f'),
        foreground: cssVar('--text', '#e6eaf2'),
        cursor: cssVar('--accent', '#4f8cf7')
      }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;

    let disposed = false;
    let attachedAt: number | null = null;
    const queued: TerminalDataEvent[] = [];

    // Events carry the session's running character count, so whatever the
    // attach snapshot already contains is trimmed instead of printed twice.
    const apply = (event: TerminalDataEvent, from: number): void => {
      const end = event.offset + event.data.length;
      if (end <= from) return;
      term.write(event.offset < from ? event.data.slice(from - event.offset) : event.data);
    };

    const unsubscribe = window.steward.terminal.onData((event) => {
      if (event.sessionId !== sessionId) return;
      if (attachedAt === null) queued.push(event);
      else apply(event, attachedAt);
    });

    void window.steward.terminal.attach({ sessionId }).then((result) => {
      if (disposed || !result.success) return;
      term.write(result.data.buffer);
      attachedAt = result.data.offset;
      for (const event of queued.splice(0)) apply(event, result.data.offset);
    });

    const input = term.onData((data) => {
      void window.steward.terminal.write({ sessionId, data });
    });

    const sync = (): void => {
      // A hidden tab measures as 0x0; resizing the pty to that would garble the shell.
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      fit.fit();
      if (term.cols >= 1 && term.rows >= 1) {
        void window.steward.terminal.resize({ sessionId, cols: term.cols, rows: term.rows });
      }
    };
    const observer = new ResizeObserver(sync);
    observer.observe(container);

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      unsubscribe();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  return <div ref={containerRef} className="termview" />;
}

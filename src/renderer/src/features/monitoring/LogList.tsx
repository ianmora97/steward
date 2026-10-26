import { useLayoutEffect, useRef, useState } from 'react';
import type { LogLine } from '@shared/schemas/observability';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { formatLogDateTime, formatLogTime, LEVEL_LABEL, parseJsonLine } from './log-format';

const ROW_HEIGHT = 24;
const OVERSCAN = 8;

export function lineKey(line: LogLine): string {
  return `${line.tsNs}:${line.line.length}:${line.line.slice(0, 48)}`;
}

/**
 * Thousands of lines without thousands of rows: only the ones in view are in the page. Rows have a fixed
 * height so the position of any line is arithmetic; the whole text of one opens in the detail below.
 */
export function LogList({
  lines,
  selected,
  onSelect,
  keepPosition = false
}: {
  lines: LogLine[];
  selected: LogLine | null;
  onSelect: (line: LogLine | null) => void;
  /** Newest lines are added at the top: when the user has scrolled down, keep what they are reading where it is. */
  keepPosition?: boolean;
}): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const previousCount = useRef(lines.length);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(420);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    // The observer reports the size as soon as it starts watching, so no separate first read is needed.
    const observer = new ResizeObserver(() => setViewHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = scroller.current;
    const added = lines.length - previousCount.current;
    previousCount.current = lines.length;
    if (keepPosition && element !== null && element.scrollTop > 0 && added > 0) element.scrollTop += added * ROW_HEIGHT;
  }, [lines, keepPosition]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(lines.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + OVERSCAN);
  const selectedKey = selected === null ? null : lineKey(selected);

  return (
    <div className="mnlog" ref={scroller} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} role="list" aria-label="Log lines">
      <div className="mnlog__space" style={{ height: lines.length * ROW_HEIGHT }}>
        {lines.slice(start, end).map((line, offset) => {
          const key = lineKey(line);
          return (
            <button
              key={`${key}:${start + offset}`}
              type="button"
              role="listitem"
              className={`mnlog__row mnlog__row--${line.level}${key === selectedKey ? ' mnlog__row--selected' : ''}`}
              style={{ top: (start + offset) * ROW_HEIGHT, height: ROW_HEIGHT }}
              onClick={() => onSelect(key === selectedKey ? null : line)}
            >
              <span className="mnlog__time">{formatLogTime(line.tsNs)}</span>
              <span className="mnlog__level">{LEVEL_LABEL[line.level]}</span>
              <span className="mnlog__text">{line.line}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One line in full: when it happened, its labels, and its fields if it is JSON. */
export function LogDetail({ line, onClose }: { line: LogLine; onClose: () => void }): React.JSX.Element {
  const fields = parseJsonLine(line.line);
  return (
    <div className="mndetail">
      <div className="mndetail__bar">
        <strong>{formatLogDateTime(line.tsNs)}</strong>
        {line.level !== 'unknown' && (
          <Badge tone={line.level === 'error' ? 'failure' : line.level === 'warn' ? 'warning' : 'neutral'} size="sm">
            {LEVEL_LABEL[line.level]}
          </Badge>
        )}
        <span className="mndetail__spacer" />
        <Button size="sm" onClick={() => void navigator.clipboard.writeText(line.line)}>
          Copy line
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="mndetail__labels">
        {Object.entries(line.labels).map(([name, value]) => (
          <Badge key={name} tone="neutral" size="sm">
            {name}={value}
          </Badge>
        ))}
      </div>
      {fields === null ? (
        <pre className="mndetail__raw">{line.line}</pre>
      ) : (
        <dl className="mndetail__fields">
          {fields.map(([name, value]) => (
            <div key={name} className="mndetail__field">
              <dt>{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

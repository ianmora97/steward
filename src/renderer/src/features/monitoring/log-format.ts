import type { LogLevel } from '@shared/schemas/observability';

export const LEVEL_LABEL: Record<LogLevel, string> = {
  error: 'ERROR',
  warn: 'WARN',
  info: 'INFO',
  debug: 'DEBUG',
  unknown: ''
};

/** Nanoseconds as a string → milliseconds. Dropping the last six digits is exact, unlike going through a float. */
export function nsToMs(tsNs: string): number {
  return Number(tsNs.slice(0, -6) || '0');
}

const pad = (value: number, size = 2): string => String(value).padStart(size, '0');

/** `14:03:22.481`, in the user's time zone. */
export function formatLogTime(tsNs: string): string {
  const date = new Date(nsToMs(tsNs));
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

/** `2026-10-25 14:03:22.481`. */
export function formatLogDateTime(tsNs: string): string {
  const date = new Date(nsToMs(tsNs));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatLogTime(tsNs)}`;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** The index of the `}` that closes the stream selector at the start of the query, skipping quoted values. */
function selectorEnd(query: string): number {
  let quote = false;
  for (let index = 1; index < query.length; index += 1) {
    const char = query[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === '"') quote = false;
    } else if (char === '"') quote = true;
    else if (char === '}') return index;
  }
  return -1;
}

/** Adds `label="value"` to the stream selector of a LogQL query (creating one if there is none), unless it is already there. */
export function addMatcher(query: string, label: string, value: string): string {
  const matcher = `${label}="${escapeLabelValue(value)}"`;
  const text = query.trim();
  if (text === '') return `{${matcher}}`;
  if (!text.startsWith('{')) return `{${matcher}} ${text}`;
  const end = selectorEnd(text);
  if (end === -1) return text;
  const inside = text.slice(1, end);
  if (inside.includes(matcher)) return text;
  const joiner = inside.trim() === '' ? '' : ', ';
  return `{${inside.trim()}${joiner}${matcher}}${text.slice(end + 1)}`;
}

/** The fields of a JSON log line, or null when the line is not a JSON object. */
export function parseJsonLine(line: string): [string, string][] | null {
  const text = line.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return Object.entries(parsed).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]);
  } catch {
    return null;
  }
}

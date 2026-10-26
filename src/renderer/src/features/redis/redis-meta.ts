import type { BadgeTone } from '../../components/Badge';

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en').format(value);
}

/** A TTL in milliseconds as the largest couple of units, or "no expiry". */
export function formatTtl(ttlMs: number | null): string {
  if (ttlMs === null) return 'No expiry';
  const seconds = Math.floor(ttlMs / 1000);
  if (seconds < 1) return `${ttlMs} ms`;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

export function formatDuration(seconds: number): string {
  return formatTtl(seconds * 1000);
}

export const TYPE_LABEL: Record<string, string> = {
  string: 'String',
  hash: 'Hash',
  list: 'List',
  set: 'Set',
  zset: 'Sorted set',
  stream: 'Stream',
  'ReJSON-RL': 'JSON'
};

export function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

export const TYPE_TONE: Record<string, BadgeTone> = {
  string: 'info',
  hash: 'success',
  list: 'warning',
  set: 'merged',
  zset: 'running',
  stream: 'failure',
  'ReJSON-RL': 'neutral'
};

export function typeTone(type: string): BadgeTone {
  return TYPE_TONE[type] ?? 'neutral';
}

export const KEY_TYPES = ['string', 'hash', 'list', 'set', 'zset', 'stream', 'ReJSON-RL'] as const;

/** Newlines in a pasted name, or a value that is one line of a table, should not break a layout. */
export function oneLine(text: string, max = 200): string {
  const single = text.replace(/\s+/g, ' ');
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

export type ChipTone = 'success' | 'failure' | 'running' | 'neutral';

export interface RunChip {
  label: string;
  tone: ChipTone;
}

const PENDING_STATUSES = new Set(['queued', 'waiting', 'requested', 'pending']);

function words(value: string): string {
  return value.replace(/_/g, ' ');
}

/**
 * Chip for a run, job or step. GitHub adds status and conclusion values over
 * time, so anything unrecognised falls through to a neutral chip showing the
 * raw word instead of being guessed at.
 */
export function runChip(item: { status: string; conclusion: string | null }): RunChip {
  if (item.status === 'completed') {
    switch (item.conclusion) {
      case 'success':
        return { label: 'success', tone: 'success' };
      case 'failure':
      case 'timed_out':
      case 'startup_failure':
        return { label: words(item.conclusion), tone: 'failure' };
      case null:
        return { label: 'completed', tone: 'neutral' };
      default:
        return { label: words(item.conclusion), tone: 'neutral' };
    }
  }
  if (item.status === 'in_progress') return { label: 'in progress', tone: 'running' };
  if (PENDING_STATUSES.has(item.status)) return { label: item.status, tone: 'running' };
  return { label: words(item.status), tone: 'neutral' };
}

export function formatDuration(startIso: string | null, endIso: string | null): string {
  if (startIso === null || endIso === null) return '';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

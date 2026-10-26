import type { IconName } from '../../components/Icon';
import type { BadgeTone } from '../../components/Badge';

export interface RunChip {
  label: string;
  tone: BadgeTone;
  icon: IconName;
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
export function runBadge(item: { status: string; conclusion: string | null }): RunChip {
  if (item.status === 'completed') {
    switch (item.conclusion) {
      case 'success':
        return { label: 'success', tone: 'success', icon: 'checkCircle' };
      case 'failure':
      case 'timed_out':
      case 'startup_failure':
        return { label: words(item.conclusion), tone: 'failure', icon: 'xCircle' };
      case 'cancelled':
      case 'skipped':
        return { label: item.conclusion, tone: 'neutral', icon: 'minusCircle' };
      case 'action_required':
        return { label: 'action required', tone: 'warning', icon: 'alert' };
      case null:
        return { label: 'completed', tone: 'neutral', icon: 'minusCircle' };
      default:
        return { label: words(item.conclusion), tone: 'neutral', icon: 'minusCircle' };
    }
  }
  if (item.status === 'in_progress') return { label: 'in progress', tone: 'running', icon: 'loader' };
  if (PENDING_STATUSES.has(item.status)) return { label: item.status, tone: 'running', icon: 'clock' };
  return { label: words(item.status), tone: 'neutral', icon: 'minusCircle' };
}

export type HealthStatus = 'unknown' | 'healthy' | 'degraded' | 'failing';

/** Tone and icon for the overall workflow health, shared by the Actions tab button and its status line. */
export function healthBadge(status: HealthStatus): { tone: BadgeTone; icon: IconName; label: string } {
  switch (status) {
    case 'healthy':
      return { tone: 'success', icon: 'checkCircle', label: 'Healthy' };
    case 'failing':
      return { tone: 'failure', icon: 'xCircle', label: 'Failing' };
    case 'degraded':
      return { tone: 'warning', icon: 'alert', label: 'Degraded' };
    default:
      return { tone: 'neutral', icon: 'minusCircle', label: 'Unknown' };
  }
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

/** "3m ago", "2h ago", "5d ago"; falls back to the date past a month. */
export function timeAgo(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

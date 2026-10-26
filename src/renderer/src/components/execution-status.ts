import type { BadgeTone } from './Badge';

export type ExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';

/** How an execution's status reads everywhere it is listed: Git activity, the home screen, deployments. */
export const EXECUTION_STATUS: Record<ExecutionStatus, { tone: BadgeTone; label: string }> = {
  succeeded: { tone: 'success', label: 'Done' },
  failed: { tone: 'failure', label: 'Failed' },
  timed_out: { tone: 'warning', label: 'Timed out' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  running: { tone: 'running', label: 'Running' },
  pending: { tone: 'running', label: 'Waiting' }
};

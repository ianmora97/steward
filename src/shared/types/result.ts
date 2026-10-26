/**
 * The single result shape that crosses the process boundary.
 *
 * Every main-process operation returns this. Raw errors, process objects and
 * unbounded command output must never reach the renderer: they are normalized
 * into `StewardError` at one boundary (see src/main/ipc/index.ts).
 *
 * The Git specification calls this `GitOperationResult<T>`; it is generalized
 * here because terminal, SSH, Actions and deployment operations share it.
 */
export const STEWARD_ERROR_CODES = [
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'CONFLICT',
  'PATH_INVALID',
  'PATH_NOT_FOUND',
  'NOT_A_GIT_REPOSITORY',
  'GIT_NOT_FOUND',
  'GIT_FAILED',
  'GIT_AUTH_FAILED',
  'GIT_NETWORK_FAILED',
  'GIT_REMOTE_NOT_FOUND',
  'GIT_MERGE_CONFLICT',
  'GIT_NON_FAST_FORWARD',
  'GIT_DIVERGED',
  'GIT_UNMERGED_BRANCH',
  'GIT_LOCAL_CHANGES',
  'GIT_NOTHING_TO_COMMIT',
  'GIT_IDENTITY_MISSING',
  'GIT_INVALID_REF',
  'GIT_NO_REMOTE',
  'GIT_TIMEOUT',
  'SHELL_NOT_FOUND',
  'SPAWN_FAILED',
  'TERMINAL_LIMIT',
  'SSH_NOT_FOUND',
  'SSH_HOST_KEY_UNKNOWN',
  'SSH_HOST_KEY_CHANGED',
  'SSH_AUTH_FAILED',
  'SSH_UNREACHABLE',
  'SSH_TIMEOUT',
  'SSH_FAILED',
  'GITHUB_NOT_CONNECTED',
  'GITHUB_AUTH_FAILED',
  'GITHUB_RATE_LIMITED',
  'GITHUB_NOT_FOUND',
  'GITHUB_UNREACHABLE',
  'GITHUB_FAILED',
  'GH_NOT_FOUND',
  'SECRET_STORE_UNAVAILABLE',
  'ENVIRONMENT_IN_USE',
  'TARGET_BUSY',
  'TARGET_BROKEN',
  'CONFIRMATION_REQUIRED',
  'CONFIRMATION_MISMATCH',
  'WORKFLOW_NOT_DISPATCHABLE',
  'INPUT_INVALID',
  'DOCKER_NOT_FOUND',
  'DOCKER_DAEMON_DOWN',
  'DOCKER_PERMISSION',
  'DOCKER_FAILED',
  'DOCKER_TOO_MANY_STREAMS',
  'CONNECTION_READ_ONLY',
  'MONGO_AUTH_FAILED',
  'MONGO_UNREACHABLE',
  'MONGO_TLS_FAILED',
  'MONGO_TIMEOUT',
  'MONGO_NOT_AUTHORIZED',
  'MONGO_QUERY_INVALID',
  'MONGO_DUPLICATE_KEY',
  'MONGO_COUNT_MISMATCH',
  'MONGO_DOC_CHANGED',
  'MONGO_TOO_MANY_CONNECTIONS',
  'MONGO_FAILED',
  'REDIS_AUTH_FAILED',
  'REDIS_NOPERM',
  'REDIS_UNREACHABLE',
  'REDIS_TLS_FAILED',
  'REDIS_READONLY_REPLICA',
  'REDIS_TIMEOUT',
  'REDIS_COMMAND_BLOCKED',
  'REDIS_COUNT_MISMATCH',
  'REDIS_TOO_MANY_CONNECTIONS',
  'REDIS_FAILED',
  'DB_ERROR',
  'CANCELLED',
  'UNKNOWN'
] as const;

export type StewardErrorCode = (typeof STEWARD_ERROR_CODES)[number];

export interface StewardError {
  code: StewardErrorCode;
  message: string;
  /** Safe, already-redacted supplementary detail. Never raw output that may carry secrets. */
  details?: string;
}

export type StewardResult<T> = { success: true; data: T } | { success: false; error: StewardError };

export function ok<T>(data: T): StewardResult<T> {
  return { success: true, data };
}

export function fail<T = never>(code: StewardErrorCode, message: string, details?: string): StewardResult<T> {
  return { success: false, error: details === undefined ? { code, message } : { code, message, details } };
}

/** Thrown inside main-process services; normalized into a `StewardError` at the IPC boundary. */
export class StewardServiceError extends Error {
  readonly code: StewardErrorCode;
  readonly details?: string;

  constructor(code: StewardErrorCode, message: string, details?: string) {
    super(message);
    this.name = 'StewardServiceError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

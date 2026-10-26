import { StewardServiceError } from '@shared/types/result';
import { redactSecrets } from './git-errors';

const MAX_MESSAGE = 300;

function firstLine(message: string): string {
  const line =
    redactSecrets(message)
      .split(/\r?\n/)
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate !== '') ?? '';
  return line.length > MAX_MESSAGE ? `${line.slice(0, MAX_MESSAGE)}…` : line;
}

interface RedisLikeError {
  name?: string;
  code?: string;
  message?: string;
}

const TLS_PATTERN = /SSL|TLS|certificate|self[- ]signed|CERT_|ERR_SSL|handshake|wrong version number/i;
const UNREACHABLE_PATTERN =
  /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH|Connection timeout|Socket closed unexpectedly|The client is closed|The client is offline|connect timeout|Reached the max retries|No sentinel/i;

/**
 * Turns whatever the client threw into one of the outcomes the page tells apart. Server errors carry the
 * reply text (`WRONGPASS …`, `NOPERM …`), connection errors carry a Node code; every message is redacted
 * because it may quote a command or a URL.
 */
export function translateRedisError(error: unknown): StewardServiceError {
  if (error instanceof StewardServiceError) return error;
  const failure = (typeof error === 'object' && error !== null ? error : {}) as RedisLikeError;
  const message = typeof failure.message === 'string' ? failure.message : '';

  if (/^(WRONGPASS|NOAUTH)\b/.test(message) || /invalid username-password pair|Authentication required|AUTH failed|without any password configured/i.test(message)) {
    return new StewardServiceError(
      'REDIS_AUTH_FAILED',
      'The server rejected the user name or password',
      'Check the password and, if the server uses ACL users, the user name.'
    );
  }
  if (/^NOPERM\b/.test(message) || /no permissions? to/i.test(message)) {
    const command = /'([^']+)' command/.exec(message)?.[1];
    return new StewardServiceError(
      'REDIS_NOPERM',
      command === undefined ? 'This user is not allowed to do that' : `This user has no permission to run ${command.toUpperCase()}`,
      'Ask for an ACL rule that allows it, or connect as another user.'
    );
  }
  if (/^READONLY\b/.test(message)) {
    return new StewardServiceError(
      'REDIS_READONLY_REPLICA',
      'This server is a read-only replica',
      'Connect to the master to change data.'
    );
  }
  if (failure.name === 'TimeoutError' || /^timeout:/i.test(message)) {
    return new StewardServiceError(
      'REDIS_TIMEOUT',
      'The operation took longer than the time limit',
      'The command may still be running on the server. Narrow the pattern or try again.'
    );
  }
  if (TLS_PATTERN.test(message) || (failure.code !== undefined && TLS_PATTERN.test(failure.code))) {
    return new StewardServiceError(
      'REDIS_TLS_FAILED',
      'The secure connection could not be established',
      'Check that TLS is enabled on the server, the CA file, and the client certificate. A self-signed server needs its CA file.'
    );
  }
  const code = failure.code ?? '';
  if (
    UNREACHABLE_PATTERN.test(message) ||
    UNREACHABLE_PATTERN.test(code) ||
    failure.name === 'ConnectionTimeoutError' ||
    failure.name === 'SocketClosedUnexpectedlyError' ||
    failure.name === 'ClientClosedError' ||
    failure.name === 'ClientOfflineError'
  ) {
    return new StewardServiceError(
      'REDIS_UNREACHABLE',
      'Steward could not reach the server',
      'Check the host and port, your network or VPN, and that the server accepts remote connections.'
    );
  }
  return new StewardServiceError('REDIS_FAILED', firstLine(message) || 'Redis reported an error');
}

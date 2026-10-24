import { StewardServiceError } from '@shared/types/result';
import { redactSecrets } from './git-errors';
import { isAtlas } from './mongo-uri';

const MAX_MESSAGE = 300;

function firstLine(message: string): string {
  const line =
    redactSecrets(message)
      .split(/\r?\n/)
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate !== '') ?? '';
  return line.length > MAX_MESSAGE ? `${line.slice(0, MAX_MESSAGE)}…` : line;
}

interface MongoLikeError {
  name?: string;
  code?: number | string;
  codeName?: string;
  message?: string;
}

const TLS_PATTERN = /SSL|TLS|certificate|self[- ]signed|CERT_|ERR_SSL|handshake/i;
const UNREACHABLE_PATTERN = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|Server selection timed out|timed out|querySrv|queryTxt|No addresses/i;

/**
 * Turns whatever the driver threw into one of the outcomes the page tells apart. A message may carry the
 * connection string, so everything shown goes through `redactSecrets` first.
 *
 * `host` is the connection's display host: for Atlas, a refused connection very often means the user's IP
 * is not on the cluster's access list, which no error message says.
 */
export function translateMongoError(error: unknown, host: string | null = null): StewardServiceError {
  if (error instanceof StewardServiceError) return error;
  const failure = (typeof error === 'object' && error !== null ? error : {}) as MongoLikeError;
  const message = typeof failure.message === 'string' ? failure.message : '';
  const atlas = host !== null && isAtlas(host);

  if (failure.code === 18 || failure.codeName === 'AuthenticationFailed' || /Authentication failed|bad auth/i.test(message)) {
    return new StewardServiceError(
      'MONGO_AUTH_FAILED',
      'The server rejected the user name or password',
      'Check the user, the password and the authentication database (authSource).'
    );
  }
  if (failure.code === 13 || failure.codeName === 'Unauthorized' || /not authorized|requires authentication/i.test(message)) {
    return new StewardServiceError(
      'MONGO_NOT_AUTHORIZED',
      'This user is not allowed to do that',
      'Ask for a role with the privilege, or connect as another user.'
    );
  }
  if (failure.code === 50 || failure.codeName === 'MaxTimeMSExpired' || failure.name === 'MongoOperationTimeoutError') {
    return new StewardServiceError(
      'MONGO_TIMEOUT',
      'The operation took longer than the time limit and was stopped',
      'Narrow the filter, use an index, or raise the time limit.'
    );
  }
  if (failure.code === 11000) {
    return new StewardServiceError('MONGO_DUPLICATE_KEY', 'A document with that unique value already exists', firstLine(message));
  }
  if (failure.name === 'MongoServerSelectionError' || failure.name === 'MongoNetworkError' || failure.name === 'MongoNetworkTimeoutError') {
    if (TLS_PATTERN.test(message)) {
      return new StewardServiceError(
        'MONGO_TLS_FAILED',
        'The secure connection could not be established',
        'Check that TLS is enabled on the server, the CA file, and the client certificate. A self-signed server needs its CA file.'
      );
    }
    if (UNREACHABLE_PATTERN.test(message) || failure.name !== 'MongoServerSelectionError') {
      return new StewardServiceError(
        'MONGO_UNREACHABLE',
        'Steward could not reach the server',
        atlas
          ? 'Is your current IP address on the Atlas project\'s Network Access list? Also check the host name and your network or VPN.'
          : 'Check the host and port, your network or VPN, and that the server accepts remote connections.'
      );
    }
  }
  if (TLS_PATTERN.test(message) && failure.name?.startsWith('Mongo') === true) {
    return new StewardServiceError(
      'MONGO_TLS_FAILED',
      'The secure connection could not be established',
      'Check that TLS is enabled on the server, the CA file, and the client certificate.'
    );
  }
  if (failure.name === 'MongoParseError' || failure.name === 'MongoInvalidArgumentError') {
    return new StewardServiceError('VALIDATION_FAILED', 'That connection setting is not valid', firstLine(message));
  }
  return new StewardServiceError('MONGO_FAILED', firstLine(message) || 'MongoDB reported an error');
}

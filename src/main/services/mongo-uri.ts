import { ConnectionString } from 'mongodb-connection-string-url';
import type { MongoSecretInput } from '@shared/schemas/mongodb';
import { StewardServiceError } from '@shared/types/result';

const HOST_PATTERN = /^[A-Za-z0-9._\-[\]:,]+$/;

/** The connection string behind a secret input. The form builds one; a pasted string is checked and kept. */
export function buildUri(secret: MongoSecretInput): string {
  if (secret.kind === 'uri') {
    const uri = secret.uri.trim();
    if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
      throw new StewardServiceError(
        'VALIDATION_FAILED',
        'That is not a MongoDB connection string',
        'It starts with mongodb:// or mongodb+srv://.'
      );
    }
    try {
      new ConnectionString(uri);
    } catch {
      throw new StewardServiceError('VALIDATION_FAILED', 'That connection string could not be read', 'Check it for typos, and encode special characters of the password (@ : / ?).');
    }
    return uri;
  }

  if (!HOST_PATTERN.test(secret.host)) {
    throw new StewardServiceError('VALIDATION_FAILED', 'That host is not valid', 'Use a host name, an IP address, or host1:port,host2:port.');
  }
  const scheme = secret.srv === true ? 'mongodb+srv' : 'mongodb';
  const hasPort = /:\d+$/.test(secret.host) || secret.host.includes(',');
  const hostPart = secret.srv === true || secret.port === undefined || hasPort ? secret.host : `${secret.host}:${secret.port}`;
  const user = secret.username === undefined || secret.username === '' ? '' : encodeURIComponent(secret.username);
  const password = secret.password === undefined || secret.password === '' ? '' : `:${encodeURIComponent(secret.password)}`;
  const credentials = user === '' ? '' : `${user}${password}@`;
  const database = secret.database === undefined || secret.database === '' ? '' : encodeURIComponent(secret.database);
  return `${scheme}://${credentials}${hostPart}/${database}`;
}

/** Hosts without credentials: safe to store in the database and show on screen. */
export function hostDisplayOf(uri: string): string {
  try {
    const parsed = new ConnectionString(uri);
    return parsed.hosts.join(', ');
  } catch {
    return 'unknown host';
  }
}

export function isAtlas(hostDisplay: string): boolean {
  return hostDisplay.split(',').some((host) => host.trim().replace(/:\d+$/, '').endsWith('.mongodb.net'));
}

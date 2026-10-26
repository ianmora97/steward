import type { ObservabilityKind } from '@shared/schemas/observability';
import { StewardServiceError } from '@shared/types/result';
import { redactSecrets } from './git-errors';

const MAX_MESSAGE = 300;

/**
 * Masks what a log line or an error message may quote: bearer tokens, the tokens of the tools themselves
 * (Grafana service accounts, Sentry), `token=…` pairs and JWTs. A net of patterns, not a guarantee: the UI says so.
 */
export function redactObservability(text: string): string {
  return redactSecrets(text)
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***')
    .replace(/\b(glsa_|glc_|glpat-|sntrys_|sntryu_)[A-Za-z0-9_=-]{16,}/g, '$1***')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '***')
    .replace(/(["']?\b(?:access[_-]?token|auth[_-]?token|api[_-]?key|apikey|token|secret|password|passwd)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&"']+)/gi, '$1***');
}

function firstLine(message: string): string {
  const line =
    redactObservability(message)
      .split(/\r?\n/)
      .map((candidate) => candidate.trim())
      .find((candidate) => candidate !== '') ?? '';
  return line.length > MAX_MESSAGE ? `${line.slice(0, MAX_MESSAGE)}…` : line;
}

interface NetworkLikeError {
  name?: string;
  code?: string;
  message?: string;
}

const TLS_PATTERN =
  /CERT_|SELF_SIGNED|DEPTH_ZERO|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ERR_TLS|ERR_SSL|certificate|handshake|wrong version number|alert (?:bad|unknown)/i;
const UNREACHABLE_PATTERN = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up/i;

const NAMES: Record<ObservabilityKind, string> = {
  grafana: 'Grafana',
  loki: 'Loki',
  prometheus: 'Prometheus',
  sentry: 'Sentry'
};

export function providerName(kind: ObservabilityKind): string {
  return NAMES[kind];
}

/** Turns whatever the network layer threw into one of the outcomes the page tells apart. Messages are redacted. */
export function translateObservabilityError(error: unknown, kind?: ObservabilityKind): StewardServiceError {
  if (error instanceof StewardServiceError) return error;
  const failure = (typeof error === 'object' && error !== null ? error : {}) as NetworkLikeError;
  const message = typeof failure.message === 'string' ? failure.message : '';
  const code = failure.code ?? '';
  const who = kind === undefined ? 'The server' : providerName(kind);

  if (TLS_PATTERN.test(code) || TLS_PATTERN.test(message)) {
    return new StewardServiceError(
      'OBS_TLS_FAILED',
      'The secure connection could not be established',
      'If the server uses a private or self-signed certificate, choose its CA file in the source settings.'
    );
  }
  if (failure.name === 'AbortError') {
    return new StewardServiceError('CANCELLED', 'The request was cancelled');
  }
  if (UNREACHABLE_PATTERN.test(code) || UNREACHABLE_PATTERN.test(message)) {
    return new StewardServiceError(
      'OBS_UNREACHABLE',
      `${who} cannot be reached`,
      'Check the address and port, that the server is running, and any VPN or firewall in between.'
    );
  }
  return new StewardServiceError('OBS_UNREACHABLE', `${who} could not be reached`, firstLine(message));
}

/** The message the server put in its error body (`message`, `error`, `detail`), or the first line of the text. */
function serverMessage(bodyText: string): string {
  const trimmed = bodyText.trim();
  if (trimmed === '') return '';
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      for (const key of ['message', 'error', 'detail']) {
        const value = record[key];
        if (typeof value === 'string' && value !== '') return firstLine(value);
      }
    }
  } catch {
    // Not JSON (Loki answers errors in plain text).
  }
  return firstLine(trimmed);
}

const RANGE_PATTERN = /exceeded maximum resolution|too many points|max(?:imum)? (?:query )?(?:length|range|lookback)|time range|query (?:length|range) .* (?:exceeds|too)|too far in the past/i;

/** Maps an HTTP status to an error, or `null` when the answer is a success. */
export function httpStatusError(status: number, bodyText: string, kind: ObservabilityKind): StewardServiceError | null {
  if (status >= 200 && status < 400) return null;
  const who = providerName(kind);
  const detail = serverMessage(bodyText);
  if (status === 401) {
    return new StewardServiceError(
      'OBS_AUTH_FAILED',
      `${who} rejected the credentials`,
      'The token is wrong or expired. Create a new one and save it in the source settings.'
    );
  }
  if (status === 403) {
    return new StewardServiceError(
      'OBS_FORBIDDEN',
      `${who} says this token cannot do that`,
      detail === '' ? 'Check the role or scopes of the token.' : detail
    );
  }
  if (status === 400 || status === 422) {
    if (RANGE_PATTERN.test(detail)) {
      return new StewardServiceError('OBS_RANGE_TOO_LARGE', 'That time range asks for too much data', 'Pick a shorter range.');
    }
    return new StewardServiceError('OBS_BAD_QUERY', `${who} did not accept the query`, detail === '' ? undefined : detail);
  }
  if (status === 404) {
    return new StewardServiceError(
      'OBS_BAD_RESPONSE',
      `${who} has nothing at this address`,
      'Check the address, including any path prefix such as /grafana.'
    );
  }
  if (status === 429) {
    return new StewardServiceError('OBS_BAD_RESPONSE', `${who} is rate limiting requests`, 'Wait a moment and try again.');
  }
  return new StewardServiceError(
    'OBS_BAD_RESPONSE',
    `${who} answered with an error (${status})`,
    detail === '' ? undefined : detail
  );
}

/** Parses a JSON body. A page of HTML (a proxy login, a wrong port) is reported as such, not as a syntax error. */
export function parseJsonBody<T>(bodyText: string, kind: ObservabilityKind): T {
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    const looksLikeHtml = /^\s*<(?:!doctype|html)/i.test(bodyText);
    throw new StewardServiceError(
      'OBS_BAD_RESPONSE',
      `${providerName(kind)} did not answer with data`,
      looksLikeHtml
        ? 'The address returned a web page, not the API. A login page of a proxy, or the wrong port or path, is the usual cause.'
        : 'The answer was not valid JSON.'
    );
  }
}

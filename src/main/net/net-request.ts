import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { StewardServiceError } from '@shared/types/result';

/**
 * The only way main talks HTTP to the tools a project connects (Grafana, Loki, Prometheus, Sentry).
 * `node:http(s)` rather than `fetch` because a private CA and a per-request "do not verify" switch are
 * options of the request here, with no extra dependency. The address always comes from a saved source.
 */
export interface NetRequestOptions {
  baseUrl: string;
  /** A path owned by the provider, starting with `/`. It is appended to the path prefix of `baseUrl`. */
  path: string;
  query?: Record<string, string | readonly string[]>;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  caFile?: string;
  allowInsecureTls?: boolean;
  signal?: AbortSignal;
}

export interface NetResponse {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  elapsedMs: number;
}

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Parses and checks the address of a source. Shape rules live here too, so nothing reaches the socket unchecked. */
export function parseBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StewardServiceError('VALIDATION_FAILED', 'That is not a valid address', 'Use a full address such as https://grafana.example.com');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new StewardServiceError('VALIDATION_FAILED', 'The address must start with http:// or https://');
  }
  if (url.username !== '' || url.password !== '') {
    throw new StewardServiceError('VALIDATION_FAILED', 'The address must not contain a user name or password', 'Use the token fields instead.');
  }
  return url;
}

/** `https://host/grafana/` + `/api/health` → `https://host/grafana/api/health`, without doubled or missing slashes. */
export function buildUrl(baseUrl: string, path: string, query?: NetRequestOptions['query']): URL {
  const base = parseBaseUrl(baseUrl);
  const prefix = base.pathname.replace(/\/+$/, '');
  const url = new URL(base.origin);
  url.pathname = `${prefix}${path.startsWith('/') ? path : `/${path}`}`;
  for (const [key, value] of Object.entries(query ?? {})) {
    if (typeof value === 'string') url.searchParams.append(key, value);
    else for (const item of value) url.searchParams.append(key, item);
  }
  return url;
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function readCa(caFile: string): Buffer {
  try {
    return readFileSync(caFile);
  } catch {
    throw new StewardServiceError(
      'PATH_NOT_FOUND',
      'The CA certificate file cannot be read',
      'Choose the file again in the source settings.'
    );
  }
}

function send(url: URL, options: NetRequestOptions, ca: Buffer | undefined): Promise<RawResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const secure = url.protocol === 'https:';
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'Steward', ...options.headers };
  if (options.body !== undefined) headers['content-length'] = String(Buffer.byteLength(options.body));

  return new Promise<RawResponse>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    const requestOptions: https.RequestOptions = {
      method: options.method ?? 'GET',
      headers,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(secure ? { ca, rejectUnauthorized: options.allowInsecureTls !== true } : {})
    };
    const request = (secure ? https : http).request(url, requestOptions, (response) => {
      const chunks: Buffer[] = [];
      let received = 0;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > maxBytes) {
          request.destroy(
            new StewardServiceError(
              'OBS_RESPONSE_TOO_LARGE',
              'The answer is larger than Steward will read',
              'Narrow the query: a shorter time range, a tighter selector or a lower limit.'
            )
          );
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () =>
        finish(() => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }))
      );
      response.on('error', (error) => finish(() => reject(error)));
    });

    const timer = setTimeout(() => {
      request.destroy(
        new StewardServiceError(
          'OBS_TIMEOUT',
          `The server did not answer within ${Math.round(timeoutMs / 1000)} seconds`,
          'The query may be too heavy, or the server may be overloaded.'
        )
      );
    }, timeoutMs);

    request.on('error', (error) => finish(() => reject(error)));
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

function flattenHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') flat[name] = value;
    else if (Array.isArray(value)) flat[name] = value.join(', ');
  }
  return flat;
}

/**
 * One request with the limits every provider shares: a timeout, a ceiling on the size of the answer, and
 * redirects only inside the same origin (three at most). A redirect to another origin is refused instead of
 * followed, so a credential header can never be sent anywhere the user did not configure.
 */
export async function netRequest(options: NetRequestOptions): Promise<NetResponse> {
  const started = Date.now();
  const ca = options.caFile === undefined ? undefined : readCa(options.caFile);
  let url = buildUrl(options.baseUrl, options.path, options.query);
  const origin = url.origin;
  let current: NetRequestOptions = options;

  for (let hop = 0; ; hop += 1) {
    const raw = await send(url, current, ca);
    const location = raw.headers.location;
    if (REDIRECT_STATUSES.has(raw.status) && typeof location === 'string') {
      if (hop >= MAX_REDIRECTS) {
        throw new StewardServiceError('OBS_BAD_RESPONSE', 'The server redirected too many times');
      }
      const next = new URL(location, url);
      if (next.origin !== origin) {
        throw new StewardServiceError(
          'OBS_BAD_RESPONSE',
          'The server redirected to a different address, which Steward does not follow',
          'Use the final address of the server in the source settings.'
        );
      }
      url = next;
      if (raw.status === 303) {
        current = { ...current, method: 'GET' };
        delete current.body;
      }
      continue;
    }
    return {
      status: raw.status,
      headers: flattenHeaders(raw.headers),
      bodyText: raw.body.toString('utf8'),
      elapsedMs: Date.now() - started
    };
  }
}

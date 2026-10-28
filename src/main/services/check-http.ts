import http from 'node:http';
import https from 'node:https';
import type { DetectedProxy, HttpCheckConfig } from '@shared/schemas/cloud';
import { StewardServiceError } from '@shared/types/result';
import { cancelled, describeNetworkError, failure, timeoutError, type CheckOutcome } from './check-outcome';
import { detectProxy } from './check-state';

const HTTP_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 64 * 1024;
const USER_AGENT = 'Steward-check';

/** The only response headers that are ever kept. Cookies, authorization and anything else are dropped. */
const KEPT_HEADERS = ['server', 'via', 'cf-ray', 'x-amz-cf-id', 'content-type', 'cache-control', 'strict-transport-security'] as const;

const PROXY_LABEL: Record<DetectedProxy, string> = {
  cloudflare: 'Cloudflare',
  cloudfront: 'CloudFront',
  alb: 'AWS load balancer'
};

interface Phases {
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
}

interface HopResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  phases: Phases;
  /** The start of the page, only when the caller asked for it for this status. */
  body: Buffer | null;
}

interface HopLog {
  status: number;
  /** Address without query string or fragment: those are where tokens end up. */
  url: string;
}

function sanitized(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function flattenHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value !== undefined) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

function isRedirect(status: number, headers: Record<string, string>): boolean {
  return [301, 302, 303, 307, 308].includes(status) && headers['location'] !== undefined;
}

function round(ms: number | null): number | null {
  return ms === null ? null : Math.max(0, Math.round(ms));
}

function phasesOf(started: number, marks: { lookup?: number; connect?: number; secure?: number; response?: number }): Phases {
  const connected = marks.connect ?? null;
  const afterTransport = marks.secure ?? connected ?? started;
  return {
    dnsMs: round(marks.lookup === undefined ? null : marks.lookup - started),
    connectMs: round(connected === null ? null : connected - (marks.lookup ?? started)),
    tlsMs: round(marks.secure !== undefined && connected !== null ? marks.secure - connected : null),
    ttfbMs: round(marks.response === undefined ? null : marks.response - afterTransport)
  };
}

/**
 * One request, no keep-alive, no body sent. It resolves once the headers are in (and the start of the page, if the
 * caller wants it for this status) and then drops the connection. The deadline is shared by all hops of a check.
 */
function requestHop(
  url: URL,
  method: HttpCheckConfig['method'],
  readBody: (status: number, headers: Record<string, string>) => boolean,
  deadline: number,
  signal: AbortSignal
): Promise<HopResponse> {
  return new Promise<HopResponse>((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(timeoutError());
      return;
    }
    const transport = url.protocol === 'https:' ? https : http;
    const started = performance.now();
    const marks: { lookup?: number; connect?: number; secure?: number; response?: number } = {};
    let settled = false;

    const finish = (error: Error | null, value?: HopResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      request.destroy();
      if (error !== null) reject(error);
      else if (value !== undefined) resolve(value);
    };
    const timer = setTimeout(() => finish(timeoutError()), remaining);
    const onAbort = (): void => finish(cancelled());
    signal.addEventListener('abort', onAbort, { once: true });

    const request = transport.request(
      {
        protocol: url.protocol,
        // An IPv6 address comes bracketed in a URL and bare in a request.
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        ...(url.port === '' ? {} : { port: Number(url.port) }),
        path: `${url.pathname}${url.search}`,
        method,
        agent: false,
        headers: { 'user-agent': USER_AGENT, accept: '*/*', 'accept-encoding': 'identity' }
      },
      (response) => {
        marks.response = performance.now();
        // Dropping the connection after the headers makes the response emit an error nobody asked for.
        response.on('error', () => {});
        const headers = flattenHeaders(response.headers);
        const status = response.statusCode ?? 0;
        const statusText = response.statusMessage ?? '';
        const phases = phasesOf(started, marks);
        if (!readBody(status, headers)) {
          finish(null, { status, statusText, headers, phases, body: null });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const done = (): void => finish(null, { status, statusText, headers, phases, body: Buffer.concat(chunks) });
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= MAX_BODY_BYTES) done();
        });
        response.on('end', done);
        response.on('close', done);
      }
    );
    request.on('socket', (socket) => {
      socket.once('lookup', () => {
        marks.lookup = performance.now();
      });
      socket.once('connect', () => {
        marks.connect = performance.now();
      });
      socket.once('secureConnect', () => {
        marks.secure = performance.now();
      });
    });
    request.on('error', (error) => finish(error));
    request.end();
  });
}

function pickHeaders(headers: Record<string, string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const value = headers[name];
    if (value !== undefined) kept[name] = value.slice(0, 300);
  }
  return kept;
}

/**
 * Requests the page of a domain and judges the answer. Redirects are followed by hand (five at most) so that every
 * hop can be shown and checked: only http and https, no credentials in the address, no loops. A refused connection,
 * a bad certificate or a 500 are `fail` outcomes; this only throws when it is cancelled.
 */
export async function runHttpCheck(options: { hostname: string; config: HttpCheckConfig; signal: AbortSignal }): Promise<CheckOutcome> {
  const { hostname, config, signal } = options;
  if (signal.aborted) throw cancelled();

  let current: URL;
  try {
    current = new URL(`${config.scheme}://${hostname}${config.path}`);
  } catch {
    throw new StewardServiceError('CHECK_INVALID_TARGET', 'The address of this check is not valid');
  }
  // The path comes from the user: whatever it holds, the request must still go to the domain.
  if (current.hostname !== hostname || current.username !== '' || current.password !== '') {
    throw new StewardServiceError('CHECK_INVALID_TARGET', 'The path of this check would leave the domain');
  }

  const started = performance.now();
  const deadline = Date.now() + HTTP_TIMEOUT_MS;
  const hops: HopLog[] = [];
  const seen = new Set<string>();
  let downgraded = false;
  const wantsBody = (status: number, headers: Record<string, string>): boolean =>
    config.expectText !== undefined && !isRedirect(status, headers);

  for (;;) {
    seen.add(current.href);
    let response: HopResponse;
    try {
      response = await requestHop(current, config.method, wantsBody, deadline, signal);
    } catch (error) {
      if (error instanceof StewardServiceError) throw error;
      const where = hops.length === 0 ? '' : ` while following the redirect to ${current.host}`;
      return failure(`${describeNetworkError(error)}${where}`, { responded: hops.length > 0, hops, port: current.port || null });
    }
    hops.push({ status: response.status, url: sanitized(current) });

    if (!isRedirect(response.status, response.headers)) {
      return judge(config, response, current, hops, downgraded, Math.round(performance.now() - started));
    }

    const detail = { responded: true, hops };
    if (hops.length > MAX_REDIRECTS) return failure(`Too many redirects (more than ${MAX_REDIRECTS})`, detail);
    let next: URL;
    try {
      next = new URL(response.headers['location'] ?? '', current);
    } catch {
      return failure('The redirect points to an invalid address', detail);
    }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      return failure(`The redirect goes to an unsupported address (${next.protocol.replace(':', '')})`, detail);
    }
    if (next.username !== '' || next.password !== '') return failure('The redirect address contains credentials, so it was not followed', detail);
    next.hash = '';
    if (seen.has(next.href)) return failure('The redirects loop back to an address already visited', detail);
    if (current.protocol === 'https:' && next.protocol === 'http:') downgraded = true;
    current = next;
  }
}

function judge(
  config: HttpCheckConfig,
  response: HopResponse,
  finalUrl: URL,
  hops: HopLog[],
  downgraded: boolean,
  totalMs: number
): CheckOutcome {
  const proxy = detectProxy(response.headers);
  const textFound = config.expectText === undefined ? undefined : (response.body?.toString('utf8').includes(config.expectText) ?? false);
  const detail = {
    responded: true,
    hops,
    finalUrl: sanitized(finalUrl),
    status: response.status,
    statusText: response.statusText,
    phases: response.phases,
    totalMs,
    proxy,
    headers: pickHeaders(response.headers),
    ...(textFound === undefined ? {} : { textFound }),
    ...(downgraded ? { downgrade: true } : {})
  };

  const { min, max } = config.expectedStatus;
  if (response.status < min || response.status > max) {
    const expected = min === max ? `${min}` : `${min}–${max}`;
    return failure(`Expected ${expected}, got ${response.status} ${response.statusText}`.trim(), detail, totalMs);
  }
  if (textFound === false) return failure('The expected text was not found in the first 64 KB of the page', detail, totalMs);

  const redirects = hops.length - 1;
  const parts = [
    `${response.status} ${response.statusText} in ${totalMs} ms`.replace('  ', ' '),
    ...(proxy === null ? [] : [PROXY_LABEL[proxy]]),
    ...(redirects > 0 ? [`${redirects} redirect${redirects === 1 ? '' : 's'}`] : [])
  ];
  if (downgraded) return { status: 'warn', latencyMs: totalMs, summary: `${parts.join(' · ')} · redirects to plain HTTP`, detail };
  return { status: 'ok', latencyMs: totalMs, summary: parts.join(' · '), detail };
}

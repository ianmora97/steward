import { connect, checkServerIdentity, type DetailedPeerCertificate, type PeerCertificate } from 'node:tls';
import type { TlsCheckConfig } from '@shared/schemas/cloud';
import { cancelled, describeCertificateCode, describeNetworkError, failure, type CheckOutcome } from './check-outcome';
import { daysUntil } from './check-state';

const TLS_TIMEOUT_MS = 10_000;
/** Less than this is a failure, less than WARN_DAYS a warning: time enough to renew, or not. */
const FAIL_DAYS = 7;
const WARN_DAYS = 21;
const DAY_MS = 86_400_000;
const MAX_NAMES = 20;
const MAX_CHAIN = 6;

function nameOf(entry: { CN?: string | string[]; O?: string | string[] } | undefined): string {
  if (entry === undefined) return '';
  const value = entry.CN ?? entry.O ?? '';
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

function alternativeNames(certificate: PeerCertificate): string[] {
  if (certificate.subjectaltname === undefined) return [];
  return certificate.subjectaltname
    .split(', ')
    .map((entry) => (entry.startsWith('DNS:') ? entry.slice(4) : entry.startsWith('IP Address:') ? entry.slice(11) : ''))
    .filter((entry) => entry !== '')
    .slice(0, MAX_NAMES);
}

/** The issuers up the chain, stopping at a root that points to itself. */
function chainOf(leaf: DetailedPeerCertificate): { subject: string; issuer: string }[] {
  const chain: { subject: string; issuer: string }[] = [];
  const seen = new Set<string>();
  let current: DetailedPeerCertificate | undefined = leaf;
  while (current !== undefined && chain.length < MAX_CHAIN && !seen.has(current.fingerprint256)) {
    seen.add(current.fingerprint256);
    chain.push({ subject: nameOf(current.subject), issuer: nameOf(current.issuer) });
    current = current.issuerCertificate;
  }
  return chain;
}

function evaluate(
  hostname: string,
  certificate: DetailedPeerCertificate,
  authorizationError: string | Error | null,
  protocol: string | null,
  latencyMs: number
): CheckOutcome {
  const nowMs = Date.now();
  const validTo = new Date(certificate.valid_to);
  const validFrom = new Date(certificate.valid_from);
  if (Number.isNaN(validTo.getTime()) || Number.isNaN(validFrom.getTime())) {
    return failure('The certificate has no readable validity dates', {}, latencyMs);
  }

  const identityError = checkServerIdentity(hostname, certificate);
  const authorization = authorizationError === null ? null : typeof authorizationError === 'string' ? authorizationError : authorizationError.message;
  const daysLeft = daysUntil(validTo.toISOString(), nowMs);
  const issuer = nameOf(certificate.issuer);
  const detail = {
    subject: nameOf(certificate.subject),
    issuer,
    names: alternativeNames(certificate),
    validFrom: validFrom.toISOString(),
    validTo: validTo.toISOString(),
    daysLeft,
    protocol,
    chain: chainOf(certificate),
    ...(authorization === null ? {} : { authorizationError: authorization }),
    ...(identityError === undefined ? {} : { nameMismatch: true })
  };

  // Order matters: an expired certificate is also "not trusted" to OpenSSL, but expiry is the useful reason.
  if (validTo.getTime() <= nowMs) {
    const days = Math.max(1, Math.ceil((nowMs - validTo.getTime()) / DAY_MS));
    return failure(`The certificate expired ${days} day${days === 1 ? '' : 's'} ago`, detail, latencyMs);
  }
  if (validFrom.getTime() > nowMs) return failure('The certificate is not valid yet', detail, latencyMs);
  if (identityError !== undefined) {
    const names = detail.names.slice(0, 3).join(', ');
    return failure(`The certificate is not for ${hostname}${names === '' ? '' : ` (it is for ${names})`}`, detail, latencyMs);
  }
  if (authorization !== null) {
    return failure(describeCertificateCode(authorization) ?? `The certificate is not trusted (${authorization})`, detail, latencyMs);
  }
  if (daysLeft < FAIL_DAYS) {
    return failure(`The certificate expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`, detail, latencyMs);
  }
  const summary = `Valid for ${daysLeft} more days${issuer === '' ? '' : ` · issued by ${issuer}`}`;
  return { status: daysLeft < WARN_DAYS ? 'warn' : 'ok', latencyMs, summary, detail };
}

/**
 * Connects, reads the certificate and judges it. It connects without rejecting a bad certificate on purpose: an
 * expired, self-signed or wrong-name certificate is the thing to report, and it can only be read if the handshake
 * is allowed to finish. Nothing is sent after the handshake.
 */
export function runTlsCheck(options: { hostname: string; config: TlsCheckConfig; signal: AbortSignal }): Promise<CheckOutcome> {
  const { hostname, config, signal } = options;
  if (signal.aborted) return Promise.reject(cancelled());

  return new Promise<CheckOutcome>((resolve, reject) => {
    const started = performance.now();
    let settled = false;
    const socket = connect({
      host: hostname,
      port: config.port,
      servername: hostname,
      rejectUnauthorized: false,
      timeout: TLS_TIMEOUT_MS
    });

    const finish = (outcome: CheckOutcome | Error): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      socket.destroy();
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    };
    const onAbort = (): void => finish(cancelled());
    signal.addEventListener('abort', onAbort, { once: true });

    socket.once('secureConnect', () => {
      const latencyMs = Math.round(performance.now() - started);
      const certificate = socket.getPeerCertificate(true);
      if (Object.keys(certificate).length === 0) {
        finish(failure('The server did not present a certificate', {}, latencyMs));
        return;
      }
      finish(evaluate(hostname, certificate, socket.authorizationError ?? null, socket.getProtocol(), latencyMs));
    });
    socket.once('timeout', () => finish(failure(`Timed out after ${TLS_TIMEOUT_MS / 1000} s`)));
    socket.once('error', (error) => finish(failure(describeNetworkError(error), { port: config.port })));
    socket.once('close', () => finish(failure('The connection closed before the handshake finished', { port: config.port })));
  });
}

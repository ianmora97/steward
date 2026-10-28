import type { CheckStatus } from '@shared/schemas/cloud';
import { StewardServiceError } from '@shared/types/result';

/**
 * What a check engine hands back. The things that go wrong at the destination (no such domain, a refused
 * connection, a bad certificate, a 500) are an answer, `fail`, not an exception: engines only throw when they are
 * given an invalid configuration or are cancelled.
 */
export interface CheckOutcome {
  status: CheckStatus;
  latencyMs: number | null;
  summary: string;
  /** Plain data for the detail view. Kept to a closed set of fields: never a body, a cookie or a query string. */
  detail: Record<string, unknown>;
}

export function cancelled(): StewardServiceError {
  return new StewardServiceError('CANCELLED', 'The check was cancelled');
}

export function failure(summary: string, detail: Record<string, unknown> = {}, latencyMs: number | null = null): CheckOutcome {
  return { status: 'fail', latencyMs, summary, detail };
}

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

const CERTIFICATE_REASONS: Record<string, string> = {
  CERT_HAS_EXPIRED: 'The certificate has expired',
  CERT_NOT_YET_VALID: 'The certificate is not valid yet',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The certificate is self-signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'The certificate chain contains a self-signed certificate',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The certificate chain is incomplete or its issuer is not trusted',
  UNABLE_TO_GET_ISSUER_CERT: 'The certificate issuer is not trusted',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'The certificate issuer is not trusted',
  ERR_TLS_CERT_ALTNAME_INVALID: 'The certificate is for a different name',
  CERT_REVOKED: 'The certificate was revoked'
};

/** A certificate verification code in words, or null when it is not one. */
export function describeCertificateCode(code: string): string | null {
  return CERTIFICATE_REASONS[code] ?? null;
}

/** Why a connection could not be made, in words a person can act on. Never the raw message of the error. */
export function describeNetworkError(error: unknown): string {
  const code = codeOf(error);
  if (code === undefined) return 'Could not connect';
  const certificate = describeCertificateCode(code);
  if (certificate !== null) return certificate;
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
    case 'ENODATA':
      return 'The name does not resolve';
    case 'ECONNREFUSED':
      return 'Connection refused';
    case 'ECONNRESET':
      return 'Connection reset by the server';
    case 'ETIMEDOUT':
      return 'Timed out';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'No route to the host';
    case 'EPROTO':
    case 'ERR_SSL_WRONG_VERSION_NUMBER':
    case 'ERR_SSL_PACKET_LENGTH_TOO_LONG':
      return 'The server does not speak TLS on this port';
    default:
      return `Could not connect (${code})`;
  }
}

/** The error a hop or a socket raises when the time budget runs out, so it reads like any other timeout. */
export function timeoutError(): Error {
  return Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
}

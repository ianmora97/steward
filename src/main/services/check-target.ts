import { domainToASCII } from 'node:url';
import { StewardServiceError } from '@shared/types/result';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HINT = 'Type only the name, for example app.example.com.';

function invalid(message: string): StewardServiceError {
  return new StewardServiceError('CHECK_INVALID_TARGET', message, HINT);
}

/**
 * The only thing a check is ever pointed at is the hostname of a domain the user registered, so this is the
 * single gate for what the app will resolve, connect to or request. It normalizes what is safe to normalize
 * (case, one trailing dot, internationalized names) and rejects the rest with a message that says what to type.
 */
export function normalizeHostname(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') throw invalid('The domain name is required');
  if (/\s/.test(trimmed)) throw invalid('A domain name cannot contain spaces');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) throw invalid('Remove the http:// or https:// at the start');
  if (/[/?#]/.test(trimmed)) throw invalid('Remove the path, query or anything after the name');
  if (trimmed.includes('@')) throw invalid('A domain name cannot contain a user name or password');
  if (trimmed.includes(':')) throw invalid('Remove the port; IP addresses are not accepted either');

  const lower = trimmed.toLowerCase().replace(/\.$/, '');
  // domainToASCII also reads "1.2.3" as an IPv4 address, so plain ASCII names are validated as typed.
  const ascii = /^[ -~]*$/.test(lower) ? lower : domainToASCII(lower);
  if (ascii === '') throw invalid('That is not a valid domain name');
  if (ascii.length > 253) throw invalid('A domain name can have at most 253 characters');

  const labels = ascii.split('.');
  if (labels.length < 2) throw invalid('A domain needs at least two parts, such as example.com');
  for (const label of labels) {
    if (!LABEL.test(label)) {
      throw invalid(`"${label.slice(0, 40)}" is not a valid part: use letters, digits and dashes, 63 characters at most, no dash at either end`);
    }
  }
  if (/^\d+$/.test(labels[labels.length - 1] ?? '')) {
    throw invalid('A name ending in a number looks like an IP address, which is not accepted');
  }
  return ascii;
}

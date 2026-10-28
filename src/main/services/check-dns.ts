import { Resolver } from 'node:dns/promises';
import type { DnsCheckConfig } from '@shared/schemas/cloud';
import { cancelled, failure, type CheckOutcome } from './check-outcome';
import { containsAll, normalizeIp, normalizeName, sameMembers } from './check-state';

const DNS_TIMEOUT_MS = 5000;

type RecordType = DnsCheckConfig['recordTypes'][number];

interface Lookup {
  records: string[];
  ms: number;
}

/** c-ares says `ENODATA` when the name exists but has no record of that type, which is normal, not a failure. */
function codeOf(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : 'UNKNOWN';
}

async function lookup(resolver: Resolver, type: RecordType, hostname: string): Promise<Lookup> {
  const started = performance.now();
  let records: string[];
  switch (type) {
    case 'A':
      records = await resolver.resolve4(hostname);
      break;
    case 'AAAA':
      records = await resolver.resolve6(hostname);
      break;
    case 'CNAME':
      records = await resolver.resolveCname(hostname);
      break;
    case 'NS':
      records = await resolver.resolveNs(hostname);
      break;
    case 'MX':
      records = (await resolver.resolveMx(hostname)).map((entry) => `${entry.priority} ${entry.exchange}`);
      break;
    case 'TXT':
      records = (await resolver.resolveTxt(hostname)).map((chunks) => chunks.join(''));
      break;
  }
  return { records, ms: performance.now() - started };
}

function failureReason(codes: readonly string[], resolverLabel: string): string {
  // A server that did not answer says more than a name it could not find on another try.
  if (codes.some((code) => code === 'ETIMEOUT' || code === 'ECONNREFUSED' || code === 'ESERVFAIL' || code === 'EREFUSED')) {
    return `The DNS server (${resolverLabel}) did not answer`;
  }
  if (codes.includes('ENOTFOUND')) return 'The domain does not exist (NXDOMAIN)';
  return 'The domain has none of the requested record types';
}

function describeRecords(found: Map<RecordType, string[]>): string {
  const parts: string[] = [];
  for (const [type, records] of found) {
    const shown = records.slice(0, 3).join(', ');
    parts.push(`${type} ${shown}${records.length > 3 ? ` +${records.length - 3}` : ''}`);
  }
  return parts.join(' · ');
}

/**
 * Resolves the requested record types of a domain against a chosen resolver and, when the user said what it should
 * point to, reports drift. A name that does not exist, a server that does not answer and a mismatch are all
 * `fail` outcomes: this only throws when it is cancelled.
 */
export async function runDnsCheck(options: { hostname: string; config: DnsCheckConfig; signal: AbortSignal }): Promise<CheckOutcome> {
  const { hostname, config, signal } = options;
  if (signal.aborted) throw cancelled();

  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
  if (config.resolver !== 'system') resolver.setServers([config.resolver]);
  const resolverLabel = config.resolver === 'system' ? 'system resolver' : config.resolver;
  const onAbort = (): void => resolver.cancel();
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    const settled = await Promise.allSettled(config.recordTypes.map((type) => lookup(resolver, type, hostname)));
    if (signal.aborted) throw cancelled();

    const found = new Map<RecordType, string[]>();
    const errorCodes: string[] = [];
    const latencies: number[] = [];
    settled.forEach((result, index) => {
      const type = config.recordTypes[index];
      if (type === undefined) return;
      if (result.status === 'fulfilled') {
        if (result.value.records.length > 0) found.set(type, result.value.records);
        latencies.push(result.value.ms);
      } else {
        errorCodes.push(codeOf(result.reason));
      }
    });
    const latencyMs = latencies.length === 0 ? null : Math.round(Math.min(...latencies));

    // "No data" and "no such name" for one type are normal answers; anything else (a timeout on AAAA) is worth showing.
    const trouble = [...new Set(errorCodes.filter((code) => code !== 'ENODATA' && code !== 'ENOTFOUND'))];
    const base = {
      resolver: config.resolver,
      records: Object.fromEntries(found),
      ...(trouble.length > 0 ? { errorCodes: trouble } : {})
    };
    if (found.size === 0) {
      return failure(failureReason(errorCodes, resolverLabel), { ...base, errorCodes: [...new Set(errorCodes)] });
    }

    const expected = config.expected;
    if (expected?.addresses !== undefined) {
      const actual = new Set([...(found.get('A') ?? []), ...(found.get('AAAA') ?? [])].map(normalizeIp));
      const wanted = new Set(expected.addresses.map(normalizeIp));
      const mode = expected.addressesMode ?? 'exact';
      const matches = mode === 'exact' ? sameMembers(actual, wanted) : containsAll(actual, wanted);
      if (!matches) {
        const detail = { ...base, drift: true, expected: [...wanted], actual: [...actual], mode };
        return failure(`Drift: expected ${[...wanted].join(', ')}, resolves to ${[...actual].join(', ') || 'nothing'}`, detail, latencyMs);
      }
    }
    if (expected?.cname !== undefined) {
      const actual = new Set((found.get('CNAME') ?? []).map(normalizeName));
      const wanted = normalizeName(expected.cname);
      if (!actual.has(wanted)) {
        const detail = { ...base, drift: true, expectedCname: wanted, actual: [...actual] };
        return failure(`Drift: expected the CNAME ${wanted}, found ${[...actual].join(', ') || 'none'}`, detail, latencyMs);
      }
    }

    return {
      status: 'ok',
      latencyMs,
      summary: `${describeRecords(found)} (${resolverLabel})`,
      detail: { ...base, drift: false }
    };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

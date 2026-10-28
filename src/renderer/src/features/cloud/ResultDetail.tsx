import type { CheckKind, CheckResult } from '@shared/schemas/cloud';
import { Badge } from '../../components/Badge';
import { PROXY_LABEL, formatLatency } from './cloud-meta';

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return list(value).filter((item): item is string => typeof item === 'string');
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function date(iso: string | null): string {
  if (iso === null) return '—';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function DnsDetail({ detail }: { detail: Json }): React.JSX.Element {
  const records = record(detail['records']) ?? {};
  const expected = strings(detail['expected']);
  const actual = strings(detail['actual']);
  const drift = detail['drift'] === true;
  return (
    <dl className="cddetail">
      <Row label="Resolver">{text(detail['resolver']) === 'system' ? 'System' : (text(detail['resolver']) ?? '—')}</Row>
      {Object.entries(records).map(([type, values]) => (
        <Row key={type} label={type}>
          <span className="cdmono cdlines">{strings(values).join('\n')}</span>
        </Row>
      ))}
      {drift && (
        <Row label="Drift">
          {expected.length > 0 && <span className="cdmono">expected {expected.join(', ')}</span>}
          {text(detail['expectedCname']) !== null && <span className="cdmono">expected {text(detail['expectedCname'])}</span>}
          {(actual.length > 0 || expected.length > 0) && <span className="cdmono"> · found {actual.join(', ') || 'nothing'}</span>}
        </Row>
      )}
      {strings(detail['errorCodes']).length > 0 && <Row label="Resolver errors">{strings(detail['errorCodes']).join(', ')}</Row>}
    </dl>
  );
}

function TlsDetail({ detail }: { detail: Json }): React.JSX.Element {
  const daysLeft = number(detail['daysLeft']);
  const chain = list(detail['chain']).map(record).filter((item): item is Json => item !== null);
  const names = strings(detail['names']);
  if (text(detail['validTo']) === null) {
    return <p className="card__hint">No certificate was read{number(detail['port']) === null ? '' : ` on port ${number(detail['port'])}`}.</p>;
  }
  return (
    <dl className="cddetail">
      <Row label="Issued to">{text(detail['subject']) ?? '—'}</Row>
      <Row label="Issued by">{text(detail['issuer']) ?? '—'}</Row>
      <Row label="Valid">
        {date(text(detail['validFrom']))} → {date(text(detail['validTo']))}
        {daysLeft !== null && <> ({daysLeft < 0 ? `expired ${-daysLeft} days ago` : `${daysLeft} days left`})</>}
      </Row>
      {names.length > 0 && (
        <Row label="Names">
          <span className="cdmono cdlines">{names.join('\n')}</span>
        </Row>
      )}
      {text(detail['protocol']) !== null && <Row label="Protocol">{text(detail['protocol'])}</Row>}
      {text(detail['authorizationError']) !== null && <Row label="Trust">{text(detail['authorizationError'])}</Row>}
      {chain.length > 0 && (
        <Row label="Chain">
          <ol className="cdchain">
            {chain.map((link, position) => (
              <li key={position}>
                {text(link['subject']) ?? '—'} <span className="card__hint">← {text(link['issuer']) ?? '—'}</span>
              </li>
            ))}
          </ol>
        </Row>
      )}
    </dl>
  );
}

function HttpDetail({ detail }: { detail: Json }): React.JSX.Element {
  const hops = list(detail['hops']).map(record).filter((item): item is Json => item !== null);
  const phases = record(detail['phases']);
  const headers = Object.entries(record(detail['headers']) ?? {});
  const proxy = text(detail['proxy']);
  const phaseText = phases === null ? [] : (
    [
      ['DNS', number(phases['dnsMs'])],
      ['connect', number(phases['connectMs'])],
      ['TLS', number(phases['tlsMs'])],
      ['first byte', number(phases['ttfbMs'])]
    ] as const
  ).filter(([, ms]) => ms !== null).map(([name, ms]) => `${name} ${formatLatency(ms ?? 0)}`);
  return (
    <dl className="cddetail">
      {hops.length > 0 && (
        <Row label={hops.length > 1 ? 'Redirects' : 'Request'}>
          <ol className="cdchain">
            {hops.map((hop, position) => (
              <li key={position}>
                <span className="cdmono">{number(hop['status']) ?? '—'}</span> <span className="cdmono">{text(hop['url']) ?? '—'}</span>
              </li>
            ))}
          </ol>
        </Row>
      )}
      {detail['downgrade'] === true && <Row label="Warning">A redirect drops from HTTPS to plain HTTP.</Row>}
      {phaseText.length > 0 && <Row label="Timing">{phaseText.join(' · ')}</Row>}
      {proxy !== null && <Row label="Served through">{PROXY_LABEL[proxy as keyof typeof PROXY_LABEL] ?? proxy}</Row>}
      {typeof detail['textFound'] === 'boolean' && (
        <Row label="Expected text">
          <Badge tone={detail['textFound'] ? 'success' : 'failure'}>{detail['textFound'] ? 'Found' : 'Not found'}</Badge>
        </Row>
      )}
      {headers.length > 0 && (
        <Row label="Headers">
          <span className="cdmono cdlines">{headers.map(([name, value]) => `${name}: ${String(value)}`).join('\n')}</span>
        </Row>
      )}
    </dl>
  );
}

/** What the latest result of a check found, laid out by the kind of check. The data is whatever main stored: every field is optional. */
export function ResultDetail({ kind, result }: { kind: CheckKind; result: CheckResult }): React.JSX.Element {
  if (kind === 'dns') return <DnsDetail detail={result.detail} />;
  if (kind === 'tls') return <TlsDetail detail={result.detail} />;
  return <HttpDetail detail={result.detail} />;
}

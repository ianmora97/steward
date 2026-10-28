import { useState } from 'react';
import {
  DNS_RECORD_TYPES,
  DNS_RESOLVERS,
  type Check,
  type CheckConfig,
  type CheckKind,
  type DnsCheckConfig,
  type DomainSummary,
  type HttpCheckConfig
} from '@shared/schemas/cloud';
import { fail } from '@shared/types/result';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { useAction } from '../../components/useAction';
import { CHECK_KIND_LABEL, INTERVAL_PRESETS, formatInterval } from './cloud-meta';

const DEFAULT_INTERVAL: Record<CheckKind, number> = { dns: 300, tls: 3600, http: 60 };

type RecordType = (typeof DNS_RECORD_TYPES)[number];

const dnsOf = (check: Check | null): DnsCheckConfig | null => (check !== null && 'resolver' in check.config ? check.config : null);
const httpOf = (check: Check | null): HttpCheckConfig | null => (check !== null && 'scheme' in check.config ? check.config : null);
const tlsPortOf = (check: Check | null): number | null => (check !== null && 'port' in check.config ? check.config.port : null);

/** Addresses typed one per line, or separated by commas or spaces. */
function splitList(raw: string): string[] {
  return raw.split(/[\s,]+/).filter((item) => item !== '');
}

export function CheckDialog({
  domain,
  existing,
  onClose,
  onSaved
}: {
  domain: DomainSummary;
  existing: Check | null;
  onClose: () => void;
  onSaved: (check: Check) => void;
}): React.JSX.Element {
  const [kind, setKind] = useState<CheckKind>(existing?.kind ?? 'http');
  const [intervalSeconds, setIntervalSeconds] = useState(existing?.intervalSeconds ?? DEFAULT_INTERVAL[existing?.kind ?? 'http']);

  const dns = dnsOf(existing);
  const [resolver, setResolver] = useState<DnsCheckConfig['resolver']>(dns?.resolver ?? 'system');
  const [recordTypes, setRecordTypes] = useState<RecordType[]>(dns?.recordTypes ?? ['A', 'AAAA', 'CNAME']);
  const [expectedAddresses, setExpectedAddresses] = useState((dns?.expected?.addresses ?? []).join('\n'));
  const [addressesMode, setAddressesMode] = useState<'exact' | 'includes'>(dns?.expected?.addressesMode ?? 'exact');
  const [expectedCname, setExpectedCname] = useState(dns?.expected?.cname ?? '');

  const [port, setPort] = useState(String(tlsPortOf(existing) ?? 443));

  const http = httpOf(existing);
  const [scheme, setScheme] = useState<HttpCheckConfig['scheme']>(http?.scheme ?? 'https');
  const [path, setPath] = useState(http?.path ?? '/');
  const [method, setMethod] = useState<HttpCheckConfig['method']>(http?.method ?? 'GET');
  const [statusMin, setStatusMin] = useState(String(http?.expectedStatus.min ?? 200));
  const [statusMax, setStatusMax] = useState(String(http?.expectedStatus.max ?? 399));
  const [expectText, setExpectText] = useState(http?.expectText ?? '');

  function changeKind(next: CheckKind): void {
    setKind(next);
    setIntervalSeconds(DEFAULT_INTERVAL[next]);
  }

  function toggleRecordType(type: RecordType): void {
    setRecordTypes((current) => (current.includes(type) ? current.filter((item) => item !== type) : [...current, type]));
  }

  function configOf(): CheckConfig {
    if (kind === 'dns') {
      const addresses = splitList(expectedAddresses);
      const cname = expectedCname.trim();
      const expected = {
        ...(addresses.length === 0 ? {} : { addresses, addressesMode }),
        ...(cname === '' ? {} : { cname })
      };
      return { resolver, recordTypes, ...(Object.keys(expected).length === 0 ? {} : { expected }) };
    }
    if (kind === 'tls') return { port: Number(port) };
    const text = expectText.trim();
    return {
      scheme,
      path: path.trim() === '' ? '/' : path.trim(),
      method,
      expectedStatus: { min: Number(statusMin), max: Number(statusMax) },
      ...(method === 'GET' && text !== '' ? { expectText: text } : {})
    };
  }

  const save = useAction(
    async () => {
      const config = configOf();
      if (existing !== null) return window.steward.cloud.updateCheck({ id: existing.id, intervalSeconds, config });
      // Each kind has its own settings; the union is told which one this is.
      if (kind === 'dns' && 'resolver' in config) {
        return window.steward.cloud.createCheck({ domainId: domain.id, kind, intervalSeconds, enabled: true, config });
      }
      if (kind === 'tls' && 'port' in config) {
        return window.steward.cloud.createCheck({ domainId: domain.id, kind, intervalSeconds, enabled: true, config });
      }
      if (kind === 'http' && 'scheme' in config) {
        return window.steward.cloud.createCheck({ domainId: domain.id, kind, intervalSeconds, enabled: true, config });
      }
      return fail<Check>('VALIDATION_FAILED', 'Those settings do not fit this kind of check.');
    },
    { success: existing === null ? 'Check added' : 'Check saved', errorTarget: 'none' }
  );

  async function onSave(): Promise<void> {
    const saved = await save.run();
    if (saved !== undefined) onSaved(saved);
  }

  const intervals = INTERVAL_PRESETS.includes(intervalSeconds) ? INTERVAL_PRESETS : [...INTERVAL_PRESETS, intervalSeconds].sort((a, b) => a - b);
  const valid = kind !== 'dns' || recordTypes.length > 0;

  return (
    <Modal title={existing === null ? `New check for ${domain.hostname}` : `Edit the ${CHECK_KIND_LABEL[existing.kind]} check`} onClose={onClose}>
      <div className="cdform">
        {existing === null && (
          <Field label="What to check">
            <select className="field__input" value={kind} onChange={(event) => changeKind(event.target.value as CheckKind)}>
              <option value="http">Web page — does it answer, and with what?</option>
              <option value="tls">Certificate — is it valid, and for how long?</option>
              <option value="dns">DNS — what does the name resolve to?</option>
            </select>
          </Field>
        )}

        <Field label="Run every" hint="Checks run only while Steward is open.">
          <select className="field__input" value={intervalSeconds} onChange={(event) => setIntervalSeconds(Number(event.target.value))}>
            {intervals.map((seconds) => (
              <option key={seconds} value={seconds}>
                {formatInterval(seconds)}
              </option>
            ))}
          </select>
        </Field>

        {kind === 'dns' && (
          <>
            <Field label="Resolver">
              <select className="field__input" value={resolver} onChange={(event) => setResolver(event.target.value as DnsCheckConfig['resolver'])}>
                {DNS_RESOLVERS.map((value) => (
                  <option key={value} value={value}>
                    {value === 'system' ? 'This computer’s resolver' : value}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Records to look up">
              <div className="cdtypes">
                {DNS_RECORD_TYPES.map((type) => (
                  <label key={type} className="cdtype">
                    <input type="checkbox" checked={recordTypes.includes(type)} onChange={() => toggleRecordType(type)} />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Expected addresses" hint="Optional. One per line. A different answer is reported as drift.">
              <textarea
                className="field__input cdmono"
                rows={3}
                value={expectedAddresses}
                onChange={(event) => setExpectedAddresses(event.target.value)}
                placeholder="203.0.113.10"
                spellCheck={false}
              />
            </Field>
            {splitList(expectedAddresses).length > 0 && (
              <Field label="How to compare">
                <select className="field__input" value={addressesMode} onChange={(event) => setAddressesMode(event.target.value as 'exact' | 'includes')}>
                  <option value="exact">It must resolve to exactly these</option>
                  <option value="includes">It must include these (others are fine)</option>
                </select>
              </Field>
            )}
            <Field label="Expected CNAME" hint="Optional. Needs the CNAME record type.">
              <input
                className="field__input cdmono"
                value={expectedCname}
                onChange={(event) => setExpectedCname(event.target.value)}
                placeholder="d111111abcdef8.cloudfront.net"
                spellCheck={false}
              />
            </Field>
          </>
        )}

        {kind === 'tls' && (
          <Field label="Port" hint="The usual HTTPS port is 443.">
            <input className="field__input cdmono" type="number" min={1} max={65535} value={port} onChange={(event) => setPort(event.target.value)} />
          </Field>
        )}

        {kind === 'http' && (
          <>
            <div className="cdrow">
              <Field label="Scheme">
                <select className="field__input" value={scheme} onChange={(event) => setScheme(event.target.value as HttpCheckConfig['scheme'])}>
                  <option value="https">https</option>
                  <option value="http">http</option>
                </select>
              </Field>
              <Field label="Method">
                <select className="field__input" value={method} onChange={(event) => setMethod(event.target.value as HttpCheckConfig['method'])}>
                  <option value="GET">GET</option>
                  <option value="HEAD">HEAD (no page, no text search)</option>
                </select>
              </Field>
            </div>
            <Field label="Path" hint={`Requested on ${domain.hostname}. Starts with a slash.`}>
              <input className="field__input cdmono" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/health" spellCheck={false} />
            </Field>
            <div className="cdrow">
              <Field label="Accepted status from">
                <input className="field__input cdmono" type="number" min={100} max={599} value={statusMin} onChange={(event) => setStatusMin(event.target.value)} />
              </Field>
              <Field label="to">
                <input className="field__input cdmono" type="number" min={100} max={599} value={statusMax} onChange={(event) => setStatusMax(event.target.value)} />
              </Field>
            </div>
            <Field label="Text the page must contain" hint="Optional. Searched in the first 64 KB; Steward keeps only whether it was found.">
              <input
                className="field__input"
                value={expectText}
                maxLength={200}
                disabled={method !== 'GET'}
                onChange={(event) => setExpectText(event.target.value)}
              />
            </Field>
          </>
        )}

        {save.error !== null && (
          <div className="banner banner--error" role="alert">
            <span className="banner__message">{save.error.message}</span>
            {save.error.details !== undefined && <span className="banner__details">{save.error.details}</span>}
          </div>
        )}

        <div className="dialog__actions">
          <span className="dpitem__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.pending} loadingLabel="Saving…" disabled={!valid} onClick={() => void onSave()}>
            {existing === null ? 'Add check' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

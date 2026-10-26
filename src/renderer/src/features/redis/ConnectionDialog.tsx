import { useEffect, useState } from 'react';
import type { Environment } from '@shared/schemas/environments';
import type {
  RedisConnection,
  RedisConnectionOptions,
  RedisEndpoint,
  RedisMode,
  RedisPickFileInput,
  RedisSecretInput,
  RedisTestResult
} from '@shared/schemas/redis';
import type { StewardError } from '@shared/types/result';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { Pill } from '../../components/Pill';
import { formatBytes, formatCount } from './redis-meta';

const MODE_LABEL: Record<RedisMode, string> = {
  standalone: 'Standalone',
  sentinel: 'Sentinel',
  cluster: 'Cluster'
};

const DEFAULT_PORT: Record<RedisMode, number> = { standalone: 6379, sentinel: 26379, cluster: 6379 };

/** `host:port` per line (the port is optional) → endpoints, or the line that is wrong. */
function parseEndpoints(text: string, fallbackPort: number): { endpoints: RedisEndpoint[]; bad: string | null } {
  const endpoints: RedisEndpoint[] = [];
  for (const raw of text.split(/[\r\n,]+/)) {
    const line = raw.trim();
    if (line === '') continue;
    const separator = line.lastIndexOf(':');
    const hasPort = separator > 0 && /^\d+$/.test(line.slice(separator + 1));
    const host = hasPort ? line.slice(0, separator) : line;
    const port = hasPort ? Number(line.slice(separator + 1)) : fallbackPort;
    if (host === '' || port < 1 || port > 65535) return { endpoints, bad: line };
    endpoints.push({ host, port });
  }
  return { endpoints, bad: null };
}

function FilePicker({
  label,
  value,
  purpose,
  onChange
}: {
  label: string;
  value: string;
  purpose: RedisPickFileInput['purpose'];
  onChange: (path: string) => void;
}): React.JSX.Element {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="mgfilepick">
        <input className="field__input" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Not set" spellCheck={false} />
        <button
          type="button"
          className="button button--small"
          onClick={() =>
            void window.steward.redis.pickFile({ purpose }).then((result) => {
              if (result.success && !result.data.cancelled && result.data.path !== null) onChange(result.data.path);
            })
          }
        >
          Browse…
        </button>
      </span>
    </label>
  );
}

export function ConnectionDialog({
  projectId,
  existing,
  onClose,
  onSaved
}: {
  projectId: string;
  existing: RedisConnection | null;
  onClose: () => void;
  onSaved: (connection: RedisConnection) => void;
}): React.JSX.Element {
  const options = existing?.options ?? null;
  const first = options?.endpoints[0];
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [name, setName] = useState(existing?.name ?? '');
  const [environmentId, setEnvironmentId] = useState<string>(existing?.environmentId ?? '');
  const [mode, setMode] = useState<RedisMode>(options?.mode ?? 'standalone');
  const [host, setHost] = useState(first?.host ?? 'localhost');
  const [port, setPort] = useState(String(first?.port ?? 6379));
  const [nodes, setNodes] = useState(options !== null && options.mode !== 'standalone' ? options.endpoints.map((e) => `${e.host}:${e.port}`).join('\n') : '');
  const [sentinelMaster, setSentinelMaster] = useState(options?.sentinelMaster ?? 'mymaster');
  const [database, setDatabase] = useState(String(options?.database ?? 0));
  const [username, setUsername] = useState(options?.username ?? '');
  const [password, setPassword] = useState('');
  const [forgetPassword, setForgetPassword] = useState(false);
  const [sentinelPassword, setSentinelPassword] = useState('');
  const [keyDelimiter, setKeyDelimiter] = useState(options?.keyDelimiter ?? ':');
  const [tls, setTls] = useState(options?.tls ?? false);
  const [tlsCAFile, setTlsCAFile] = useState(options?.tlsCAFile ?? '');
  const [tlsCertFile, setTlsCertFile] = useState(options?.tlsCertFile ?? '');
  const [tlsKeyFile, setTlsKeyFile] = useState(options?.tlsKeyFile ?? '');
  const [tlsKeyPassword, setTlsKeyPassword] = useState('');
  const [allowInvalidCerts, setAllowInvalidCerts] = useState(options?.tlsAllowInvalidCertificates ?? false);
  const [readOnlyChoice, setReadOnlyChoice] = useState<boolean | null>(existing?.readOnly ?? null);
  const [allowWrites, setAllowWrites] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<RedisTestResult | null>(null);
  const [problem, setProblem] = useState<StewardError | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.steward.environments.list({ projectId }).then((result) => {
      if (!cancelled && result.success) setEnvironments(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const environment = environments.find((candidate) => candidate.id === environmentId) ?? null;
  const protectedEnvironment = environment?.isProtected === true;
  const readOnly = readOnlyChoice ?? protectedEnvironment;

  /** The options as typed, or the reason they cannot be built yet. */
  function buildOptions(): { options: RedisConnectionOptions } | { error: string } {
    let endpoints: RedisEndpoint[];
    if (mode === 'standalone') {
      const portNumber = Number(port);
      if (host.trim() === '' || !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
        return { error: 'Enter a host and a port between 1 and 65535.' };
      }
      endpoints = [{ host: host.trim(), port: portNumber }];
    } else {
      const parsed = parseEndpoints(nodes, DEFAULT_PORT[mode]);
      if (parsed.bad !== null) return { error: `"${parsed.bad}" is not a host:port address.` };
      if (parsed.endpoints.length === 0) return { error: mode === 'sentinel' ? 'Add at least one Sentinel address.' : 'Add at least one cluster node address.' };
      endpoints = parsed.endpoints;
    }
    if (mode === 'sentinel' && sentinelMaster.trim() === '') return { error: 'Sentinel needs the name of the master.' };
    const databaseNumber = Number(database);
    if (mode !== 'cluster' && (!Number.isInteger(databaseNumber) || databaseNumber < 0 || databaseNumber > 15)) {
      return { error: 'The database is a number from 0 to 15.' };
    }
    return {
      options: {
        mode,
        endpoints,
        ...(mode !== 'cluster' && databaseNumber !== 0 ? { database: databaseNumber } : {}),
        ...(username.trim() === '' ? {} : { username: username.trim() }),
        ...(mode === 'sentinel' ? { sentinelMaster: sentinelMaster.trim() } : {}),
        ...(tls ? { tls: true } : {}),
        ...(tls && tlsCAFile.trim() !== '' ? { tlsCAFile: tlsCAFile.trim() } : {}),
        ...(tls && tlsCertFile.trim() !== '' ? { tlsCertFile: tlsCertFile.trim() } : {}),
        ...(tls && tlsKeyFile.trim() !== '' ? { tlsKeyFile: tlsKeyFile.trim() } : {}),
        ...(tls && allowInvalidCerts ? { tlsAllowInvalidCertificates: true } : {}),
        ...(keyDelimiter !== '' && keyDelimiter !== ':' ? { keyDelimiter } : {})
      }
    };
  }

  const currentSecret = (): RedisSecretInput => ({
    ...(password === '' ? {} : { password }),
    ...(sentinelPassword === '' ? {} : { sentinelPassword }),
    ...(tlsKeyPassword === '' ? {} : { tlsKeyPassword })
  });

  async function test(): Promise<void> {
    const built = buildOptions();
    if ('error' in built) {
      setProblem({ code: 'VALIDATION_FAILED', message: built.error });
      return;
    }
    setBusy(true);
    setProblem(null);
    setTestResult(null);
    const result = await window.steward.redis.testDraft({
      projectId,
      options: built.options,
      secret: currentSecret(),
      ...(existing === null || forgetPassword ? {} : { secretFrom: existing.id })
    });
    setBusy(false);
    if (result.success) setTestResult(result.data);
    else setProblem(result.error);
  }

  async function save(): Promise<void> {
    const built = buildOptions();
    if ('error' in built) {
      setProblem({ code: 'VALIDATION_FAILED', message: built.error });
      return;
    }
    setBusy(true);
    setProblem(null);
    const confirmed = protectedEnvironment && !readOnly ? true : undefined;
    const result =
      existing === null
        ? await window.steward.redis.create({
            projectId,
            environmentId: environmentId === '' ? null : environmentId,
            name,
            options: built.options,
            secret: currentSecret(),
            readOnly,
            ...(confirmed === undefined ? {} : { confirmed })
          })
        : await window.steward.redis.update({
            id: existing.id,
            name,
            environmentId: environmentId === '' ? null : environmentId,
            options: built.options,
            readOnly,
            ...(confirmed === undefined ? {} : { confirmed }),
            secret: {
              ...(forgetPassword ? { password: null } : password === '' ? {} : { password }),
              ...(sentinelPassword === '' ? {} : { sentinelPassword }),
              ...(tlsKeyPassword === '' ? {} : { tlsKeyPassword })
            }
          });
    setBusy(false);
    if (result.success) onSaved(result.data);
    else setProblem(result.error);
  }

  const writesNeedConfirmation = protectedEnvironment && !readOnly && !allowWrites;
  const canSave = name.trim() !== '' && !writesNeedConfirmation && !busy;

  return (
    <Modal title={existing === null ? 'New Redis connection' : `Edit ${existing.name}`} onClose={onClose} className="mgconn">
      <div className="mgconn__body">
        <div className="dprow">
          <label className="field">
            <span className="field__label">Name</span>
            <input className="field__input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Sessions cache" autoFocus />
          </label>
          <label className="field">
            <span className="field__label">Environment</span>
            <select className="field__input" value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}>
              <option value="">None</option>
              {environments.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                  {candidate.isProtected ? ' (protected)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <fieldset className="mgconn__group">
          <div className="segmented" role="group" aria-label="Deployment">
            {(Object.keys(MODE_LABEL) as RedisMode[]).map((value) => (
              <button key={value} type="button" className={`segmented__option${mode === value ? ' segmented__option--active' : ''}`} onClick={() => setMode(value)}>
                {MODE_LABEL[value]}
              </button>
            ))}
          </div>

          {mode === 'standalone' ? (
            <div className="dprow">
              <label className="field">
                <span className="field__label">Host</span>
                <input className="field__input" value={host} onChange={(event) => setHost(event.target.value)} spellCheck={false} />
              </label>
              <label className="field">
                <span className="field__label">Port</span>
                <input className="field__input" value={port} onChange={(event) => setPort(event.target.value)} inputMode="numeric" />
              </label>
            </div>
          ) : (
            <>
              {mode === 'sentinel' && (
                <label className="field">
                  <span className="field__label">Master name</span>
                  <input className="field__input" value={sentinelMaster} onChange={(event) => setSentinelMaster(event.target.value)} spellCheck={false} />
                </label>
              )}
              <label className="field">
                <span className="field__label">{mode === 'sentinel' ? 'Sentinel addresses' : 'Cluster node addresses'} (host:port, one per line)</span>
                <textarea
                  className="field__input dpmono"
                  rows={3}
                  value={nodes}
                  onChange={(event) => setNodes(event.target.value)}
                  placeholder={mode === 'sentinel' ? 'sentinel-1.internal:26379\nsentinel-2.internal:26379' : 'node-1.internal:6379\nnode-2.internal:6379'}
                  spellCheck={false}
                />
                <span className="card__hint">
                  {mode === 'cluster' ? 'One or two nodes are enough: the rest are discovered.' : 'Steward asks the Sentinels where the master is.'}
                </span>
              </label>
            </>
          )}

          <div className="dprow">
            <label className="field">
              <span className="field__label">User (ACL, optional)</span>
              <input className="field__input" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" placeholder="default" />
            </label>
            <label className="field">
              <span className="field__label">Password</span>
              <input
                className="field__input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                placeholder={existing?.hasPassword === true ? 'Leave empty to keep the stored one' : ''}
                disabled={forgetPassword}
              />
            </label>
          </div>
          {existing?.hasPassword === true && (
            <label className="dpcheck">
              <input type="checkbox" checked={forgetPassword} onChange={(event) => setForgetPassword(event.target.checked)} />
              <span>Forget the stored password (this server needs none)</span>
            </label>
          )}
          {mode === 'sentinel' && (
            <label className="field">
              <span className="field__label">Sentinel password (optional)</span>
              <input
                className="field__input"
                type="password"
                value={sentinelPassword}
                onChange={(event) => setSentinelPassword(event.target.value)}
                autoComplete="new-password"
                placeholder={existing?.hasSentinelPassword === true ? 'Leave empty to keep the stored one' : ''}
              />
            </label>
          )}
          {mode !== 'cluster' && (
            <label className="field">
              <span className="field__label">Database (0–15)</span>
              <input className="field__input" value={database} onChange={(event) => setDatabase(event.target.value)} inputMode="numeric" />
            </label>
          )}
        </fieldset>

        <details className="mgconn__more">
          <summary>TLS and key tree</summary>
          <div className="mgconn__group">
            <label className="dpcheck">
              <input type="checkbox" checked={tls} onChange={(event) => setTls(event.target.checked)} />
              <span>Use TLS</span>
            </label>
            {tls && (
              <>
                <FilePicker label="CA certificate file" value={tlsCAFile} purpose="tlsCa" onChange={setTlsCAFile} />
                <FilePicker label="Client certificate file" value={tlsCertFile} purpose="tlsCert" onChange={setTlsCertFile} />
                <FilePicker label="Client key file" value={tlsKeyFile} purpose="tlsKey" onChange={setTlsKeyFile} />
                <label className="field">
                  <span className="field__label">Client key passphrase</span>
                  <input
                    className="field__input"
                    type="password"
                    value={tlsKeyPassword}
                    onChange={(event) => setTlsKeyPassword(event.target.value)}
                    autoComplete="off"
                    placeholder={existing?.hasTlsKeyPassword === true ? 'Leave empty to keep the stored one' : ''}
                  />
                </label>
                <label className="dpcheck">
                  <input type="checkbox" checked={allowInvalidCerts} onChange={(event) => setAllowInvalidCerts(event.target.checked)} />
                  <span>
                    <strong>Accept invalid or self-signed certificates.</strong> Anyone on the network could impersonate the server. Prefer
                    pointing to its CA file.
                  </span>
                </label>
              </>
            )}
            <label className="field">
              <span className="field__label">Folder delimiter in the key tree</span>
              <input className="field__input" value={keyDelimiter} onChange={(event) => setKeyDelimiter(event.target.value.slice(0, 3))} maxLength={3} spellCheck={false} />
            </label>
          </div>
        </details>

        <div className="mgconn__group">
          <label className="dpcheck">
            <input type="checkbox" checked={readOnly} onChange={(event) => setReadOnlyChoice(event.target.checked)} />
            <span>
              <strong>Read-only.</strong> Steward refuses every write on this connection (edit, delete, publish, and console commands that write).
              {protectedEnvironment ? ' Protected environments start read-only.' : ''}
            </span>
          </label>
          {protectedEnvironment && !readOnly && (
            <label className="dpcheck">
              <input type="checkbox" checked={allowWrites} onChange={(event) => setAllowWrites(event.target.checked)} />
              <span>
                <Icon name="alert" size={14} /> I understand that <strong>{environment?.name}</strong> is protected and I allow writes on this
                connection.
              </span>
            </label>
          )}
        </div>

        {testResult !== null && (
          <Pill tone="success" icon="checkCircle">
            Connected · Redis {testResult.serverVersion} · {MODE_LABEL[testResult.mode]} · {testResult.role} · {testResult.latencyMs} ms ·{' '}
            {formatCount(testResult.dbSize)} keys · {formatBytes(testResult.usedMemory)}
          </Pill>
        )}
        {problem !== null && (
          <div className="banner banner--error" role="alert">
            <span className="banner__message">{problem.message}</span>
            {problem.details !== undefined && <span className="banner__details">{problem.details}</span>}
          </div>
        )}

        <div className="dialog__actions">
          <button type="button" className="button" onClick={() => void test()} disabled={busy}>
            {busy ? 'Working…' : 'Test connection'}
          </button>
          <span className="dpitem__spacer" />
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button button--primary" disabled={!canSave} onClick={() => void save()}>
            {existing === null ? 'Save connection' : 'Save changes'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

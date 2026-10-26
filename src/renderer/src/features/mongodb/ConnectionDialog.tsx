import { useEffect, useState } from 'react';
import type { Environment } from '@shared/schemas/environments';
import type {
  MongoConnection,
  MongoConnectionOptions,
  MongoSecretInput,
  MongoTestResult
} from '@shared/schemas/mongodb';
import type { StewardError } from '@shared/types/result';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { toast } from '../../stores/toast.store';

type Mode = 'uri' | 'form';
type AuthMechanism = MongoConnectionOptions['authMechanism'];
type ReadPreference = NonNullable<MongoConnectionOptions['readPreference']> | '';

const AUTH_LABEL: Record<AuthMechanism, string> = {
  default: 'Username / password (default)',
  none: 'None (no authentication)',
  'SCRAM-SHA-256': 'SCRAM-SHA-256',
  'SCRAM-SHA-1': 'SCRAM-SHA-1',
  X509: 'X.509 certificate'
};

function FilePicker({
  label,
  value,
  purpose,
  onChange
}: {
  label: string;
  value: string;
  purpose: 'tlsCa' | 'tlsCertificate';
  onChange: (path: string) => void;
}): React.JSX.Element {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="mgfilepick">
        <input className="field__input" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Not set" spellCheck={false} />
        <Button size="sm" onClick={() =>
            void window.steward.mongo.pickFile({ purpose }).then((result) => {
              if (result.success && !result.data.cancelled && result.data.value !== null) onChange(result.data.value);
            })
          }>
          Browse…
        </Button>
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
  existing: MongoConnection | null;
  onClose: () => void;
  onSaved: (connection: MongoConnection) => void;
}): React.JSX.Element {
  const options = existing?.options ?? null;
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [name, setName] = useState(existing?.name ?? '');
  const [environmentId, setEnvironmentId] = useState<string>(existing?.environmentId ?? '');
  const [mode, setMode] = useState<Mode>('uri');
  const [replaceSecret, setReplaceSecret] = useState(existing === null);
  const [uri, setUri] = useState('');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('27017');
  const [srv, setSrv] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('');
  const [authSource, setAuthSource] = useState(options?.authSource ?? '');
  const [authMechanism, setAuthMechanism] = useState<AuthMechanism>(options?.authMechanism ?? 'default');
  const [replicaSet, setReplicaSet] = useState(options?.replicaSet ?? '');
  const [readPreference, setReadPreference] = useState<ReadPreference>(options?.readPreference ?? '');
  const [directConnection, setDirectConnection] = useState(options?.directConnection ?? false);
  const [tls, setTls] = useState(options?.tls ?? false);
  const [tlsCAFile, setTlsCAFile] = useState(options?.tlsCAFile ?? '');
  const [tlsCertificateKeyFile, setTlsCertificateKeyFile] = useState(options?.tlsCertificateKeyFile ?? '');
  const [tlsKeyPassword, setTlsKeyPassword] = useState('');
  const [allowInvalidCerts, setAllowInvalidCerts] = useState(options?.tlsAllowInvalidCertificates ?? false);
  const [readOnlyChoice, setReadOnlyChoice] = useState<boolean | null>(existing?.readOnly ?? null);
  const [allowWrites, setAllowWrites] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<MongoTestResult | null>(null);
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

  const currentOptions = (): MongoConnectionOptions => ({
    authMechanism,
    ...(authSource.trim() === '' ? {} : { authSource: authSource.trim() }),
    ...(replicaSet.trim() === '' ? {} : { replicaSet: replicaSet.trim() }),
    ...(readPreference === '' ? {} : { readPreference }),
    ...(directConnection ? { directConnection: true } : {}),
    ...(tls ? { tls: true } : {}),
    ...(tlsCAFile.trim() === '' ? {} : { tlsCAFile: tlsCAFile.trim() }),
    ...(tlsCertificateKeyFile.trim() === '' ? {} : { tlsCertificateKeyFile: tlsCertificateKeyFile.trim() }),
    ...(allowInvalidCerts ? { tlsAllowInvalidCertificates: true } : {})
  });

  const currentSecret = (): MongoSecretInput =>
    mode === 'uri'
      ? { kind: 'uri', uri }
      : {
          kind: 'form',
          host,
          ...(srv || port.trim() === '' ? {} : { port: Number(port) }),
          ...(username === '' ? {} : { username }),
          ...(password === '' ? {} : { password }),
          ...(srv ? { srv: true } : {}),
          ...(database.trim() === '' ? {} : { database: database.trim() })
        };

  async function test(): Promise<void> {
    setBusy(true);
    setTesting(true);
    setProblem(null);
    setTestResult(null);
    const result =
      existing !== null && !replaceSecret
        ? await window.steward.mongo.test({ id: existing.id })
        : await window.steward.mongo.testDraft({
            projectId,
            secret: currentSecret(),
            ...(tlsKeyPassword === '' ? {} : { tlsKeyPassword }),
            options: currentOptions()
          });
    setBusy(false);
    setTesting(false);
    if (result.success) setTestResult(result.data);
    else setProblem(result.error);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setProblem(null);
    const confirmed = protectedEnvironment && !readOnly ? true : undefined;
    const result =
      existing === null
        ? await window.steward.mongo.create({
            projectId,
            environmentId: environmentId === '' ? null : environmentId,
            name,
            secret: currentSecret(),
            ...(tlsKeyPassword === '' ? {} : { tlsKeyPassword }),
            options: currentOptions(),
            readOnly,
            ...(confirmed === undefined ? {} : { confirmed })
          })
        : await window.steward.mongo.update({
            id: existing.id,
            name,
            environmentId: environmentId === '' ? null : environmentId,
            options: currentOptions(),
            readOnly,
            ...(confirmed === undefined ? {} : { confirmed }),
            ...(replaceSecret ? { secret: currentSecret() } : {}),
            ...(tlsKeyPassword === '' ? {} : { tlsKeyPassword })
          });
    setBusy(false);
    if (result.success) {
      toast.success(existing === null ? 'Connection added' : 'Connection saved');
      onSaved(result.data);
    }
    else setProblem(result.error);
  }

  const secretReady = !replaceSecret || (mode === 'uri' ? uri.trim() !== '' : host.trim() !== '');
  const writesNeedConfirmation = protectedEnvironment && !readOnly && !allowWrites;
  const canSave = name.trim() !== '' && secretReady && !writesNeedConfirmation && !busy;

  return (
    <Modal title={existing === null ? 'New MongoDB connection' : `Edit ${existing.name}`} onClose={onClose} className="mgconn">
      <div className="mgconn__body">
        <div className="dprow">
          <label className="field">
            <span className="field__label">Name</span>
            <input className="field__input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Production cluster" autoFocus />
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

        {existing !== null && (
          <label className="dpcheck">
            <input type="checkbox" checked={replaceSecret} onChange={(event) => setReplaceSecret(event.target.checked)} />
            <span>
              Replace the stored URI and credentials. They are kept encrypted and are never shown again
              {existing.hostDisplay !== '' ? ` (now: ${existing.hostDisplay})` : ''}.
            </span>
          </label>
        )}

        {replaceSecret && (
          <fieldset className="mgconn__group">
            <div className="segmented" role="group" aria-label="How to connect">
              {(['uri', 'form'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`segmented__option${mode === value ? ' segmented__option--active' : ''}`}
                  onClick={() => setMode(value)}
                >
                  {value === 'uri' ? 'Connection string' : 'Fill in fields'}
                </button>
              ))}
            </div>

            {mode === 'uri' ? (
              <label className="field">
                <span className="field__label">URI</span>
                <input
                  className="field__input dpmono"
                  type="password"
                  value={uri}
                  onChange={(event) => setUri(event.target.value)}
                  placeholder="mongodb://user:password@host:27017/?authSource=admin   or   mongodb+srv://…"
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="card__hint">Works for Atlas (mongodb+srv), replica sets, IPs and internal hosts. It may contain a password, so it is hidden.</span>
              </label>
            ) : (
              <>
                <div className="dprow">
                  <label className="field">
                    <span className="field__label">Host</span>
                    <input className="field__input" value={host} onChange={(event) => setHost(event.target.value)} spellCheck={false} />
                  </label>
                  <label className="field">
                    <span className="field__label">Port</span>
                    <input className="field__input" value={port} onChange={(event) => setPort(event.target.value)} disabled={srv} inputMode="numeric" />
                  </label>
                </div>
                <label className="dpcheck">
                  <input type="checkbox" checked={srv} onChange={(event) => setSrv(event.target.checked)} />
                  <span>DNS seed list (mongodb+srv, as Atlas gives it)</span>
                </label>
                <div className="dprow">
                  <label className="field">
                    <span className="field__label">User (optional)</span>
                    <input className="field__input" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" />
                  </label>
                  <label className="field">
                    <span className="field__label">Password</span>
                    <input className="field__input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
                  </label>
                </div>
                <label className="field">
                  <span className="field__label">Default database (optional)</span>
                  <input className="field__input" value={database} onChange={(event) => setDatabase(event.target.value)} />
                </label>
              </>
            )}
          </fieldset>
        )}

        <details className="mgconn__more">
          <summary>Authentication, replica set and TLS</summary>
          <div className="mgconn__group">
            <div className="dprow">
              <label className="field">
                <span className="field__label">Authentication</span>
                <select className="field__input" value={authMechanism} onChange={(event) => setAuthMechanism(event.target.value as AuthMechanism)}>
                  {(Object.keys(AUTH_LABEL) as AuthMechanism[]).map((value) => (
                    <option key={value} value={value}>
                      {AUTH_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Authentication database</span>
                <input className="field__input" value={authSource} onChange={(event) => setAuthSource(event.target.value)} placeholder="admin" />
              </label>
            </div>
            <div className="dprow">
              <label className="field">
                <span className="field__label">Replica set</span>
                <input className="field__input" value={replicaSet} onChange={(event) => setReplicaSet(event.target.value)} />
              </label>
              <label className="field">
                <span className="field__label">Read preference</span>
                <select className="field__input" value={readPreference} onChange={(event) => setReadPreference(event.target.value as ReadPreference)}>
                  <option value="">Default</option>
                  {['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'].map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="dpcheck">
              <input type="checkbox" checked={directConnection} onChange={(event) => setDirectConnection(event.target.checked)} />
              <span>Direct connection (talk to this one server, do not discover the replica set)</span>
            </label>
            <label className="dpcheck">
              <input type="checkbox" checked={tls} onChange={(event) => setTls(event.target.checked)} />
              <span>Use TLS</span>
            </label>
            {(tls || tlsCAFile !== '' || tlsCertificateKeyFile !== '') && (
              <>
                <FilePicker label="CA certificate file" value={tlsCAFile} purpose="tlsCa" onChange={setTlsCAFile} />
                <FilePicker label="Client certificate / key file" value={tlsCertificateKeyFile} purpose="tlsCertificate" onChange={setTlsCertificateKeyFile} />
                <label className="field">
                  <span className="field__label">Client key passphrase</span>
                  <input className="field__input" type="password" value={tlsKeyPassword} onChange={(event) => setTlsKeyPassword(event.target.value)} autoComplete="off" placeholder={existing === null ? '' : 'Leave empty to keep the stored one'} />
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
          </div>
        </details>

        <div className="mgconn__group">
          <label className="dpcheck">
            <input type="checkbox" checked={readOnly} onChange={(event) => setReadOnlyChoice(event.target.checked)} />
            <span>
              <strong>Read-only.</strong> Steward refuses every write on this connection (insert, edit, delete, drop, indexes, import).
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
          <Badge tone="success" icon="checkCircle">
            Connected · MongoDB {testResult.serverVersion} · {testResult.latencyMs} ms · {testResult.topology}
          </Badge>
        )}
        {problem !== null && (
          <div className="banner banner--error" role="alert">
            <span className="banner__message">{problem.message}</span>
            {problem.details !== undefined && <span className="banner__details">{problem.details}</span>}
          </div>
        )}

        <div className="dialog__actions">
          <Button loading={testing} loadingLabel="Testing…" disabled={!secretReady} onClick={() => void test()}>Test connection</Button>
          <span className="dpitem__spacer" />
          <Button onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
            {existing === null ? 'Save connection' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

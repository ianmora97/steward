import { useEffect, useState } from 'react';
import type { Environment } from '@shared/schemas/environments';
import type {
  ObservabilityAuthKind,
  ObservabilityDatasource,
  ObservabilityKind,
  ObservabilitySource,
  ObservabilitySourceConfig,
  ObservabilitySourceStatus
} from '@shared/schemas/observability';
import { fail, type StewardError } from '@shared/types/result';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { useAction } from '../../components/useAction';
import { useMonitoringStore } from '../../stores/monitoring.store';
import { AVAILABLE_KINDS, KIND_LABEL, connectionBadge, formatLatency, operationalBadge } from './monitoring-meta';

const AUTH_LABEL: Record<ObservabilityAuthKind, string> = {
  none: 'No authentication',
  bearer: 'Token',
  basic: 'User and password'
};

const URL_PLACEHOLDER: Record<ObservabilityKind, string> = {
  grafana: 'https://grafana.example.com',
  loki: 'https://loki.example.com:3100',
  prometheus: 'https://prometheus.example.com:9090',
  sentry: 'https://sentry.io'
};

const TOKEN_HINT: Record<ObservabilityKind, string> = {
  grafana: 'Create a service account with the Viewer role (Administration → Users and access → Service accounts) and paste its token. Steward only reads.',
  loki: 'The token or password this Loki expects.',
  prometheus: 'The token or password this Prometheus expects.',
  sentry: 'A token with the scopes project:read, event:read and org:read.'
};

/** The datasource types a source of each tool can be queried through. */
const DATASOURCE_TYPE: Partial<Record<ObservabilityKind, string>> = { prometheus: 'prometheus', loki: 'loki' };

export function SourceDialog({
  projectId,
  existing,
  onClose,
  onSaved
}: {
  projectId: string;
  existing: ObservabilitySource | null;
  onClose: () => void;
  onSaved: (source: ObservabilitySource) => void;
}): React.JSX.Element {
  const projectSources = useMonitoringStore((state) => state.sources[projectId]);
  const grafanas = (projectSources ?? []).filter((source) => source.kind === 'grafana');

  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [kind, setKind] = useState<ObservabilityKind>(existing?.kind ?? AVAILABLE_KINDS[0] ?? 'grafana');
  const [name, setName] = useState(existing?.name ?? '');
  const [environmentId, setEnvironmentId] = useState(existing?.environmentId ?? '');
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '');
  const [authKind, setAuthKind] = useState<ObservabilityAuthKind>(existing?.config.authKind ?? 'bearer');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [caFile, setCaFile] = useState(existing?.config.caFile ?? '');
  const [insecure, setInsecure] = useState(existing?.allowInsecureTls ?? false);
  const [insecureConfirmed, setInsecureConfirmed] = useState(false);
  const [organization, setOrganization] = useState(existing?.config.organization ?? '');
  const [project, setProject] = useState(existing?.config.project ?? '');
  const [via, setVia] = useState(existing?.config.viaSourceId !== undefined);
  const [viaSourceId, setViaSourceId] = useState(existing?.config.viaSourceId ?? grafanas[0]?.id ?? '');
  const [datasourceUid, setDatasourceUid] = useState(existing?.config.datasourceUid ?? '');
  // Tagged with the Grafana it came from, so a switch never shows the previous Grafana's datasources.
  const [datasourceResult, setDatasourceResult] = useState<{
    sourceId: string;
    data: ObservabilityDatasource[];
    error: StewardError | null;
  } | null>(null);
  const [testResult, setTestResult] = useState<ObservabilitySourceStatus | null>(null);
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

  const canVia = DATASOURCE_TYPE[kind] !== undefined && grafanas.length > 0;
  const throughGrafana = via && canVia;
  const viaGrafana = grafanas.find((candidate) => candidate.id === viaSourceId) ?? null;

  const viaGrafanaId = viaGrafana?.id ?? null;

  // The datasources of the chosen Grafana, so the user picks one instead of typing a UID.
  useEffect(() => {
    if (!throughGrafana || viaGrafanaId === null) return;
    let cancelled = false;
    void window.steward.observability.grafanaDatasources({ sourceId: viaGrafanaId }).then((result) => {
      if (cancelled) return;
      setDatasourceResult(
        result.success ? { sourceId: viaGrafanaId, data: result.data, error: null } : { sourceId: viaGrafanaId, data: [], error: result.error }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [throughGrafana, viaGrafanaId]);

  const datasources = datasourceResult !== null && datasourceResult.sourceId === viaGrafanaId ? datasourceResult.data : null;
  const datasourcesError = datasourceResult !== null && datasourceResult.sourceId === viaGrafanaId ? datasourceResult.error : null;
  const wantedType = DATASOURCE_TYPE[kind];
  const matching = (datasources ?? []).filter((datasource) => wantedType === undefined || datasource.type === wantedType);
  const newlyInsecure = !throughGrafana && insecure && existing?.allowInsecureTls !== true;
  const effectiveBaseUrl = throughGrafana ? (viaGrafana?.baseUrl ?? '') : baseUrl.trim();

  function chooseKind(next: ObservabilityKind): void {
    setKind(next);
    setAuthKind(next === 'grafana' || next === 'sentry' ? 'bearer' : 'none');
    if (next === 'sentry' && baseUrl.trim() === '') setBaseUrl('https://sentry.io');
    setDatasourceUid('');
  }

  /** Everything about the source that is not secret; settings the dialog does not edit are kept as they were. */
  function buildConfig(): ObservabilitySourceConfig {
    const { caFile: _ca, viaSourceId: _via, datasourceUid: _uid, organization: _org, project: _project, ...kept } = existing?.config ?? { authKind };
    const sentry = kind === 'sentry' ? { organization: organization.trim(), project: project.trim() } : {};
    if (throughGrafana) return { ...kept, authKind: 'none', viaSourceId, datasourceUid };
    return { ...kept, ...sentry, authKind, ...(caFile.trim() === '' ? {} : { caFile: caFile.trim() }) };
  }

  const effectiveAuth: ObservabilityAuthKind = throughGrafana ? 'none' : authKind;

  function secretForCreate(): { token?: string; username?: string; password?: string } {
    if (effectiveAuth === 'bearer') return { token };
    if (effectiveAuth === 'basic') return { username, password };
    return {};
  }

  function secretForUpdate(): { token?: string; username?: string; password?: string } {
    // Empty fields keep what is stored; only what is typed replaces it.
    return {
      ...(effectiveAuth === 'bearer' && token !== '' ? { token } : {}),
      ...(effectiveAuth === 'basic' && username !== '' ? { username } : {}),
      ...(effectiveAuth === 'basic' && password !== '' ? { password } : {})
    };
  }

  /** Why the form cannot be sent yet, in words for the user. */
  function missing(): string | null {
    if (name.trim() === '') return 'Give the source a name.';
    if (throughGrafana) {
      if (viaGrafana === null) return 'Choose the Grafana to query through.';
      if (datasourceUid === '') return 'Choose the datasource in Grafana.';
      return null;
    }
    if (baseUrl.trim() === '') return 'Enter the address of the server.';
    if (kind === 'sentry' && (organization.trim() === '' || project.trim() === '')) return 'Enter the organization and the project of Sentry.';
    return null;
  }

  const save = useAction(
    async () => {
      const reason = missing();
      if (reason !== null) return fail<ObservabilitySource>('VALIDATION_FAILED', reason);
      const common = {
        name: name.trim(),
        baseUrl: effectiveBaseUrl,
        config: buildConfig(),
        allowInsecureTls: throughGrafana ? false : insecure,
        ...(newlyInsecure ? { confirmed: true } : {})
      };
      return existing === null
        ? window.steward.observability.createSource({
            projectId,
            kind,
            environmentId: environmentId === '' ? null : environmentId,
            secret: secretForCreate(),
            ...common
          })
        : window.steward.observability.updateSource({
            id: existing.id,
            environmentId: environmentId === '' ? null : environmentId,
            secret: secretForUpdate(),
            ...common
          });
    },
    { success: existing === null ? 'Source added' : 'Source saved', errorTarget: 'none' }
  );

  const test = useAction(
    async () => {
      const reason = missing();
      if (reason !== null) return fail<ObservabilitySourceStatus>('VALIDATION_FAILED', reason);
      return window.steward.observability.testDraft({
        projectId,
        kind,
        baseUrl: effectiveBaseUrl,
        config: buildConfig(),
        allowInsecureTls: throughGrafana ? false : insecure,
        ...(newlyInsecure ? { confirmed: true } : {}),
        secret: secretForCreate(),
        ...(existing === null ? {} : { secretFrom: existing.id })
      });
    },
    { errorTarget: 'none' }
  );

  async function onSave(): Promise<void> {
    setProblem(null);
    const saved = await save.run();
    if (saved !== undefined) onSaved(saved);
  }

  async function onTest(): Promise<void> {
    setProblem(null);
    setTestResult(null);
    const result = await test.run();
    if (result !== undefined) setTestResult(result);
  }

  function pickCa(): void {
    void window.steward.observability.pickFile({ purpose: 'ca' }).then((result) => {
      if (result.success && !result.data.cancelled && result.data.path !== null) setCaFile(result.data.path);
    });
  }

  const shownProblem = problem ?? save.error ?? test.error;
  const insecureBlocks = newlyInsecure && !insecureConfirmed;
  const canSave = name.trim() !== '' && !insecureBlocks && !save.pending;
  const connection = testResult === null ? null : connectionBadge(testResult.connection.state);
  const operational = testResult === null ? null : operationalBadge(testResult.operational.state);

  return (
    <Modal title={existing === null ? 'New source' : `Edit ${existing.name}`} onClose={onClose} className="mgconn">
      <div className="mgconn__body">
        {existing === null && AVAILABLE_KINDS.length > 1 && (
          <div className="segmented" role="group" aria-label="Tool">
            {AVAILABLE_KINDS.map((value) => (
              <button
                key={value}
                type="button"
                className={`segmented__option${kind === value ? ' segmented__option--active' : ''}`}
                onClick={() => chooseKind(value)}
              >
                {KIND_LABEL[value]}
              </button>
            ))}
          </div>
        )}

        <div className="mnrow">
          <Field label="Name" required>
            <input className="field__input" value={name} onChange={(event) => setName(event.target.value)} placeholder={`${KIND_LABEL[kind]} production`} autoFocus />
          </Field>
          <Field label="Environment">
            <select className="field__input" value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}>
              <option value="">None</option>
              {environments.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {canVia && (
          <div className="segmented" role="group" aria-label="How to reach it">
            <button type="button" className={`segmented__option${!via ? ' segmented__option--active' : ''}`} onClick={() => setVia(false)}>
              Direct
            </button>
            <button type="button" className={`segmented__option${via ? ' segmented__option--active' : ''}`} onClick={() => setVia(true)}>
              Through Grafana
            </button>
          </div>
        )}

        {throughGrafana ? (
          <div className="mnrow">
            <Field label="Grafana" required>
              <select className="field__input" value={viaSourceId} onChange={(event) => setViaSourceId(event.target.value)}>
                {grafanas.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Datasource"
              required
              {...(datasourcesError !== null
                ? { error: datasourcesError.message }
                : datasources !== null && matching.length === 0
                  ? { error: `This Grafana has no ${KIND_LABEL[kind]} datasource the token can see.` }
                  : { hint: 'The token of the Grafana source is used, so this one needs none.' })}
            >
              <select className="field__input" value={datasourceUid} onChange={(event) => setDatasourceUid(event.target.value)} disabled={datasources === null}>
                <option value="">{datasources === null ? 'Loading…' : 'Choose…'}</option>
                {matching.map((candidate) => (
                  <option key={candidate.uid} value={candidate.uid}>
                    {candidate.name}
                    {candidate.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : (
          <>
            <Field label="Address" required hint="Include the path if the server lives under one, such as https://example.com/grafana.">
              <input
                className="field__input"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={URL_PLACEHOLDER[kind]}
                spellCheck={false}
                inputMode="url"
              />
            </Field>

            {kind === 'sentry' && (
              <div className="mnrow">
                <Field label="Organization" required hint="The name in your Sentry address.">
                  <input className="field__input mnmono" value={organization} onChange={(event) => setOrganization(event.target.value)} placeholder="acme" spellCheck={false} />
                </Field>
                <Field label="Project" required hint="The project slug.">
                  <input className="field__input mnmono" value={project} onChange={(event) => setProject(event.target.value)} placeholder="api" spellCheck={false} />
                </Field>
              </div>
            )}

            <div className="mgconn__group">
              <div className="segmented" role="group" aria-label="Authentication">
                {(Object.keys(AUTH_LABEL) as ObservabilityAuthKind[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`segmented__option${authKind === value ? ' segmented__option--active' : ''}`}
                    onClick={() => setAuthKind(value)}
                  >
                    {AUTH_LABEL[value]}
                  </button>
                ))}
              </div>
              {authKind === 'bearer' && (
                <Field label="Token" hint={TOKEN_HINT[kind]}>
                  <input
                    className="field__input"
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    autoComplete="off"
                    placeholder={existing?.hasToken === true ? 'Saved. Leave empty to keep it' : ''}
                  />
                </Field>
              )}
              {authKind === 'basic' && (
                <div className="mnrow">
                  <Field label="User">
                    <input
                      className="field__input"
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete="off"
                      placeholder={existing?.hasUsername === true ? 'Saved. Leave empty to keep it' : ''}
                    />
                  </Field>
                  <Field label="Password">
                    <input
                      className="field__input"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder={existing?.hasPassword === true ? 'Saved. Leave empty to keep it' : ''}
                    />
                  </Field>
                </div>
              )}
            </div>

            <details className="mgconn__more" open={caFile !== '' || insecure}>
              <summary>Certificates</summary>
              <div className="mgconn__group">
                <Field label="CA certificate file" hint="For a server with a private certificate authority. Preferred over skipping the checks.">
                  <span className="mgfilepick">
                    <input className="field__input" value={caFile} onChange={(event) => setCaFile(event.target.value)} placeholder="Not set" spellCheck={false} />
                    <Button size="sm" onClick={pickCa}>
                      Browse…
                    </Button>
                  </span>
                </Field>
                <label className="dpcheck">
                  <input type="checkbox" checked={insecure} onChange={(event) => setInsecure(event.target.checked)} />
                  <span>
                    <strong>Do not verify the server&apos;s certificate.</strong> Anyone on the network could impersonate it. The source keeps a
                    warning while this is on.
                  </span>
                </label>
                {newlyInsecure && (
                  <label className="dpcheck">
                    <input type="checkbox" checked={insecureConfirmed} onChange={(event) => setInsecureConfirmed(event.target.checked)} />
                    <span>
                      <Icon name="alert" size={14} /> I understand the risk and accept any certificate for this source.
                    </span>
                  </label>
                )}
              </div>
            </details>
          </>
        )}

        {testResult !== null && connection !== null && operational !== null && (
          <div className="mnresult">
            <Badge tone={connection.tone} icon={connection.icon}>
              {connection.label}
            </Badge>
            {testResult.connection.state === 'connected' ? (
              <>
                <span className="mnresult__text">
                  {[testResult.connection.version === null ? null : `v${testResult.connection.version}`, testResult.connection.identity, formatLatency(testResult.connection.latencyMs)]
                    .filter((part) => part !== null)
                    .join(' · ')}
                </span>
                <Badge tone={operational.tone} icon={operational.icon} title={testResult.operational.reasons.join('\n') || undefined}>
                  {operational.label}
                </Badge>
              </>
            ) : (
              <span className="mnresult__text">{testResult.connection.message}</span>
            )}
          </div>
        )}
        {shownProblem !== null && (
          <div className="banner banner--error" role="alert">
            <span className="banner__message">{shownProblem.message}</span>
            {shownProblem.details !== undefined && <span className="banner__details">{shownProblem.details}</span>}
          </div>
        )}

        <div className="dialog__actions">
          <Button loading={test.pending} loadingLabel="Testing…" onClick={() => void onTest()}>
            Test connection
          </Button>
          <span className="dpitem__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canSave} loading={save.pending} loadingLabel="Saving…" onClick={() => void onSave()}>
            {existing === null ? 'Save source' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

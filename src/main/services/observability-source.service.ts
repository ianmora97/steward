import type {
  ConnectionCheck,
  ObservabilitySecretInput,
  ObservabilitySecretPatch,
  ObservabilitySource,
  ObservabilitySourceConfig,
  ObservabilitySourceCreateInput,
  ObservabilitySourceDraftInput,
  ObservabilitySourceIdInput,
  ObservabilitySourceListInput,
  ObservabilitySourceStatus,
  ObservabilitySourceUpdateInput,
  OperationalCheck
} from '@shared/schemas/observability';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { findEnvironmentById } from '../db/environment.repo';
import { nowIso, uuidv7 } from '../db/id';
import {
  deleteSource,
  findSource,
  findSourceByName,
  insertSource,
  listSourceIds,
  listSourcesByProject,
  listSourcesVia,
  updateSource,
  type ObservabilitySourceRecord
} from '../db/observability.repo';
import { validateExistingFile } from '../security/paths';
import type { SecretStore } from '../security/secret-store';
import { translateObservabilityError } from './observability-errors';
import {
  parseObservabilitySecret,
  type ObservabilitySecret,
  type ProviderRegistry,
  type ResolvedSource
} from './observability-provider';
import { requireProject } from './project.service';

export interface ObservabilitySourceDeps {
  db: SqlDatabase;
  secrets: SecretStore;
  registry: ProviderRegistry;
}

const UNCHECKED: ObservabilitySourceStatus = {
  connection: { state: 'unchecked', version: null, identity: null, latencyMs: null, message: null },
  operational: { state: 'unknown', reasons: [] },
  checkedAt: null
};

function secretOf(input: ObservabilitySecretInput): ObservabilitySecret {
  const secret: ObservabilitySecret = {};
  if (input.token !== undefined && input.token !== '') secret.token = input.token;
  if (input.username !== undefined && input.username !== '') secret.username = input.username;
  if (input.password !== undefined && input.password !== '') secret.password = input.password;
  return secret;
}

function applyPatch(previous: ObservabilitySecret, patch: ObservabilitySecretPatch): ObservabilitySecret {
  const next: ObservabilitySecret = { ...previous };
  for (const field of ['token', 'username', 'password'] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    if (value === null || value === '') delete next[field];
    else next[field] = value;
  }
  return next;
}

function assertSecretMatches(config: ObservabilitySourceConfig, secret: ObservabilitySecret): void {
  if (config.authKind === 'bearer' && secret.token === undefined) {
    throw new StewardServiceError('VALIDATION_FAILED', 'A token is required', 'Paste the token, or choose "No authentication".');
  }
  if (config.authKind === 'basic' && (secret.username === undefined || secret.password === undefined)) {
    throw new StewardServiceError('VALIDATION_FAILED', 'A user name and a password are required');
  }
}

/** Failures of the check itself are an answer ("auth_error", "unreachable"), not an error of the app. */
function connectionFromError(error: unknown, kind: ObservabilitySourceRecord['kind']): ConnectionCheck {
  const translated = translateObservabilityError(error, kind);
  const state = translated.code === 'OBS_AUTH_FAILED' || translated.code === 'OBS_FORBIDDEN' ? 'auth_error' : 'unreachable';
  const message = translated.details === undefined ? translated.message : `${translated.message}. ${translated.details}`;
  return { state, version: null, identity: null, latencyMs: null, message };
}

export function createObservabilitySourceService(deps: ObservabilitySourceDeps) {
  const { db, secrets, registry } = deps;
  const statuses = new Map<string, { status: ObservabilitySourceStatus; at: number }>();

  function requireRecord(id: string): ObservabilitySourceRecord {
    const record = findSource(db, id);
    if (record === null) throw new StewardServiceError('NOT_FOUND', 'that source no longer exists');
    return record;
  }

  function environmentName(projectId: string, environmentId: string | null): string | null {
    if (environmentId === null) return null;
    const environment = findEnvironmentById(db, environmentId);
    if (environment === null || environment.projectId !== projectId) {
      throw new StewardServiceError('NOT_FOUND', 'that environment no longer exists');
    }
    return environment.name;
  }

  function resolve(record: ObservabilitySourceRecord): ResolvedSource {
    const via = record.config.viaSourceId === undefined ? null : findSource(db, record.config.viaSourceId);
    return {
      id: record.id,
      projectId: record.projectId,
      environmentId: record.environmentId,
      kind: record.kind,
      name: record.name,
      baseUrl: record.baseUrl,
      config: record.config,
      allowInsecureTls: record.allowInsecureTls,
      secret: parseObservabilitySecret(secrets.load(record.id)) ?? {},
      ...(via === null ? {} : { via: resolve(via) })
    };
  }

  function toView(record: ObservabilitySourceRecord): ObservabilitySource {
    const secret = parseObservabilitySecret(secrets.load(record.id)) ?? {};
    return {
      id: record.id,
      projectId: record.projectId,
      environmentId: record.environmentId,
      environmentName: environmentName(record.projectId, record.environmentId),
      kind: record.kind,
      name: record.name,
      baseUrl: record.baseUrl,
      config: record.config,
      allowInsecureTls: record.allowInsecureTls,
      hasToken: (secret.token ?? '') !== '',
      hasPassword: (secret.password ?? '') !== '',
      hasUsername: (secret.username ?? '') !== '',
      capabilities: [...registry.capabilitiesOf(record.kind)],
      status: statuses.get(record.id)?.status ?? UNCHECKED,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  /** A Loki or Prometheus reached through Grafana must name a Grafana source of the same project and a datasource. */
  function assertConfigConsistent(
    projectId: string,
    kind: ObservabilitySourceRecord['kind'],
    config: ObservabilitySourceConfig,
    selfId: string | null
  ): void {
    if (config.viaSourceId !== undefined) {
      if (kind !== 'loki' && kind !== 'prometheus') {
        throw new StewardServiceError('VALIDATION_FAILED', 'Only Loki and Prometheus can be queried through Grafana');
      }
      const via = findSource(db, config.viaSourceId);
      if (via === null || via.projectId !== projectId || via.kind !== 'grafana' || via.id === selfId) {
        throw new StewardServiceError('VALIDATION_FAILED', 'The Grafana source chosen for this one does not exist in this project');
      }
      if (config.datasourceUid === undefined) {
        throw new StewardServiceError('VALIDATION_FAILED', 'Choose the Grafana datasource to query');
      }
    }
    if (kind === 'sentry' && (config.organization === undefined || config.project === undefined)) {
      throw new StewardServiceError('VALIDATION_FAILED', 'Sentry needs the organization and the project slugs');
    }
    if (config.caFile !== undefined) validateExistingFile(config.caFile);
  }

  function assertNameFree(projectId: string, name: string, exceptId: string | null): void {
    const clash = findSourceByName(db, projectId, name);
    if (clash !== null && clash.id !== exceptId) {
      throw new StewardServiceError('CONFLICT', 'a source with that name already exists in this project');
    }
  }

  /** Skipping certificate checks is a decision, not a default: turning it on needs an explicit confirmation. */
  function assertInsecureConfirmed(wanted: boolean, already: boolean, confirmed: boolean | undefined): void {
    if (wanted && !already && confirmed !== true) {
      throw new StewardServiceError(
        'CONFIRMATION_REQUIRED',
        'Skipping certificate checks makes this connection easy to spy on',
        'Confirm that you want to accept any certificate for this source.'
      );
    }
  }

  function list(input: ObservabilitySourceListInput): ObservabilitySource[] {
    requireProject(db, input.projectId);
    return listSourcesByProject(db, input.projectId).map(toView);
  }

  function create(input: ObservabilitySourceCreateInput): ObservabilitySource {
    requireProject(db, input.projectId);
    environmentName(input.projectId, input.environmentId);
    assertNameFree(input.projectId, input.name, null);
    assertConfigConsistent(input.projectId, input.kind, input.config, null);
    assertInsecureConfirmed(input.allowInsecureTls, false, input.confirmed);
    const secret = secretOf(input.secret);
    assertSecretMatches(input.config, secret);

    const id = uuidv7();
    const now = nowIso();
    // The secret goes first: with no way to encrypt it nothing is stored, and a failed insert removes it again.
    if (input.config.authKind !== 'none') secrets.save(id, JSON.stringify(secret));
    try {
      const record: ObservabilitySourceRecord = {
        id,
        projectId: input.projectId,
        environmentId: input.environmentId,
        kind: input.kind,
        name: input.name,
        baseUrl: input.baseUrl,
        config: input.config,
        allowInsecureTls: input.allowInsecureTls,
        createdAt: now,
        updatedAt: now
      };
      insertSource(db, record);
      return toView(record);
    } catch (error) {
      secrets.remove(id);
      throw error;
    }
  }

  function update(input: ObservabilitySourceUpdateInput): ObservabilitySource {
    const record = requireRecord(input.id);
    const environmentId = input.environmentId === undefined ? record.environmentId : input.environmentId;
    environmentName(record.projectId, environmentId);
    const name = input.name ?? record.name;
    assertNameFree(record.projectId, name, record.id);
    const config = input.config ?? record.config;
    assertConfigConsistent(record.projectId, record.kind, config, record.id);
    const allowInsecureTls = input.allowInsecureTls ?? record.allowInsecureTls;
    assertInsecureConfirmed(allowInsecureTls, record.allowInsecureTls, input.confirmed);

    const previous = parseObservabilitySecret(secrets.load(record.id)) ?? {};
    const secret = input.secret === undefined ? previous : applyPatch(previous, input.secret);
    assertSecretMatches(config, secret);
    if (config.authKind === 'none') secrets.remove(record.id);
    else if (input.secret !== undefined) secrets.save(record.id, JSON.stringify(secret));

    const updated: ObservabilitySourceRecord = {
      ...record,
      environmentId,
      name,
      baseUrl: input.baseUrl ?? record.baseUrl,
      config,
      allowInsecureTls,
      updatedAt: nowIso()
    };
    updateSource(db, updated);
    statuses.delete(record.id);
    return toView(updated);
  }

  function remove(input: ObservabilitySourceIdInput): { id: string } {
    const record = requireRecord(input.id);
    const dependants = listSourcesVia(db, record.id);
    if (dependants.length > 0) {
      throw new StewardServiceError(
        'VALIDATION_FAILED',
        'Other sources are queried through this one',
        `Change or delete ${dependants.map((source) => source.name).join(', ')} first.`
      );
    }
    secrets.remove(record.id);
    deleteSource(db, record.id);
    statuses.delete(record.id);
    return { id: record.id };
  }

  /** Called before a project is deleted: its rows would cascade, but their encrypted secrets would stay behind. */
  function purgeProject(projectId: string): void {
    for (const id of listSourceIds(db, projectId)) {
      secrets.remove(id);
      statuses.delete(id);
    }
  }

  async function checkResolved(source: ResolvedSource): Promise<ObservabilitySourceStatus> {
    const provider = registry.get(source.kind);
    let connection: ConnectionCheck;
    try {
      connection = await provider.checkConnection(source);
    } catch (error) {
      connection = connectionFromError(error, source.kind);
    }
    let operational: OperationalCheck = { state: 'unknown', reasons: [] };
    // A source we cannot reach or log into has no operational state to report: the connection pill says why.
    if (connection.state === 'connected') {
      try {
        operational = await provider.checkHealth(source);
      } catch (error) {
        operational = { state: 'unknown', reasons: [translateObservabilityError(error, source.kind).message] };
      }
    }
    return { connection, operational, checkedAt: nowIso() };
  }

  /** Checks the connection and the operational state of a saved source now, and remembers the answer. */
  async function test(input: ObservabilitySourceIdInput): Promise<ObservabilitySourceStatus> {
    const record = requireRecord(input.id);
    const status = await checkResolved(resolve(record));
    // A source edited or deleted while the check ran must not get a stale answer back.
    if (findSource(db, record.id)?.updatedAt === record.updatedAt) statuses.set(record.id, { status, at: Date.now() });
    return status;
  }

  async function testDraft(input: ObservabilitySourceDraftInput): Promise<ObservabilitySourceStatus> {
    requireProject(db, input.projectId);
    assertConfigConsistent(input.projectId, input.kind, input.config, input.secretFrom ?? null);
    assertInsecureConfirmed(input.allowInsecureTls, false, input.confirmed);
    let secret = secretOf(input.secret);
    if (input.secretFrom !== undefined) {
      const saved = requireRecord(input.secretFrom);
      if (saved.projectId !== input.projectId) throw new StewardServiceError('NOT_FOUND', 'that source no longer exists');
      secret = { ...(parseObservabilitySecret(secrets.load(saved.id)) ?? {}), ...secret };
    }
    assertSecretMatches(input.config, secret);
    const via = input.config.viaSourceId === undefined ? null : findSource(db, input.config.viaSourceId);
    return checkResolved({
      id: input.secretFrom ?? uuidv7(),
      projectId: input.projectId,
      environmentId: null,
      kind: input.kind,
      name: 'draft',
      baseUrl: input.baseUrl,
      config: input.config,
      allowInsecureTls: input.allowInsecureTls,
      secret,
      ...(via === null ? {} : { via: resolve(via) })
    });
  }

  /** The source resolved for a provider call; `kind` guards a channel meant for one tool from being pointed at another. */
  function resolved(id: string, kind: ObservabilitySourceRecord['kind']): ResolvedSource {
    const record = requireRecord(id);
    if (record.kind !== kind) {
      throw new StewardServiceError('OBS_NOT_SUPPORTED', `that source is not a ${kind} source`);
    }
    return resolve(record);
  }

  function recordOf(id: string): ObservabilitySourceRecord {
    return requireRecord(id);
  }

  return { list, create, update, remove, purgeProject, test, testDraft, resolved, recordOf };
}

export type ObservabilitySourceService = ReturnType<typeof createObservabilitySourceService>;

import type {
  ConnectionCheck,
  ObservabilityCapability,
  ObservabilityKind,
  ObservabilitySourceConfig,
  OperationalCheck
} from '@shared/schemas/observability';
import { StewardServiceError } from '@shared/types/result';
import { netRequest, parseBaseUrl, type NetRequestOptions } from '../net/net-request';
import { httpStatusError, parseJsonBody, providerName, translateObservabilityError } from './observability-errors';

/** What is kept in the secret store for a source. Never leaves main. */
export interface ObservabilitySecret {
  token?: string;
  username?: string;
  password?: string;
}

export function parseObservabilitySecret(raw: string | null): ObservabilitySecret | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const secret: ObservabilitySecret = {};
    if (typeof record['token'] === 'string') secret.token = record['token'];
    if (typeof record['username'] === 'string') secret.username = record['username'];
    if (typeof record['password'] === 'string') secret.password = record['password'];
    return secret;
  } catch {
    return null;
  }
}

/** A saved source together with its decrypted secret: the only shape a provider ever sees. */
export interface ResolvedSource {
  id: string;
  projectId: string;
  environmentId: string | null;
  kind: ObservabilityKind;
  name: string;
  baseUrl: string;
  config: ObservabilitySourceConfig;
  allowInsecureTls: boolean;
  secret: ObservabilitySecret;
  /** The Grafana this source is queried through (`config.viaSourceId`); requests then go to its datasource proxy. */
  via?: ResolvedSource;
}

/**
 * One implementation per tool. The state of a connection (can we reach it, are the credentials good) and its
 * operational state (is what it watches healthy) are separate questions with separate answers.
 */
export interface ObservabilityProvider {
  kind: ObservabilityKind;
  capabilities: readonly ObservabilityCapability[];
  checkConnection(source: ResolvedSource): Promise<ConnectionCheck>;
  checkHealth(source: ResolvedSource): Promise<OperationalCheck>;
}

export interface ProviderRegistry {
  get(kind: ObservabilityKind): ObservabilityProvider;
  capabilitiesOf(kind: ObservabilityKind): readonly ObservabilityCapability[];
}

/** Providers not implemented yet (Sentry arrives in 12.4) are reported as unsupported, not as a crash. */
export function createProviderRegistry(
  providers: readonly ObservabilityProvider[],
  capabilitiesByKind: Record<ObservabilityKind, readonly ObservabilityCapability[]>
): ProviderRegistry {
  const byKind = new Map(providers.map((provider) => [provider.kind, provider]));
  return {
    get(kind) {
      const provider = byKind.get(kind);
      if (provider === undefined) {
        throw new StewardServiceError('OBS_NOT_SUPPORTED', `${providerName(kind)} is not available in this version of Steward`);
      }
      return provider;
    },
    capabilitiesOf: (kind) => capabilitiesByKind[kind]
  };
}

function authHeaders(source: ResolvedSource): Record<string, string> {
  const headers: Record<string, string> = {};
  const { authKind } = source.config;
  if (authKind === 'bearer') {
    if (source.secret.token === undefined || source.secret.token === '') {
      throw new StewardServiceError('OBS_AUTH_FAILED', 'No token is saved for this source', 'Edit the source and paste a token.');
    }
    headers['authorization'] = `Bearer ${source.secret.token}`;
  } else if (authKind === 'basic') {
    if (source.secret.username === undefined || source.secret.password === undefined) {
      throw new StewardServiceError('OBS_AUTH_FAILED', 'No user name and password are saved for this source');
    }
    headers['authorization'] = `Basic ${Buffer.from(`${source.secret.username}:${source.secret.password}`).toString('base64')}`;
  }
  if (source.config.tenant !== undefined) headers['x-scope-orgid'] = source.config.tenant;
  return headers;
}

export type SourceRequest = Pick<NetRequestOptions, 'path' | 'query' | 'method' | 'body' | 'timeoutMs' | 'maxBytes' | 'signal'> & {
  headers?: Record<string, string>;
};

export interface SourceResponse {
  status: number;
  bodyText: string;
  elapsedMs: number;
}

/** A request to a source, with its credentials, CA and TLS choice applied. The status is not judged here. */
export async function requestSource(source: ResolvedSource, request: SourceRequest): Promise<SourceResponse> {
  // Through Grafana, the tool's own API is reached at its datasource proxy: same paths, same answers, one token.
  const target = source.via ?? source;
  const path =
    source.via === undefined || source.config.datasourceUid === undefined
      ? request.path
      : `/api/datasources/proxy/uid/${source.config.datasourceUid}${request.path}`;
  try {
    const response = await netRequest({
      baseUrl: target.baseUrl,
      ...request,
      path,
      headers: { ...authHeaders(target), ...request.headers },
      ...(target.config.caFile === undefined ? {} : { caFile: target.config.caFile }),
      allowInsecureTls: target.allowInsecureTls
    });
    return { status: response.status, bodyText: response.bodyText, elapsedMs: response.elapsedMs };
  } catch (error) {
    throw translateObservabilityError(error, source.kind);
  }
}

/**
 * A URL the server gave us (`/grafana/d/abc`, `https://sentry.io/organizations/x/issues/1/`) as a path on that server
 * without its own path prefix, which is what `observability:openUrl` expects: it adds the prefix itself.
 */
export function relativePath(source: ResolvedSource, raw: string): string {
  let path = raw;
  try {
    path = new URL(raw, source.baseUrl).pathname;
  } catch {
    // Keep the raw value; the open step validates it.
  }
  const prefix = parseBaseUrl(source.baseUrl).pathname.replace(/\/+$/, '');
  if (prefix !== '' && path.startsWith(`${prefix}/`)) path = path.slice(prefix.length);
  return path.startsWith('/') ? path : `/${path}`;
}

/** A request that must succeed and answer with JSON; any other outcome becomes a translated error. */
export async function requestJson<T>(
  source: ResolvedSource,
  request: SourceRequest
): Promise<{ data: T; elapsedMs: number }> {
  const response = await requestSource(source, request);
  // A 401, 403 or 404 through Grafana is Grafana's: the token, the role or the datasource, not the tool behind it.
  const speaker = source.via !== undefined && [401, 403, 404].includes(response.status) ? source.via.kind : source.kind;
  const failure = httpStatusError(response.status, response.bodyText, speaker);
  if (failure !== null) throw failure;
  return { data: parseJsonBody<T>(response.bodyText, source.kind), elapsedMs: response.elapsedMs };
}

import type {
  ConnectionCheck,
  ObservabilityAlert,
  ObservabilityDashboard,
  ObservabilityDatasource,
  OperationalCheck
} from '@shared/schemas/observability';
import { StewardServiceError } from '@shared/types/result';
import { redactObservability, translateObservabilityError } from './observability-errors';
import { relativePath, requestJson, type ObservabilityProvider, type ResolvedSource } from './observability-provider';

const MAX_DASHBOARDS = 1000;
const MAX_ALERTS = 500;
const MAX_TEXT = 500;

export interface GrafanaProvider extends ObservabilityProvider {
  listDashboards(source: ResolvedSource, query?: string): Promise<ObservabilityDashboard[]>;
  listDatasources(source: ResolvedSource): Promise<ObservabilityDatasource[]>;
  listAlerts(source: ResolvedSource): Promise<ObservabilityAlert[]>;
}

function text(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const safe = redactObservability(value);
  return safe.length > max ? `${safe.slice(0, max)}…` : safe;
}

function stringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof value !== 'object' || value === null) return result;
  for (const [key, item] of Object.entries(value)) {
    const safe = text(item, 200);
    if (safe !== null) result[key] = safe;
  }
  return result;
}

interface HealthBody {
  version?: string;
  database?: string;
}

interface UserBody {
  login?: string;
  name?: string;
}

interface RulesBody {
  data?: { groups?: { rules?: { state?: string }[] }[] };
}

interface SearchItem {
  uid?: string;
  title?: string;
  url?: string;
  type?: string;
  tags?: unknown;
  folderTitle?: string;
}

interface DatasourceItem {
  uid?: string;
  name?: string;
  type?: string;
  isDefault?: boolean;
}

interface AlertManagerAlert {
  fingerprint?: string;
  labels?: unknown;
  annotations?: unknown;
  startsAt?: string;
  status?: { state?: string };
}

export function createGrafanaProvider(): GrafanaProvider {
  async function checkConnection(source: ResolvedSource): Promise<ConnectionCheck> {
    const health = await requestJson<HealthBody>(source, { path: '/api/health' });
    let identity: string | null = null;
    if (source.config.authKind !== 'none') {
      // /api/health is public, so only an authenticated call proves the token works.
      const user = await requestJson<UserBody>(source, { path: '/api/user' }).catch((error: unknown) => {
        const translated = translateObservabilityError(error, 'grafana');
        if (translated.code === 'OBS_AUTH_FAILED') throw translated;
        return null;
      });
      identity = text(user?.data.login) ?? text(user?.data.name);
    }
    return {
      state: 'connected',
      version: text(health.data.version, 40),
      identity,
      latencyMs: health.elapsedMs,
      message: null
    };
  }

  async function checkHealth(source: ResolvedSource): Promise<OperationalCheck> {
    const health = await requestJson<HealthBody>(source, { path: '/api/health' });
    if (health.data.database !== undefined && health.data.database !== 'ok') {
      return { state: 'failing', reasons: ['Grafana reports that its database is not healthy'] };
    }
    try {
      const rules = await requestJson<RulesBody>(source, { path: '/api/prometheus/grafana/api/v1/rules' });
      let firing = 0;
      for (const group of rules.data.data?.groups ?? []) {
        for (const rule of group.rules ?? []) if (rule.state === 'firing') firing += 1;
      }
      return firing === 0
        ? { state: 'healthy', reasons: [] }
        : { state: 'degraded', reasons: [`${firing} alert ${firing === 1 ? 'rule is' : 'rules are'} firing`] };
    } catch (error) {
      const translated = translateObservabilityError(error, 'grafana');
      // Without the right to read alert rules, "healthy" would be a guess.
      return { state: 'unknown', reasons: [translated.message] };
    }
  }

  async function listDashboards(source: ResolvedSource, query?: string): Promise<ObservabilityDashboard[]> {
    const response = await requestJson<SearchItem[]>(source, {
      path: '/api/search',
      query: { type: 'dash-db', limit: String(MAX_DASHBOARDS), ...(query === undefined || query === '' ? {} : { query }) }
    });
    if (!Array.isArray(response.data)) {
      throw new StewardServiceError('OBS_BAD_RESPONSE', 'Grafana answered with an unexpected shape');
    }
    return response.data.flatMap((item) => {
      const uid = text(item.uid, 100);
      const title = text(item.title, 200);
      if (uid === null || title === null || typeof item.url !== 'string') return [];
      return [
        {
          uid,
          title,
          path: relativePath(source, item.url),
          folder: text(item.folderTitle, 200),
          tags: Array.isArray(item.tags) ? item.tags.flatMap((tag) => (text(tag, 60) === null ? [] : [text(tag, 60) as string])) : []
        }
      ];
    });
  }

  async function listDatasources(source: ResolvedSource): Promise<ObservabilityDatasource[]> {
    const response = await requestJson<DatasourceItem[]>(source, { path: '/api/datasources' });
    if (!Array.isArray(response.data)) {
      throw new StewardServiceError('OBS_BAD_RESPONSE', 'Grafana answered with an unexpected shape');
    }
    return response.data.flatMap((item) => {
      const uid = text(item.uid, 100);
      const name = text(item.name, 200);
      const type = text(item.type, 60);
      if (uid === null || name === null || type === null) return [];
      return [{ uid, name, type, isDefault: item.isDefault === true }];
    });
  }

  async function listAlerts(source: ResolvedSource): Promise<ObservabilityAlert[]> {
    const response = await requestJson<AlertManagerAlert[]>(source, { path: '/api/alertmanager/grafana/api/v2/alerts' });
    if (!Array.isArray(response.data)) {
      throw new StewardServiceError('OBS_BAD_RESPONSE', 'Grafana answered with an unexpected shape');
    }
    return response.data.slice(0, MAX_ALERTS).map((alert, index) => {
      const labels = stringRecord(alert.labels);
      const annotations = stringRecord(alert.annotations);
      return {
        id: text(alert.fingerprint, 100) ?? `alert-${index}`,
        name: labels['alertname'] ?? 'Alert',
        state: alert.status?.state === 'suppressed' ? ('suppressed' as const) : ('firing' as const),
        severity: labels['severity'] ?? null,
        summary: annotations['summary'] ?? annotations['description'] ?? null,
        labels,
        startsAt: text(alert.startsAt, 40)
      };
    });
  }

  return {
    kind: 'grafana',
    capabilities: ['dashboards', 'alerts'],
    checkConnection,
    checkHealth,
    listDashboards,
    listDatasources,
    listAlerts
  };
}

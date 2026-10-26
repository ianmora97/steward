import type {
  ConnectionCheck,
  OperationalCheck,
  SentryEvent,
  SentryIssue,
  SentryIssuesResult,
  SentryPeriod
} from '@shared/schemas/observability';
import { StewardServiceError } from '@shared/types/result';
import { redactObservability } from './observability-errors';
import { relativePath, requestJson, type ObservabilityProvider, type ResolvedSource } from './observability-provider';

const DEFAULT_LIMIT = 50;
const MAX_FRAMES = 25;
const MAX_EXCEPTIONS = 3;
const MAX_TAGS = 20;
const MAX_TEXT = 500;

export interface SentryProvider extends ObservabilityProvider {
  listIssues(source: ResolvedSource, options?: { query?: string; statsPeriod?: SentryPeriod; limit?: number }): Promise<SentryIssuesResult>;
  latestEvent(source: ResolvedSource, issueId: string): Promise<SentryEvent>;
}

function text(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const safe = redactObservability(value);
  return safe.length > max ? `${safe.slice(0, max)}…` : safe;
}

function timeOf(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOf(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The organization and project slugs of the source. The schema checks them when the source is saved; this guards the path anyway. */
function slugs(source: ResolvedSource): { organization: string; project: string } {
  const { organization, project } = source.config;
  if (organization === undefined || project === undefined || !/^[A-Za-z0-9_.-]+$/.test(organization) || !/^[A-Za-z0-9_.-]+$/.test(project)) {
    throw new StewardServiceError('VALIDATION_FAILED', 'This Sentry source needs the organization and the project', 'Edit the source and fill both slugs.');
  }
  return { organization, project };
}

interface IssueItem {
  id?: string;
  shortId?: string;
  title?: string;
  culprit?: string;
  level?: string;
  status?: string;
  count?: string | number;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  permalink?: string;
}

interface RawFrame {
  filename?: string;
  function?: string;
  lineNo?: number;
  inApp?: boolean;
}

interface RawEntry {
  type?: string;
  data?: { values?: { type?: string; value?: string; stacktrace?: { frames?: RawFrame[] } }[] };
}

interface RawEvent {
  eventID?: string;
  id?: string;
  dateCreated?: string;
  message?: string;
  release?: { version?: string } | null;
  tags?: { key?: string; value?: string }[];
  entries?: RawEntry[];
}

export function createSentryProvider(): SentryProvider {
  async function checkConnection(source: ResolvedSource): Promise<ConnectionCheck> {
    const { organization, project } = slugs(source);
    const org = await requestJson<{ name?: string; slug?: string }>(source, { path: `/api/0/organizations/${organization}/` });
    // The token may read the organization and not the project: say so now, not on the first issue list.
    await requestJson<{ slug?: string }>(source, { path: `/api/0/projects/${organization}/${project}/` });
    return {
      state: 'connected',
      version: null,
      identity: text(org.data.name, 120) ?? text(org.data.slug, 120),
      latencyMs: org.elapsedMs,
      message: null
    };
  }

  async function checkHealth(source: ResolvedSource): Promise<OperationalCheck> {
    const { organization, project } = slugs(source);
    // New unresolved issues of the last day: a project with old, known issues is not "degraded" on that account.
    const response = await requestJson<IssueItem[]>(source, {
      path: `/api/0/projects/${organization}/${project}/issues/`,
      query: { query: 'is:unresolved age:-24h', statsPeriod: '24h', limit: '100' }
    });
    const count = Array.isArray(response.data) ? response.data.length : 0;
    if (count === 0) return { state: 'healthy', reasons: [] };
    return { state: 'degraded', reasons: [`${count >= 100 ? '100+' : count} new unresolved ${count === 1 ? 'issue' : 'issues'} in the last 24 hours`] };
  }

  async function listIssues(
    source: ResolvedSource,
    options: { query?: string; statsPeriod?: SentryPeriod; limit?: number } = {}
  ): Promise<SentryIssuesResult> {
    const { organization, project } = slugs(source);
    const limit = options.limit ?? DEFAULT_LIMIT;
    const response = await requestJson<IssueItem[]>(source, {
      path: `/api/0/projects/${organization}/${project}/issues/`,
      query: {
        query: options.query === undefined || options.query === '' ? 'is:unresolved' : options.query,
        statsPeriod: options.statsPeriod ?? '24h',
        limit: String(limit)
      }
    });
    if (!Array.isArray(response.data)) throw new StewardServiceError('OBS_BAD_RESPONSE', 'Sentry answered with an unexpected shape');
    const issues = response.data.flatMap<SentryIssue>((item) => {
      const id = text(item.id, 30);
      const title = text(item.title, 300);
      if (id === null || title === null) return [];
      return [
        {
          id,
          shortId: text(item.shortId, 60) ?? id,
          title,
          culprit: text(item.culprit, 300),
          level: text(item.level, 20) ?? 'error',
          status: text(item.status, 20) ?? 'unresolved',
          count: numberOf(item.count),
          userCount: numberOf(item.userCount),
          firstSeenMs: timeOf(item.firstSeen),
          lastSeenMs: timeOf(item.lastSeen),
          path: typeof item.permalink === 'string' ? relativePath(source, item.permalink) : null
        }
      ];
    });
    return { issues, truncated: response.data.length >= limit };
  }

  async function latestEvent(source: ResolvedSource, issueId: string): Promise<SentryEvent> {
    const { organization } = slugs(source);
    const response = await requestJson<RawEvent>(source, { path: `/api/0/organizations/${organization}/issues/${issueId}/events/latest/` });
    const event = response.data;
    const exceptions = (event.entries ?? [])
      .filter((entry) => entry.type === 'exception')
      .flatMap((entry) => entry.data?.values ?? [])
      .slice(0, MAX_EXCEPTIONS)
      .map((exception) => ({
        type: text(exception.type, 200),
        value: text(exception.value, 1000),
        // Sentry lists frames oldest first; the call that failed is last, so the tail is what matters.
        frames: (exception.stacktrace?.frames ?? []).slice(-MAX_FRAMES).map((frame) => ({
          file: text(frame.filename, 300),
          function: text(frame.function, 200),
          line: typeof frame.lineNo === 'number' ? frame.lineNo : null,
          inApp: frame.inApp === true
        }))
      }));
    return {
      eventId: text(event.eventID ?? event.id, 64) ?? issueId,
      dateCreatedMs: timeOf(event.dateCreated),
      message: text(event.message, 1000),
      release: text(event.release?.version, 200),
      tags: (event.tags ?? []).slice(0, MAX_TAGS).flatMap((tag) => {
        const key = text(tag.key, 60);
        const value = text(tag.value, 200);
        return key === null || value === null ? [] : [{ key, value }];
      }),
      exceptions
    };
  }

  return { kind: 'sentry', capabilities: ['issues'], checkConnection, checkHealth, listIssues, latestEvent };
}

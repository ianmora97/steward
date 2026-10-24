import { z } from 'zod';
import type { GithubPullPage, GithubPullState } from '@shared/schemas/github';
import { StewardServiceError } from '@shared/types/result';
import { redactSecrets } from './git-errors';

/**
 * The only module in main that talks to GitHub. The base URL is a constant, not
 * a setting, so a stored value can never point the token at another host.
 * Every response is parsed with Zod: GitHub's reply is untrusted data.
 */
const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 30;
const MAX_ERROR_CHARS = 300;

export interface GithubApi {
  getUser(token: string): Promise<{ login: string; scopes: string[] }>;
  getRepo(token: string, owner: string, name: string): Promise<{ defaultBranch: string }>;
  listBranches(token: string, owner: string, name: string): Promise<string[]>;
  listPulls(
    token: string,
    owner: string,
    name: string,
    query: { state: GithubPullState; page: number }
  ): Promise<GithubPullPage>;
  createPull(
    token: string,
    owner: string,
    name: string,
    body: { base: string; head: string; title: string; body: string; draft: boolean }
  ): Promise<{ number: number; url: string }>;
}

const userSchema = z.object({ login: z.string() });
const repoSchema = z.object({ default_branch: z.string() });
const branchesSchema = z.array(z.object({ name: z.string() }));
const pullSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  user: z.object({ login: z.string() }).nullish(),
  head: z.object({ ref: z.string() }),
  base: z.object({ ref: z.string() }),
  draft: z.boolean().nullish(),
  state: z.enum(['open', 'closed']),
  merged_at: z.string().nullish(),
  html_url: z.string(),
  created_at: z.string(),
  updated_at: z.string()
});
const createdPullSchema = z.object({ number: z.number().int(), html_url: z.string() });
const errorBodySchema = z.object({
  message: z.string().optional(),
  errors: z.array(z.union([z.string(), z.object({ message: z.string().optional() })])).optional()
});

interface ApiResponse {
  headers: Headers;
  json: unknown;
}

function safeMessage(text: string): string {
  return redactSecrets(text).slice(0, MAX_ERROR_CHARS).trim();
}

function parseBody<T>(schema: z.ZodType<T>, json: unknown): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    // Paths only: the offending values may be anything GitHub sent.
    console.error(
      '[steward] unexpected GitHub response shape:',
      parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')
    );
    throw new StewardServiceError('GITHUB_FAILED', 'GitHub returned a response Steward does not understand');
  }
  return parsed.data;
}

function describeFailure(json: unknown): string {
  const body = errorBodySchema.safeParse(json);
  if (!body.success) return '';
  const first = body.data.errors?.[0];
  const detail = typeof first === 'string' ? first : first?.message;
  return safeMessage(detail ?? body.data.message ?? '');
}

function mapStatus(status: number, headers: Headers, json: unknown): StewardServiceError {
  const rateLimited = (status === 403 || status === 429) && headers.get('x-ratelimit-remaining') === '0';
  if (rateLimited) {
    const reset = Number(headers.get('x-ratelimit-reset'));
    return new StewardServiceError(
      'GITHUB_RATE_LIMITED',
      'GitHub rate limit reached',
      Number.isFinite(reset) && reset > 0 ? `Resets at ${new Date(reset * 1000).toISOString()}` : undefined
    );
  }
  if (status === 401) {
    return new StewardServiceError('GITHUB_AUTH_FAILED', 'GitHub rejected the token');
  }
  if (status === 403) {
    // Not AUTH_FAILED: the token is valid, it just cannot do this one thing, so the connection must not flip to "reconnect".
    return new StewardServiceError('GITHUB_FAILED', 'the token does not have permission for this');
  }
  if (status === 404) {
    return new StewardServiceError('GITHUB_NOT_FOUND', 'it does not exist, or the token has no access to it');
  }
  const detail = describeFailure(json);
  return new StewardServiceError(
    'GITHUB_FAILED',
    detail === '' ? `GitHub returned an error (${status})` : detail
  );
}

export function createGithubApi(deps: { fetchImpl?: typeof fetch } = {}): GithubApi {
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function request(
    token: string,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>
  ): Promise<ApiResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(`${API_BASE}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': API_VERSION,
          'User-Agent': 'Steward',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      throw new StewardServiceError(
        'GITHUB_UNREACHABLE',
        timedOut ? 'GitHub did not answer in time' : 'could not reach GitHub'
      );
    } finally {
      clearTimeout(timer);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    if (!response.ok) throw mapStatus(response.status, response.headers, json);
    return { headers: response.headers, json };
  }

  const repoPath = (owner: string, name: string): string =>
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  return {
    async getUser(token) {
      const { headers, json } = await request(token, 'GET', '/user');
      const user = parseBody(userSchema, json);
      const scopes = (headers.get('x-oauth-scopes') ?? '')
        .split(',')
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0);
      return { login: user.login, scopes };
    },

    async getRepo(token, owner, name) {
      const { json } = await request(token, 'GET', repoPath(owner, name));
      return { defaultBranch: parseBody(repoSchema, json).default_branch };
    },

    async listBranches(token, owner, name) {
      const { json } = await request(token, 'GET', `${repoPath(owner, name)}/branches?per_page=100`);
      return parseBody(branchesSchema, json)
        .map((branch) => branch.name)
        .sort((a, b) => a.localeCompare(b));
    },

    async listPulls(token, owner, name, query) {
      const params = new URLSearchParams({
        state: query.state,
        per_page: String(PAGE_SIZE),
        page: String(query.page)
      });
      const { headers, json } = await request(token, 'GET', `${repoPath(owner, name)}/pulls?${params.toString()}`);
      const items = parseBody(z.array(pullSchema), json).map((pull) => ({
        number: pull.number,
        title: pull.title,
        author: pull.user?.login ?? null,
        headRef: pull.head.ref,
        baseRef: pull.base.ref,
        draft: pull.draft ?? false,
        state: pull.merged_at ? ('merged' as const) : pull.state,
        url: pull.html_url,
        createdAt: pull.created_at,
        updatedAt: pull.updated_at
      }));
      return { items, page: query.page, hasNext: /<[^>]+>;\s*rel="next"/.test(headers.get('link') ?? '') };
    },

    async createPull(token, owner, name, body) {
      const { json } = await request(token, 'POST', `${repoPath(owner, name)}/pulls`, body);
      const created = parseBody(createdPullSchema, json);
      return { number: created.number, url: created.html_url };
    }
  };
}

import { z } from 'zod';
import type {
  GithubJob,
  GithubJobLog,
  GithubPullPage,
  GithubPullState,
  GithubRunPage,
  GithubWorkflow
} from '@shared/schemas/github';
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
const RUNS_PER_PAGE = 30;
const LOG_TIMEOUT_MS = 60_000;
/** Beyond this the log is not downloaded at all; the user opens it on GitHub. */
const MAX_LOG_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const MAX_LOG_TAIL_BYTES = 200 * 1024;

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
  listWorkflows(token: string, owner: string, name: string): Promise<GithubWorkflow[]>;
  listRuns(
    token: string,
    owner: string,
    name: string,
    query: { workflowId: number | null; page: number }
  ): Promise<GithubRunPage>;
  listJobs(token: string, owner: string, name: string, runId: number): Promise<GithubJob[]>;
  /** The raw end of the job log; the caller cleans it before it leaves main. */
  getJobLog(token: string, owner: string, name: string, jobId: number): Promise<GithubJobLog>;
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
const workflowsSchema = z.object({
  workflows: z.array(z.object({ id: z.number().int(), name: z.string(), path: z.string(), state: z.string() }))
});
const runSchema = z.object({
  id: z.number().int(),
  run_number: z.number().int(),
  display_title: z.string().nullish(),
  name: z.string().nullish(),
  workflow_id: z.number().int(),
  status: z.string().nullish(),
  conclusion: z.string().nullish(),
  event: z.string().nullish(),
  head_branch: z.string().nullish(),
  head_sha: z.string(),
  actor: z.object({ login: z.string() }).nullish(),
  html_url: z.string(),
  created_at: z.string(),
  run_started_at: z.string().nullish(),
  updated_at: z.string()
});
const runsSchema = z.object({ workflow_runs: z.array(runSchema) });
const jobsSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      status: z.string().nullish(),
      conclusion: z.string().nullish(),
      started_at: z.string().nullish(),
      completed_at: z.string().nullish(),
      html_url: z.string().nullish(),
      steps: z
        .array(
          z.object({
            number: z.number().int(),
            name: z.string(),
            status: z.string().nullish(),
            conclusion: z.string().nullish()
          })
        )
        .nullish()
    })
  )
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

function hasNextPage(headers: Headers): boolean {
  return /<[^>]+>;\s*rel="next"/.test(headers.get('link') ?? '');
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

function unreachable(error: unknown): StewardServiceError {
  const timedOut = error instanceof Error && error.name === 'AbortError';
  return new StewardServiceError(
    'GITHUB_UNREACHABLE',
    timedOut ? 'GitHub did not answer in time' : 'could not reach GitHub'
  );
}

export function createGithubApi(deps: { fetchImpl?: typeof fetch } = {}): GithubApi {
  const fetchImpl = deps.fetchImpl ?? fetch;

  /**
   * One authenticated call. The returned `done()` stops the timeout; callers
   * that stream a body keep it running until they have read it all.
   */
  async function send(
    token: string,
    method: 'GET' | 'POST',
    path: string,
    options: { body?: Record<string, unknown>; timeoutMs?: number } = {}
  ): Promise<{ response: Response; done: () => void }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
    const done = (): void => clearTimeout(timer);
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
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch (error) {
      done();
      throw unreachable(error);
    }

    if (!response.ok) {
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        json = null;
      }
      done();
      throw mapStatus(response.status, response.headers, json);
    }
    return { response, done };
  }

  async function request(
    token: string,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>
  ): Promise<ApiResponse> {
    const { response, done } = await send(token, method, path, { body });
    done();
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
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
      return { items, page: query.page, hasNext: hasNextPage(headers) };
    },

    async listWorkflows(token, owner, name) {
      const { json } = await request(token, 'GET', `${repoPath(owner, name)}/actions/workflows?per_page=100`);
      return parseBody(workflowsSchema, json).workflows;
    },

    async listRuns(token, owner, name, query) {
      const base =
        query.workflowId === null
          ? `${repoPath(owner, name)}/actions/runs`
          : `${repoPath(owner, name)}/actions/workflows/${encodeURIComponent(String(query.workflowId))}/runs`;
      const params = new URLSearchParams({ per_page: String(RUNS_PER_PAGE), page: String(query.page) });
      const { headers, json } = await request(token, 'GET', `${base}?${params.toString()}`);
      const items = parseBody(runsSchema, json).workflow_runs.map((run) => ({
        id: run.id,
        runNumber: run.run_number,
        title: run.display_title ?? run.name ?? '',
        workflowId: run.workflow_id,
        workflowName: run.name ?? '',
        status: run.status ?? 'unknown',
        conclusion: run.conclusion ?? null,
        event: run.event ?? '',
        branch: run.head_branch ?? null,
        sha: run.head_sha,
        actor: run.actor?.login ?? null,
        url: run.html_url,
        createdAt: run.created_at,
        startedAt: run.run_started_at ?? null,
        updatedAt: run.updated_at
      }));
      return { items, page: query.page, hasNext: hasNextPage(headers) };
    },

    async listJobs(token, owner, name, runId) {
      const { json } = await request(
        token,
        'GET',
        `${repoPath(owner, name)}/actions/runs/${encodeURIComponent(String(runId))}/jobs?per_page=100`
      );
      return parseBody(jobsSchema, json).jobs.map((job) => ({
        id: job.id,
        name: job.name,
        status: job.status ?? 'unknown',
        conclusion: job.conclusion ?? null,
        startedAt: job.started_at ?? null,
        completedAt: job.completed_at ?? null,
        url: job.html_url ?? '',
        steps: (job.steps ?? []).map((step) => ({
          number: step.number,
          name: step.name,
          status: step.status ?? 'unknown',
          conclusion: step.conclusion ?? null
        }))
      }));
    },

    async getJobLog(token, owner, name, jobId) {
      const { response, done } = await send(
        token,
        'GET',
        `${repoPath(owner, name)}/actions/jobs/${encodeURIComponent(String(jobId))}/logs`,
        { timeoutMs: LOG_TIMEOUT_MS }
      );
      try {
        const reader = response.body?.getReader();
        if (reader === undefined) return { text: '', truncated: false, tooLarge: false };

        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
          const { done: finished, value } = await reader.read();
          if (finished) break;
          total += value.length;
          if (total > MAX_LOG_DOWNLOAD_BYTES) {
            await reader.cancel();
            return { text: '', truncated: true, tooLarge: true };
          }
          chunks.push(value);
        }

        const all = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          all.set(chunk, offset);
          offset += chunk.length;
        }
        const cut = total > MAX_LOG_TAIL_BYTES;
        let text = new TextDecoder('utf-8').decode(cut ? all.subarray(total - MAX_LOG_TAIL_BYTES) : all);
        if (cut) {
          // The cut can land mid-line (or mid-character); start at the next whole line.
          const newline = text.indexOf(String.fromCharCode(10));
          if (newline !== -1) text = text.slice(newline + 1);
        }
        return { text, truncated: cut, tooLarge: false };
      } catch (error) {
        if (error instanceof StewardServiceError) throw error;
        throw unreachable(error);
      } finally {
        done();
      }
    },

    async createPull(token, owner, name, body) {
      const { json } = await request(token, 'POST', `${repoPath(owner, name)}/pulls`, body);
      const created = parseBody(createdPullSchema, json);
      return { number: created.number, url: created.html_url };
    }
  };
}

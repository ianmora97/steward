import type {
  GithubGetJobLogInput,
  GithubHealth,
  GithubJob,
  GithubJobLog,
  GithubListJobsInput,
  GithubListRunsInput,
  GithubRepositoryInput,
  GithubRunPage,
  GithubWorkflow
} from '@shared/schemas/github';
import type { SqlDatabase } from '../db/driver';
import type { GithubApi } from './github-api';
import type { GithubIntegrationService } from './github-integration.service';
import { computeHealth } from './github-health';
import { cleanLog } from './github-log';
import { resolveGithubRepo } from './github-repo';

export interface GithubActionsServiceDeps {
  db: SqlDatabase;
  github: GithubIntegrationService;
  api: GithubApi;
}

/** Read-only view of GitHub Actions. Nothing here is stored: GitHub stays the system of record. */
export interface GithubActionsService {
  listWorkflows(input: GithubRepositoryInput): Promise<GithubWorkflow[]>;
  listRuns(input: GithubListRunsInput): Promise<GithubRunPage>;
  listJobs(input: GithubListJobsInput): Promise<GithubJob[]>;
  getJobLog(input: GithubGetJobLogInput): Promise<GithubJobLog>;
  getHealth(input: GithubRepositoryInput): Promise<GithubHealth>;
}

export function createGithubActionsService(deps: GithubActionsServiceDeps): GithubActionsService {
  const { db, github, api } = deps;

  return {
    listWorkflows(input) {
      const { owner, name } = resolveGithubRepo(db, input);
      return github.withToken(input.projectId, (token) => api.listWorkflows(token, owner, name));
    },

    listRuns(input) {
      const { owner, name } = resolveGithubRepo(db, input);
      const query = { workflowId: input.workflowId ?? null, page: input.page ?? 1 };
      return github.withToken(input.projectId, (token) => api.listRuns(token, owner, name, query));
    },

    listJobs(input) {
      const { owner, name } = resolveGithubRepo(db, input);
      return github.withToken(input.projectId, (token) => api.listJobs(token, owner, name, input.runId));
    },

    async getJobLog(input) {
      const { owner, name } = resolveGithubRepo(db, input);
      const log = await github.withToken(input.projectId, (token) =>
        api.getJobLog(token, owner, name, input.jobId)
      );
      return { ...log, text: cleanLog(log.text) };
    },

    async getHealth(input) {
      const { owner, name } = resolveGithubRepo(db, input);
      const page = await github.withToken(input.projectId, (token) =>
        api.listRuns(token, owner, name, { workflowId: null, page: 1 })
      );
      return computeHealth(page.items);
    }
  };
}

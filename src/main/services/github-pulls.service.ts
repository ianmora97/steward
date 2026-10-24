import type {
  GithubBranchList,
  GithubCreatePullInput,
  GithubCreatedPull,
  GithubListBranchesInput,
  GithubListPullsInput,
  GithubOpenUrlInput,
  GithubPullPage
} from '@shared/schemas/github';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { insertExecution, updateExecutionFinish } from '../db/execution.repo';
import { nowIso, uuidv7 } from '../db/id';
import type { GithubApi } from './github-api';
import type { GithubIntegrationService } from './github-integration.service';
import { redactSecrets } from './git-errors';
import { resolveGithubRepo } from './github-repo';

const KIND_CREATE_PR = 'github_create_pr';

export interface GithubPullsServiceDeps {
  db: SqlDatabase;
  github: GithubIntegrationService;
  api: GithubApi;
  openExternal: (url: string) => Promise<void>;
}

export interface GithubPullsService {
  listPulls(input: GithubListPullsInput): Promise<GithubPullPage>;
  listBranches(input: GithubListBranchesInput): Promise<GithubBranchList>;
  createPull(input: GithubCreatePullInput): Promise<GithubCreatedPull>;
  openUrl(input: GithubOpenUrlInput): Promise<null>;
}

/** Only plain https://github.com/… links leave Steward for the browser; `@`-tricks and other hosts do not. */
function assertGithubUrl(text: string): URL {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new StewardServiceError('VALIDATION_FAILED', 'that is not a valid link');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username !== '' || url.password !== '') {
    throw new StewardServiceError('VALIDATION_FAILED', 'only https://github.com links can be opened');
  }
  return url;
}

export function createGithubPullsService(deps: GithubPullsServiceDeps): GithubPullsService {
  const { db, github, api } = deps;

  return {
    listPulls(input) {
      const { owner, name } = resolveGithubRepo(db, input);
      const state = input.state ?? 'open';
      const page = input.page ?? 1;
      return github.withToken(input.projectId, (token) => api.listPulls(token, owner, name, { state, page }));
    },

    listBranches(input) {
      const { owner, name } = resolveGithubRepo(db, input);
      return github.withToken(input.projectId, async (token) => {
        const [names, repo] = await Promise.all([
          api.listBranches(token, owner, name),
          api.getRepo(token, owner, name)
        ]);
        return { names, defaultBranch: repo.defaultBranch };
      });
    },

    async createPull(input) {
      const { owner, name } = resolveGithubRepo(db, input);
      const executionId = uuidv7();
      const startedAt = nowIso();
      const startedMs = Date.now();

      // Title and body are deliberately not recorded: they can hold anything the user typed.
      insertExecution(db, {
        id: executionId,
        projectId: input.projectId,
        repositoryId: null,
        kind: KIND_CREATE_PR,
        context: 'remote',
        command: `POST /repos/${owner}/${name}/pulls`,
        args: [input.base, input.head, input.draft ? 'draft' : 'ready'],
        cwd: null,
        status: 'running',
        exitCode: null,
        confirmedByUser: true,
        startedAt,
        finishedAt: null,
        durationMs: null,
        errorCode: null,
        errorMessage: null,
        logPath: null,
        sshHostId: null
      });

      try {
        const created = await github.withToken(input.projectId, (token) =>
          api.createPull(token, owner, name, {
            base: input.base,
            head: input.head,
            title: input.title,
            body: input.body,
            draft: input.draft
          })
        );
        updateExecutionFinish(db, executionId, {
          status: 'succeeded',
          exitCode: null,
          finishedAt: nowIso(),
          durationMs: Date.now() - startedMs,
          errorCode: null,
          errorMessage: null
        });
        return created;
      } catch (error) {
        const known = error instanceof StewardServiceError;
        updateExecutionFinish(db, executionId, {
          status: 'failed',
          exitCode: null,
          finishedAt: nowIso(),
          durationMs: Date.now() - startedMs,
          errorCode: known ? error.code : 'UNKNOWN',
          errorMessage: known ? redactSecrets(error.message).slice(0, 500) : 'unexpected error'
        });
        throw error;
      }
    },

    async openUrl(input) {
      const url = assertGithubUrl(input.url);
      await deps.openExternal(url.href);
      return null;
    }
  };
}

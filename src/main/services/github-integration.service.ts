import type { GithubConnectInput, GithubIntegration, GithubProjectInput } from '@shared/schemas/github';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { nowIso, uuidv7 } from '../db/id';
import {
  deleteIntegration,
  findIntegrationByProject,
  insertIntegration,
  updateIntegration,
  type ConnectionStatus,
  type IntegrationRecord
} from '../db/integration.repo';
import { runCommand } from '../exec/run';
import type { SecretStore } from '../security/secret-store';
import type { GithubApi } from './github-api';
import { redactSecrets } from './git-errors';
import { requireProject } from './project.service';
import { attachIntegrationTab, detachIntegrationTab } from './tab.service';

const KIND = 'github';
const API_BASE = 'https://api.github.com';
const GH_TIMEOUT_MS = 10_000;

export interface GithubIntegrationServiceDeps {
  db: SqlDatabase;
  secrets: SecretStore;
  api: GithubApi;
}

export interface GithubIntegrationService {
  connect(input: GithubConnectInput): Promise<GithubIntegration>;
  importFromGh(input: GithubProjectInput): Promise<GithubIntegration>;
  disconnect(input: GithubProjectInput): GithubIntegration;
  status(input: GithubProjectInput): Promise<GithubIntegration>;
  /** Runs `operation` with the project's token; a rejected or unreachable token updates the stored status. */
  withToken<T>(projectId: string, operation: (token: string) => Promise<T>): Promise<T>;
  /** Drops the secret and row of a project that is about to be deleted. */
  purgeProject(projectId: string): void;
}

function unconfigured(projectId: string): GithubIntegration {
  return { projectId, status: 'unconfigured', login: null, scopes: [], checkedAt: null, lastError: null };
}

function toView(record: IntegrationRecord): GithubIntegration {
  return {
    projectId: record.projectId,
    status: record.connectionStatus,
    login: record.config.login,
    scopes: record.config.scopes,
    checkedAt: record.connectionCheckedAt,
    lastError: record.lastError
  };
}

export function createGithubIntegrationService(deps: GithubIntegrationServiceDeps): GithubIntegrationService {
  const { db, secrets, api } = deps;

  function recordFailure(record: IntegrationRecord, status: ConnectionStatus, message: string): void {
    const now = nowIso();
    updateIntegration(
      db,
      record.id,
      { connectionStatus: status, connectionCheckedAt: now, lastError: redactSecrets(message).slice(0, 300) },
      now
    );
  }

  async function connectWithToken(projectId: string, token: string): Promise<GithubIntegration> {
    requireProject(db, projectId);
    if (!secrets.isAvailable()) {
      throw new StewardServiceError(
        'SECRET_STORE_UNAVAILABLE',
        'this system cannot encrypt secrets, so Steward will not store the token'
      );
    }

    // Validate before anything is written: a bad token leaves no row, file or tab behind.
    const user = await api.getUser(token);

    const existing = findIntegrationByProject(db, projectId, KIND);
    const id = existing?.id ?? uuidv7();
    secrets.save(id, token);

    const now = nowIso();
    const config = { login: user.login, scopes: user.scopes, apiBase: API_BASE };
    try {
      const record = db.transaction(() => {
        if (existing === null) {
          insertIntegration(db, {
            id,
            projectId,
            kind: KIND,
            connectionStatus: 'connected',
            connectionCheckedAt: now,
            lastError: null,
            config,
            createdAt: now,
            updatedAt: now
          });
        } else {
          updateIntegration(
            db,
            id,
            { connectionStatus: 'connected', connectionCheckedAt: now, lastError: null, config },
            now
          );
        }
        attachIntegrationTab(db, projectId, 'github', id);
        return findIntegrationByProject(db, projectId, KIND);
      });
      if (record === null) throw new StewardServiceError('DB_ERROR', 'the connection could not be saved');
      return toView(record);
    } catch (error) {
      if (existing === null) secrets.remove(id);
      throw error;
    }
  }

  return {
    connect: (input) => connectWithToken(input.projectId, input.token),

    async importFromGh(input) {
      let token: string;
      try {
        const result = await runCommand('gh', ['auth', 'token'], { timeoutMs: GH_TIMEOUT_MS });
        token = result.exitCode === 0 ? result.stdout.trim() : '';
      } catch (error) {
        if (error instanceof StewardServiceError && error.code === 'NOT_FOUND') {
          throw new StewardServiceError('GH_NOT_FOUND', 'the gh CLI was not found on this system');
        }
        throw error;
      }
      if (token === '') {
        throw new StewardServiceError('GITHUB_AUTH_FAILED', 'gh is not logged in', 'Run `gh auth login` and try again.');
      }
      return connectWithToken(input.projectId, token);
    },

    disconnect(input) {
      const record = findIntegrationByProject(db, input.projectId, KIND);
      if (record === null) return unconfigured(input.projectId);
      secrets.remove(record.id);
      db.transaction(() => {
        deleteIntegration(db, record.id);
        detachIntegrationTab(db, input.projectId, 'github');
      });
      return unconfigured(input.projectId);
    },

    async status(input) {
      const record = findIntegrationByProject(db, input.projectId, KIND);
      if (record === null) return unconfigured(input.projectId);
      const token = secrets.load(record.id);
      if (token === null) {
        recordFailure(record, 'auth_error', 'the stored token could not be read');
        return toView(findIntegrationByProject(db, input.projectId, KIND) ?? record);
      }
      try {
        const user = await api.getUser(token);
        const now = nowIso();
        updateIntegration(
          db,
          record.id,
          {
            connectionStatus: 'connected',
            connectionCheckedAt: now,
            lastError: null,
            config: { login: user.login, scopes: user.scopes, apiBase: API_BASE }
          },
          now
        );
      } catch (error) {
        if (!(error instanceof StewardServiceError)) throw error;
        if (error.code === 'GITHUB_AUTH_FAILED') recordFailure(record, 'auth_error', error.message);
        else if (error.code === 'GITHUB_UNREACHABLE') recordFailure(record, 'unreachable', error.message);
        else throw error;
      }
      const fresh = findIntegrationByProject(db, input.projectId, KIND);
      return toView(fresh ?? record);
    },

    async withToken(projectId, operation) {
      const record = findIntegrationByProject(db, projectId, KIND);
      const token = record === null ? null : secrets.load(record.id);
      if (record === null || token === null) {
        throw new StewardServiceError('GITHUB_NOT_CONNECTED', 'GitHub is not connected for this project');
      }
      try {
        return await operation(token);
      } catch (error) {
        if (error instanceof StewardServiceError) {
          if (error.code === 'GITHUB_AUTH_FAILED') recordFailure(record, 'auth_error', error.message);
          else if (error.code === 'GITHUB_UNREACHABLE') recordFailure(record, 'unreachable', error.message);
        }
        throw error;
      }
    },

    purgeProject(projectId) {
      const record = findIntegrationByProject(db, projectId, KIND);
      if (record === null) return;
      secrets.remove(record.id);
      deleteIntegration(db, record.id);
    }
  };
}

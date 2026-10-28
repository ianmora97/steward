import {
  MAX_DOMAINS_PER_PROJECT,
  type CreateDomainInput,
  type CreateDomainResult,
  type DeleteDomainInput,
  type Domain,
  type DomainSummary,
  type ListDomainsInput,
  type UpdateDomainInput
} from '@shared/schemas/cloud';
import { StewardServiceError } from '@shared/types/result';
import {
  countDomainsByProject,
  deleteDomain,
  findDomain,
  findDomainByHostname,
  insertDomain,
  latestResultsByCheck,
  listChecksByProject,
  listDomainsByProject,
  updateDomain,
  type DomainRecord
} from '../db/cloud.repo';
import type { SqlDatabase } from '../db/driver';
import { findEnvironmentById } from '../db/environment.repo';
import { nowIso, uuidv7 } from '../db/id';
import { findRepositoryById } from '../db/repository.repo';
import { findSshHost, type SshHostRecord } from '../db/ssh-host.repo';
import { normalizeHostname } from './check-target';
import { STATE_WINDOW, summarizeDomain, type DomainSignals, type StateCheck } from './check-state';
import type { CheckService } from './check.service';
import { requireProject } from './project.service';

export interface DomainServiceDeps {
  db: SqlDatabase;
  checks: CheckService;
}

const NO_SIGNALS: DomainSignals = summarizeDomain([]);

export function createDomainService(deps: DomainServiceDeps) {
  const { db, checks } = deps;

  function requireRecord(id: string): DomainRecord {
    const record = findDomain(db, id);
    if (record === null) throw new StewardServiceError('NOT_FOUND', 'that domain no longer exists');
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

  function repositoryName(projectId: string, repositoryId: string | null): string | null {
    if (repositoryId === null) return null;
    const repository = findRepositoryById(db, repositoryId);
    if (repository === null || repository.projectId !== projectId) {
      throw new StewardServiceError('NOT_FOUND', 'that repository no longer exists');
    }
    return repository.name;
  }

  /** The server that serves the domain has to be one of the project's own connections. */
  function requireSshHost(projectId: string, sshHostId: string | null): SshHostRecord | null {
    if (sshHostId === null) return null;
    const host = findSshHost(db, sshHostId);
    if (host === null || host.projectId !== projectId) {
      throw new StewardServiceError('NOT_FOUND', 'that server no longer exists');
    }
    return host;
  }

  function sshHostName(projectId: string, sshHostId: string | null): string | null {
    return requireSshHost(projectId, sshHostId)?.name ?? null;
  }

  /** A domain with a server and no environment of its own lives where its server lives. */
  function environmentFor(projectId: string, environmentId: string | null, sshHostId: string | null): string | null {
    if (environmentId !== null) return environmentId;
    return requireSshHost(projectId, sshHostId)?.environmentId ?? null;
  }

  function assertHostnameFree(projectId: string, hostname: string, exceptId: string | null): void {
    const clash = findDomainByHostname(db, projectId, hostname);
    if (clash !== null && clash.id !== exceptId) {
      throw new StewardServiceError('CONFLICT', 'that domain is already registered in this project');
    }
  }

  function toDomain(record: DomainRecord): Domain {
    return {
      id: record.id,
      projectId: record.projectId,
      environmentId: record.environmentId,
      environmentName: environmentName(record.projectId, record.environmentId),
      repositoryId: record.repositoryId,
      repositoryName: repositoryName(record.projectId, record.repositoryId),
      sshHostId: record.sshHostId,
      sshHostName: sshHostName(record.projectId, record.sshHostId),
      hostname: record.hostname,
      notes: record.notes,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  /** The signals of every domain of a project, from the latest results of their checks. */
  function signalsOf(projectId: string): Map<string, DomainSignals> {
    const latest = latestResultsByCheck(db, projectId, STATE_WINDOW);
    const byDomain = new Map<string, StateCheck[]>();
    for (const check of listChecksByProject(db, projectId)) {
      if (check.domainId === null) continue;
      const list = byDomain.get(check.domainId) ?? [];
      list.push({ kind: check.kind, enabled: check.enabled, results: latest.get(check.id) ?? [] });
      byDomain.set(check.domainId, list);
    }
    return new Map([...byDomain].map(([domainId, domainChecks]) => [domainId, summarizeDomain(domainChecks)]));
  }

  function toSummary(record: DomainRecord, signals: ReadonlyMap<string, DomainSignals>): DomainSummary {
    return { ...toDomain(record), ...(signals.get(record.id) ?? NO_SIGNALS) };
  }

  function list(input: ListDomainsInput): DomainSummary[] {
    requireProject(db, input.projectId);
    const signals = signalsOf(input.projectId);
    return listDomainsByProject(db, input.projectId).map((record) => toSummary(record, signals));
  }

  function create(input: CreateDomainInput): CreateDomainResult {
    requireProject(db, input.projectId);
    const hostname = normalizeHostname(input.hostname);
    const environmentId = environmentFor(input.projectId, input.environmentId, input.sshHostId);
    environmentName(input.projectId, environmentId);
    repositoryName(input.projectId, input.repositoryId);
    assertHostnameFree(input.projectId, hostname, null);
    if (countDomainsByProject(db, input.projectId) >= MAX_DOMAINS_PER_PROJECT) {
      throw new StewardServiceError(
        'CHECK_LIMIT',
        `A project can have at most ${MAX_DOMAINS_PER_PROJECT} domains`,
        'Remove one you no longer use before adding another.'
      );
    }

    const now = nowIso();
    const record: DomainRecord = {
      id: uuidv7(),
      projectId: input.projectId,
      environmentId,
      repositoryId: input.repositoryId,
      sshHostId: input.sshHostId,
      hostname,
      notes: input.notes,
      createdAt: now,
      updatedAt: now
    };
    // The domain never fails to be created because its recommended checks do not fit: it just comes without them.
    let checksCreated = false;
    db.transaction(() => {
      insertDomain(db, record);
      if (input.withDefaultChecks) checksCreated = checks.createDefaults(record);
    });
    return { domain: toSummary(record, signalsOf(record.projectId)), checksCreated };
  }

  function update(input: UpdateDomainInput): DomainSummary {
    const record = requireRecord(input.id);
    const hostname = input.hostname === undefined ? record.hostname : normalizeHostname(input.hostname);
    const environmentId = input.environmentId === undefined ? record.environmentId : input.environmentId;
    const repositoryId = input.repositoryId === undefined ? record.repositoryId : input.repositoryId;
    const sshHostId = input.sshHostId === undefined ? record.sshHostId : input.sshHostId;
    environmentName(record.projectId, environmentId);
    requireSshHost(record.projectId, sshHostId);
    repositoryName(record.projectId, repositoryId);
    assertHostnameFree(record.projectId, hostname, record.id);

    const updated: DomainRecord = {
      ...record,
      hostname,
      environmentId,
      repositoryId,
      sshHostId,
      notes: input.notes ?? record.notes,
      updatedAt: nowIso()
    };
    db.transaction(() => {
      updateDomain(db, updated);
      // Renamed: the checks follow the new name; their history stays, it is the same site.
      if (hostname !== record.hostname) checks.retarget(updated);
    });
    return toSummary(updated, signalsOf(updated.projectId));
  }

  /** The checks and their results go with it (foreign keys cascade). */
  function remove(input: DeleteDomainInput): { id: string } {
    const record = requireRecord(input.id);
    checks.forgetDomain(record.id);
    deleteDomain(db, record.id);
    return { id: record.id };
  }

  return { list, create, update, remove };
}

export type DomainService = ReturnType<typeof createDomainService>;

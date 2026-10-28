import {
  MAX_ACTIVE_CHECKS_PER_PROJECT,
  checkConfigSchema,
  dnsCheckConfigSchema,
  httpCheckConfigSchema,
  tlsCheckConfigSchema,
  type Check,
  type CheckConfig,
  type CheckIdInput,
  type CheckKind,
  type CheckResult,
  type CheckResultsInput,
  type CreateCheckInput,
  type DeleteCheckInput,
  type ListChecksInput,
  type UpdateCheckInput
} from '@shared/schemas/cloud';
import { StewardServiceError } from '@shared/types/result';
import {
  countEnabledChecks,
  deleteCheck,
  findCheck,
  findDomain,
  insertCheck,
  listChecksByDomain,
  listResults,
  updateCheck,
  type CheckRecord,
  type DomainRecord
} from '../db/cloud.repo';
import type { SqlDatabase } from '../db/driver';
import { nowIso, uuidv7 } from '../db/id';
import type { CheckScheduler } from './check-scheduler';

export interface CheckServiceDeps {
  db: SqlDatabase;
  scheduler: CheckScheduler;
}

const DEFAULT_RESULTS_SHOWN = 50;

const CONFIG_SCHEMAS = {
  dns: dnsCheckConfigSchema,
  tls: tlsCheckConfigSchema,
  http: httpCheckConfigSchema
} as const;

/** Intervals of the recommended checks: DNS rarely changes, a certificate even less, the page is the live signal. */
const DEFAULT_CHECKS: readonly { kind: CheckKind; config: CheckConfig; intervalSeconds: number }[] = [
  { kind: 'dns', config: { resolver: 'system', recordTypes: ['A', 'AAAA', 'CNAME'] }, intervalSeconds: 300 },
  { kind: 'tls', config: { port: 443 }, intervalSeconds: 3600 },
  {
    kind: 'http',
    config: { scheme: 'https', path: '/', method: 'GET', expectedStatus: { min: 200, max: 399 } },
    intervalSeconds: 60
  }
];

/** Settings of the kind this check is. A config of another kind, or with an invalid field, is refused with the reason. */
function parseConfig(kind: CheckKind, raw: unknown): CheckConfig {
  const parsed = CONFIG_SCHEMAS[kind].safeParse(raw);
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((issue) => `${issue.path.join('.') || kind}: ${issue.message}`).join('; ');
    throw new StewardServiceError('VALIDATION_FAILED', `Those settings do not fit a ${kind.toUpperCase()} check`, reasons);
  }
  return parsed.data;
}

/**
 * What the check looks at, always built from the domain and the settings: nothing the caller types becomes an
 * address. The path of an HTTP check is appended to the hostname, never the other way round.
 */
function targetOf(hostname: string, config: CheckConfig): string {
  if ('port' in config) return `${hostname}:${config.port}`;
  if ('scheme' in config) return `${config.scheme}://${hostname}${config.path}`;
  return hostname;
}

export function createCheckService(deps: CheckServiceDeps) {
  const { db, scheduler } = deps;

  function requireCheck(id: string): CheckRecord {
    const record = findCheck(db, id);
    if (record === null || record.domainId === null) throw new StewardServiceError('NOT_FOUND', 'that check no longer exists');
    return record;
  }

  function requireDomain(id: string): DomainRecord {
    const domain = findDomain(db, id);
    if (domain === null) throw new StewardServiceError('NOT_FOUND', 'that domain no longer exists');
    return domain;
  }

  /** Only checks that run on their own count: a switched-off one costs nothing. */
  function assertRoom(projectId: string, exceptId: string | null, adding = 1): void {
    if (countEnabledChecks(db, projectId, exceptId) + adding > MAX_ACTIVE_CHECKS_PER_PROJECT) {
      throw new StewardServiceError(
        'CHECK_LIMIT',
        `A project can have at most ${MAX_ACTIVE_CHECKS_PER_PROJECT} active checks`,
        'Switch one off or delete one you no longer need.'
      );
    }
  }

  function toView(record: CheckRecord): Check {
    return {
      id: record.id,
      projectId: record.projectId,
      domainId: record.domainId ?? '',
      kind: record.kind,
      target: record.target,
      config: checkConfigSchema.parse(record.config),
      intervalSeconds: record.intervalSeconds,
      enabled: record.enabled,
      lastResult: listResults(db, record.id, 1)[0] ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  function list(input: ListChecksInput): Check[] {
    requireDomain(input.domainId);
    return listChecksByDomain(db, input.domainId).map(toView);
  }

  function create(input: CreateCheckInput): Check {
    const domain = requireDomain(input.domainId);
    if (input.enabled) assertRoom(domain.projectId, null);
    const config = parseConfig(input.kind, input.config);
    const now = nowIso();
    const record: CheckRecord = {
      id: uuidv7(),
      projectId: domain.projectId,
      domainId: domain.id,
      kind: input.kind,
      target: targetOf(domain.hostname, config),
      config,
      intervalSeconds: input.intervalSeconds,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now
    };
    insertCheck(db, record);
    scheduler.reschedule(record.id);
    return toView(record);
  }

  function update(input: UpdateCheckInput): Check {
    const record = requireCheck(input.id);
    const domain = requireDomain(record.domainId ?? '');
    const enabled = input.enabled ?? record.enabled;
    if (enabled && !record.enabled) assertRoom(record.projectId, record.id);
    const config = input.config === undefined ? parseConfig(record.kind, record.config) : parseConfig(record.kind, input.config);

    const updated: CheckRecord = {
      ...record,
      target: targetOf(domain.hostname, config),
      config,
      intervalSeconds: input.intervalSeconds ?? record.intervalSeconds,
      enabled,
      updatedAt: nowIso()
    };
    updateCheck(db, updated);
    scheduler.reschedule(updated.id);
    return toView(updated);
  }

  /** Its history goes with it (foreign keys cascade). */
  function remove(input: DeleteCheckInput): { id: string } {
    const record = requireCheck(input.id);
    scheduler.forget(record.id);
    deleteCheck(db, record.id);
    return { id: record.id };
  }

  async function runNow(input: CheckIdInput): Promise<CheckResult> {
    const record = requireCheck(input.id);
    const result = await scheduler.runNow(record.id);
    if (result === null) throw new StewardServiceError('NOT_FOUND', 'that check no longer exists');
    return result;
  }

  function results(input: CheckResultsInput): CheckResult[] {
    requireCheck(input.checkId);
    return listResults(db, input.checkId, input.limit ?? DEFAULT_RESULTS_SHOWN);
  }

  /**
   * The recommended checks of a new domain. Writes only: the caller owns the transaction. Returns false, and writes
   * nothing, when they would not fit in the project's limit of active checks.
   */
  function createDefaults(domain: DomainRecord): boolean {
    if (countEnabledChecks(db, domain.projectId, null) + DEFAULT_CHECKS.length > MAX_ACTIVE_CHECKS_PER_PROJECT) return false;
    const now = nowIso();
    for (const template of DEFAULT_CHECKS) {
      const record: CheckRecord = {
        id: uuidv7(),
        projectId: domain.projectId,
        domainId: domain.id,
        kind: template.kind,
        target: targetOf(domain.hostname, template.config),
        config: template.config,
        intervalSeconds: template.intervalSeconds,
        enabled: true,
        createdAt: now,
        updatedAt: now
      };
      insertCheck(db, record);
      scheduler.reschedule(record.id);
    }
    return true;
  }

  /** A domain was renamed: every check of it now looks at the new name. */
  function retarget(domain: DomainRecord): void {
    for (const record of listChecksByDomain(db, domain.id)) {
      const config = parseConfig(record.kind, record.config);
      updateCheck(db, { ...record, target: targetOf(domain.hostname, config), updatedAt: nowIso() });
    }
  }

  /** Stops the checks of a domain that is about to be deleted. */
  function forgetDomain(domainId: string): void {
    for (const record of listChecksByDomain(db, domainId)) scheduler.forget(record.id);
  }

  return { list, create, update, remove, runNow, results, createDefaults, retarget, forgetDomain };
}

export type CheckService = ReturnType<typeof createCheckService>;

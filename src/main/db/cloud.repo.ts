import type { CheckKind, CheckStatus } from '@shared/schemas/cloud';
import type { SqlDatabase } from './driver';

export interface DomainRecord {
  id: string;
  projectId: string;
  environmentId: string | null;
  repositoryId: string | null;
  /** The server that serves it, when one of the project's connections does. */
  sshHostId: string | null;
  /** Normalized: lowercase ASCII, no trailing dot. */
  hostname: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

interface DomainRow {
  id: string;
  project_id: string;
  environment_id: string | null;
  repository_id: string | null;
  ssh_host_id: string | null;
  hostname: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

function toDomain(row: DomainRow): DomainRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    repositoryId: row.repository_id,
    sshHostId: row.ssh_host_id,
    hostname: row.hostname,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listDomainsByProject(db: SqlDatabase, projectId: string): DomainRecord[] {
  return db
    .prepare('SELECT * FROM domains WHERE project_id = :project_id ORDER BY hostname, id')
    .all<DomainRow>({ project_id: projectId })
    .map(toDomain);
}

export function countDomainsByProject(db: SqlDatabase, projectId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM domains WHERE project_id = :project_id').get<{ total: number }>({
    project_id: projectId
  });
  return row?.total ?? 0;
}

export function findDomain(db: SqlDatabase, id: string): DomainRecord | null {
  const row = db.prepare('SELECT * FROM domains WHERE id = :id').get<DomainRow>({ id });
  return row === undefined ? null : toDomain(row);
}

/** `hostname` is already normalized by the caller, so a plain comparison is enough. */
export function findDomainByHostname(db: SqlDatabase, projectId: string, hostname: string): DomainRecord | null {
  const row = db
    .prepare('SELECT * FROM domains WHERE project_id = :project_id AND hostname = :hostname')
    .get<DomainRow>({ project_id: projectId, hostname });
  return row === undefined ? null : toDomain(row);
}

export function insertDomain(db: SqlDatabase, record: DomainRecord): void {
  db.prepare(
    `INSERT INTO domains (id, project_id, environment_id, repository_id, ssh_host_id, hostname, notes, created_at, updated_at)
     VALUES (:id, :project_id, :environment_id, :repository_id, :ssh_host_id, :hostname, :notes, :created_at, :updated_at)`
  ).run({
    id: record.id,
    project_id: record.projectId,
    environment_id: record.environmentId,
    repository_id: record.repositoryId,
    ssh_host_id: record.sshHostId,
    hostname: record.hostname,
    notes: record.notes,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  });
}

export function updateDomain(db: SqlDatabase, record: DomainRecord): void {
  db.prepare(
    `UPDATE domains
        SET environment_id = :environment_id, repository_id = :repository_id, ssh_host_id = :ssh_host_id,
            hostname = :hostname, notes = :notes, updated_at = :updated_at
      WHERE id = :id`
  ).run({
    id: record.id,
    environment_id: record.environmentId,
    repository_id: record.repositoryId,
    ssh_host_id: record.sshHostId,
    hostname: record.hostname,
    notes: record.notes,
    updated_at: record.updatedAt
  });
}

export function deleteDomain(db: SqlDatabase, id: string): number {
  return db.prepare('DELETE FROM domains WHERE id = :id').run({ id }).changes;
}

// ── Checks ─────────────────────────────────────────────────────────────────

export interface CheckRecord {
  id: string;
  projectId: string;
  domainId: string | null;
  kind: CheckKind;
  target: string;
  /** Validated against the schema of its kind when it is written; read back as stored. */
  config: unknown;
  intervalSeconds: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CheckRow {
  id: string;
  project_id: string;
  domain_id: string | null;
  kind: CheckKind;
  target: string;
  config_json: string;
  interval_seconds: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function toCheck(row: CheckRow): CheckRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    domainId: row.domain_id,
    kind: row.kind,
    target: row.target,
    config: JSON.parse(row.config_json) as unknown,
    intervalSeconds: row.interval_seconds,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listChecksByDomain(db: SqlDatabase, domainId: string): CheckRecord[] {
  return db
    .prepare("SELECT * FROM endpoint_checks WHERE domain_id = :domain_id ORDER BY CASE kind WHEN 'dns' THEN 0 WHEN 'tls' THEN 1 ELSE 2 END, created_at, id")
    .all<CheckRow>({ domain_id: domainId })
    .map(toCheck);
}

export function listChecksByProject(db: SqlDatabase, projectId: string): CheckRecord[] {
  return db
    .prepare('SELECT * FROM endpoint_checks WHERE project_id = :project_id ORDER BY created_at, id')
    .all<CheckRow>({ project_id: projectId })
    .map(toCheck);
}

export function listEnabledChecks(db: SqlDatabase): CheckRecord[] {
  return db.prepare('SELECT * FROM endpoint_checks WHERE enabled = 1 AND domain_id IS NOT NULL').all<CheckRow>().map(toCheck);
}

export function findCheck(db: SqlDatabase, id: string): CheckRecord | null {
  const row = db.prepare('SELECT * FROM endpoint_checks WHERE id = :id').get<CheckRow>({ id });
  return row === undefined ? null : toCheck(row);
}

/** Checks of the project that run on their own, not counting `exceptId` (the one being edited). */
export function countEnabledChecks(db: SqlDatabase, projectId: string, exceptId: string | null): number {
  const row = db
    .prepare('SELECT COUNT(*) AS total FROM endpoint_checks WHERE project_id = :project_id AND enabled = 1 AND id != :except_id')
    .get<{ total: number }>({ project_id: projectId, except_id: exceptId ?? '' });
  return row?.total ?? 0;
}

export function insertCheck(db: SqlDatabase, record: CheckRecord): void {
  db.prepare(
    `INSERT INTO endpoint_checks (id, project_id, domain_id, kind, target, config_json, interval_seconds, enabled, created_at, updated_at)
     VALUES (:id, :project_id, :domain_id, :kind, :target, :config_json, :interval_seconds, :enabled, :created_at, :updated_at)`
  ).run({
    id: record.id,
    project_id: record.projectId,
    domain_id: record.domainId,
    kind: record.kind,
    target: record.target,
    config_json: JSON.stringify(record.config),
    interval_seconds: record.intervalSeconds,
    enabled: record.enabled ? 1 : 0,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  });
}

export function updateCheck(db: SqlDatabase, record: CheckRecord): void {
  db.prepare(
    `UPDATE endpoint_checks
        SET target = :target, config_json = :config_json, interval_seconds = :interval_seconds,
            enabled = :enabled, updated_at = :updated_at
      WHERE id = :id`
  ).run({
    id: record.id,
    target: record.target,
    config_json: JSON.stringify(record.config),
    interval_seconds: record.intervalSeconds,
    enabled: record.enabled ? 1 : 0,
    updated_at: record.updatedAt
  });
}

export function deleteCheck(db: SqlDatabase, id: string): number {
  return db.prepare('DELETE FROM endpoint_checks WHERE id = :id').run({ id }).changes;
}

// ── Results ────────────────────────────────────────────────────────────────

export interface CheckResultRecord {
  id: string;
  checkId: string;
  ts: string;
  status: CheckStatus;
  latencyMs: number | null;
  summary: string;
  detail: Record<string, unknown>;
}

interface ResultRow {
  id: string;
  check_id: string;
  ts: string;
  status: CheckStatus;
  latency_ms: number | null;
  summary: string;
  detail_json: string;
}

function toResult(row: ResultRow): CheckResultRecord {
  return {
    id: row.id,
    checkId: row.check_id,
    ts: row.ts,
    status: row.status,
    latencyMs: row.latency_ms,
    summary: row.summary,
    detail: JSON.parse(row.detail_json) as Record<string, unknown>
  };
}

/** What is kept of a check's history: a week, and no more than this many rows. */
export const RESULT_RETENTION_MS = 7 * 86_400_000;
export const RESULT_MAX_ROWS = 2000;

/** Inserts a result and prunes the history of its check in the same transaction. Throws if the check is gone. */
export function insertResult(db: SqlDatabase, record: CheckResultRecord): void {
  const cutoff = new Date(Date.parse(record.ts) - RESULT_RETENTION_MS).toISOString();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO check_results (id, check_id, ts, status, latency_ms, summary, detail_json)
       VALUES (:id, :check_id, :ts, :status, :latency_ms, :summary, :detail_json)`
    ).run({
      id: record.id,
      check_id: record.checkId,
      ts: record.ts,
      status: record.status,
      latency_ms: record.latencyMs,
      summary: record.summary,
      detail_json: JSON.stringify(record.detail)
    });
    db.prepare('DELETE FROM check_results WHERE check_id = :check_id AND ts < :cutoff').run({ check_id: record.checkId, cutoff });
    db.prepare(
      `DELETE FROM check_results
        WHERE check_id = :check_id
          AND id NOT IN (SELECT id FROM check_results WHERE check_id = :check_id ORDER BY ts DESC, id DESC LIMIT :max_rows)`
    ).run({ check_id: record.checkId, max_rows: RESULT_MAX_ROWS });
  });
}

/** Newest first. */
export function listResults(db: SqlDatabase, checkId: string, limit: number): CheckResultRecord[] {
  return db
    .prepare('SELECT * FROM check_results WHERE check_id = :check_id ORDER BY ts DESC, id DESC LIMIT :limit')
    .all<ResultRow>({ check_id: checkId, limit })
    .map(toResult);
}

/** The latest `perCheck` results of every check of a project, newest first, keyed by check id. */
export function latestResultsByCheck(db: SqlDatabase, projectId: string, perCheck: number): Map<string, CheckResultRecord[]> {
  const rows = db
    .prepare(
      `SELECT id, check_id, ts, status, latency_ms, summary, detail_json FROM (
         SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.check_id ORDER BY r.ts DESC, r.id DESC) AS position
           FROM check_results r
           JOIN endpoint_checks c ON c.id = r.check_id
          WHERE c.project_id = :project_id
       )
       WHERE position <= :per_check
       ORDER BY check_id, ts DESC, id DESC`
    )
    .all<ResultRow>({ project_id: projectId, per_check: perCheck });
  const byCheck = new Map<string, CheckResultRecord[]>();
  for (const row of rows) {
    const list = byCheck.get(row.check_id) ?? [];
    list.push(toResult(row));
    byCheck.set(row.check_id, list);
  }
  return byCheck;
}

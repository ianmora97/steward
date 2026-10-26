import type { ObservabilityKind, ObservabilitySourceConfig } from '@shared/schemas/observability';
import type { SqlDatabase } from './driver';

export interface ObservabilitySourceRecord {
  id: string;
  projectId: string;
  environmentId: string | null;
  kind: ObservabilityKind;
  name: string;
  baseUrl: string;
  /** Not secret: credentials live in the secret store under the source id. */
  config: ObservabilitySourceConfig;
  allowInsecureTls: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SourceRow {
  id: string;
  project_id: string;
  environment_id: string | null;
  kind: ObservabilityKind;
  name: string;
  base_url: string;
  config_json: string;
  allow_insecure_tls: number;
  created_at: string;
  updated_at: string;
}

function toRecord(row: SourceRow): ObservabilitySourceRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    kind: row.kind,
    name: row.name,
    baseUrl: row.base_url,
    config: JSON.parse(row.config_json) as ObservabilitySourceConfig,
    allowInsecureTls: row.allow_insecure_tls === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listSourcesByProject(db: SqlDatabase, projectId: string): ObservabilitySourceRecord[] {
  return db
    .prepare('SELECT * FROM observability_sources WHERE project_id = :project_id ORDER BY kind, name COLLATE NOCASE, id')
    .all<SourceRow>({ project_id: projectId })
    .map(toRecord);
}

export function findSource(db: SqlDatabase, id: string): ObservabilitySourceRecord | null {
  const row = db.prepare('SELECT * FROM observability_sources WHERE id = :id').get<SourceRow>({ id });
  return row === undefined ? null : toRecord(row);
}

export function findSourceByName(db: SqlDatabase, projectId: string, name: string): ObservabilitySourceRecord | null {
  const row = db
    .prepare('SELECT * FROM observability_sources WHERE project_id = :project_id AND name = :name COLLATE NOCASE')
    .get<SourceRow>({ project_id: projectId, name });
  return row === undefined ? null : toRecord(row);
}

export function insertSource(db: SqlDatabase, record: ObservabilitySourceRecord): void {
  db.prepare(
    `INSERT INTO observability_sources (id, project_id, environment_id, kind, name, base_url, config_json,
                                        allow_insecure_tls, created_at, updated_at)
     VALUES (:id, :project_id, :environment_id, :kind, :name, :base_url, :config_json,
             :allow_insecure_tls, :created_at, :updated_at)`
  ).run({
    id: record.id,
    project_id: record.projectId,
    environment_id: record.environmentId,
    kind: record.kind,
    name: record.name,
    base_url: record.baseUrl,
    config_json: JSON.stringify(record.config),
    allow_insecure_tls: record.allowInsecureTls ? 1 : 0,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  });
}

export function updateSource(db: SqlDatabase, record: ObservabilitySourceRecord): void {
  db.prepare(
    `UPDATE observability_sources
        SET environment_id = :environment_id, name = :name, base_url = :base_url, config_json = :config_json,
            allow_insecure_tls = :allow_insecure_tls, updated_at = :updated_at
      WHERE id = :id`
  ).run({
    id: record.id,
    environment_id: record.environmentId,
    name: record.name,
    base_url: record.baseUrl,
    config_json: JSON.stringify(record.config),
    allow_insecure_tls: record.allowInsecureTls ? 1 : 0,
    updated_at: record.updatedAt
  });
}

export function deleteSource(db: SqlDatabase, id: string): number {
  return db.prepare('DELETE FROM observability_sources WHERE id = :id').run({ id }).changes;
}

/** Ids of every source of a project, to clean their secrets when the project goes. */
export function listSourceIds(db: SqlDatabase, projectId: string): string[] {
  return db
    .prepare('SELECT id FROM observability_sources WHERE project_id = :project_id')
    .all<{ id: string }>({ project_id: projectId })
    .map((row) => row.id);
}

/** Sources of the project that are queried through the given Grafana source. */
export function listSourcesVia(db: SqlDatabase, viaSourceId: string): ObservabilitySourceRecord[] {
  return db
    .prepare('SELECT * FROM observability_sources WHERE json_extract(config_json, \'$.viaSourceId\') = :via')
    .all<SourceRow>({ via: viaSourceId })
    .map(toRecord);
}

// ── services ───────────────────────────────────────────────────────────────

export interface ObservabilityServiceRecord {
  id: string;
  projectId: string;
  environmentId: string | null;
  name: string;
  repositoryId: string | null;
  logSelector: string | null;
  metricMatcher: string | null;
  sshHostId: string | null;
  dockerContainer: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ServiceRow {
  id: string;
  project_id: string;
  environment_id: string | null;
  name: string;
  repository_id: string | null;
  log_selector: string | null;
  metric_matcher: string | null;
  ssh_host_id: string | null;
  docker_container: string | null;
  created_at: string;
  updated_at: string;
}

function toService(row: ServiceRow): ObservabilityServiceRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    name: row.name,
    repositoryId: row.repository_id,
    logSelector: row.log_selector,
    metricMatcher: row.metric_matcher,
    sshHostId: row.ssh_host_id,
    dockerContainer: row.docker_container,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listServicesByProject(db: SqlDatabase, projectId: string): ObservabilityServiceRecord[] {
  return db
    .prepare('SELECT * FROM observability_services WHERE project_id = :project_id ORDER BY name COLLATE NOCASE, id')
    .all<ServiceRow>({ project_id: projectId })
    .map(toService);
}

export function findService(db: SqlDatabase, id: string): ObservabilityServiceRecord | null {
  const row = db.prepare('SELECT * FROM observability_services WHERE id = :id').get<ServiceRow>({ id });
  return row === undefined ? null : toService(row);
}

/** A service is named once per environment; the same name in two environments is two services. */
export function findServiceByName(
  db: SqlDatabase,
  projectId: string,
  environmentId: string | null,
  name: string
): ObservabilityServiceRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM observability_services
        WHERE project_id = :project_id AND name = :name COLLATE NOCASE
          AND ((environment_id IS NULL AND :environment_id IS NULL) OR environment_id = :environment_id)`
    )
    .get<ServiceRow>({ project_id: projectId, environment_id: environmentId, name });
  return row === undefined ? null : toService(row);
}

export function insertService(db: SqlDatabase, record: ObservabilityServiceRecord): void {
  db.prepare(
    `INSERT INTO observability_services (id, project_id, environment_id, name, repository_id, log_selector,
                                         metric_matcher, ssh_host_id, docker_container, created_at, updated_at)
     VALUES (:id, :project_id, :environment_id, :name, :repository_id, :log_selector,
             :metric_matcher, :ssh_host_id, :docker_container, :created_at, :updated_at)`
  ).run({
    id: record.id,
    project_id: record.projectId,
    environment_id: record.environmentId,
    name: record.name,
    repository_id: record.repositoryId,
    log_selector: record.logSelector,
    metric_matcher: record.metricMatcher,
    ssh_host_id: record.sshHostId,
    docker_container: record.dockerContainer,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  });
}

export function updateService(db: SqlDatabase, record: ObservabilityServiceRecord): void {
  db.prepare(
    `UPDATE observability_services
        SET environment_id = :environment_id, name = :name, repository_id = :repository_id,
            log_selector = :log_selector, metric_matcher = :metric_matcher, ssh_host_id = :ssh_host_id,
            docker_container = :docker_container, updated_at = :updated_at
      WHERE id = :id`
  ).run({
    id: record.id,
    environment_id: record.environmentId,
    name: record.name,
    repository_id: record.repositoryId,
    log_selector: record.logSelector,
    metric_matcher: record.metricMatcher,
    ssh_host_id: record.sshHostId,
    docker_container: record.dockerContainer,
    updated_at: record.updatedAt
  });
}

export function deleteService(db: SqlDatabase, id: string): number {
  return db.prepare('DELETE FROM observability_services WHERE id = :id').run({ id }).changes;
}

// ── signals ────────────────────────────────────────────────────────────────

export interface ObservabilitySignalRecord {
  id: string;
  projectId: string;
  name: string;
  kind: 'promql' | 'logql_metric';
  queryTemplate: string;
  unit: string;
  position: number;
  createdAt: string;
}

interface SignalRow {
  id: string;
  project_id: string;
  name: string;
  kind: 'promql' | 'logql_metric';
  query_template: string;
  unit: string;
  position: number;
  created_at: string;
}

function toSignal(row: SignalRow): ObservabilitySignalRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    kind: row.kind,
    queryTemplate: row.query_template,
    unit: row.unit,
    position: row.position,
    createdAt: row.created_at
  };
}

export function listSignalsByProject(db: SqlDatabase, projectId: string): ObservabilitySignalRecord[] {
  return db
    .prepare('SELECT * FROM observability_signals WHERE project_id = :project_id ORDER BY position, id')
    .all<SignalRow>({ project_id: projectId })
    .map(toSignal);
}

export function findSignal(db: SqlDatabase, id: string): ObservabilitySignalRecord | null {
  const row = db.prepare('SELECT * FROM observability_signals WHERE id = :id').get<SignalRow>({ id });
  return row === undefined ? null : toSignal(row);
}

export function findSignalByName(db: SqlDatabase, projectId: string, name: string): ObservabilitySignalRecord | null {
  const row = db
    .prepare('SELECT * FROM observability_signals WHERE project_id = :project_id AND name = :name COLLATE NOCASE')
    .get<SignalRow>({ project_id: projectId, name });
  return row === undefined ? null : toSignal(row);
}

export function insertSignal(db: SqlDatabase, record: ObservabilitySignalRecord): void {
  db.prepare(
    `INSERT INTO observability_signals (id, project_id, name, kind, query_template, unit, position, created_at)
     VALUES (:id, :project_id, :name, :kind, :query_template, :unit, :position, :created_at)`
  ).run({
    id: record.id,
    project_id: record.projectId,
    name: record.name,
    kind: record.kind,
    query_template: record.queryTemplate,
    unit: record.unit,
    position: record.position,
    created_at: record.createdAt
  });
}

export function updateSignal(db: SqlDatabase, record: ObservabilitySignalRecord): void {
  db.prepare(
    `UPDATE observability_signals
        SET name = :name, kind = :kind, query_template = :query_template, unit = :unit
      WHERE id = :id`
  ).run({ id: record.id, name: record.name, kind: record.kind, query_template: record.queryTemplate, unit: record.unit });
}

export function setSignalPosition(db: SqlDatabase, id: string, position: number): void {
  db.prepare('UPDATE observability_signals SET position = :position WHERE id = :id').run({ id, position });
}

export function deleteSignal(db: SqlDatabase, id: string): number {
  return db.prepare('DELETE FROM observability_signals WHERE id = :id').run({ id }).changes;
}

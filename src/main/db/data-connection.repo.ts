import type { MongoSavedQuery, MongoSavedQueryKind } from '@shared/schemas/mongodb';
import type { SqlDatabase } from './driver';

export type DataConnectionKind = 'mongodb' | 'redis';

export interface DataConnectionRecord {
  id: string;
  projectId: string;
  environmentId: string | null;
  kind: DataConnectionKind;
  name: string;
  hostDisplay: string;
  /** Non-secret options, as the kind's own schema describes them. */
  options: unknown;
  readOnly: boolean;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  project_id: string;
  environment_id: string | null;
  kind: DataConnectionKind;
  name: string;
  host_display: string;
  options_json: string;
  read_only: number;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: Row): DataConnectionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    environmentId: row.environment_id,
    kind: row.kind,
    name: row.name,
    hostDisplay: row.host_display,
    options: JSON.parse(row.options_json) as unknown,
    readOnly: row.read_only === 1,
    lastConnectedAt: row.last_connected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listDataConnections(db: SqlDatabase, projectId: string, kind: DataConnectionKind): DataConnectionRecord[] {
  return db
    .prepare('SELECT * FROM data_connections WHERE project_id = :project_id AND kind = :kind ORDER BY name COLLATE NOCASE, id')
    .all<Row>({ project_id: projectId, kind })
    .map(toRecord);
}

export function findDataConnection(db: SqlDatabase, id: string): DataConnectionRecord | null {
  const row = db.prepare('SELECT * FROM data_connections WHERE id = :id').get<Row>({ id });
  return row === undefined ? null : toRecord(row);
}

export function findDataConnectionByName(
  db: SqlDatabase,
  projectId: string,
  kind: DataConnectionKind,
  name: string
): DataConnectionRecord | null {
  const row = db
    .prepare('SELECT * FROM data_connections WHERE project_id = :project_id AND kind = :kind AND name = :name COLLATE NOCASE')
    .get<Row>({ project_id: projectId, kind, name });
  return row === undefined ? null : toRecord(row);
}

export function insertDataConnection(db: SqlDatabase, record: DataConnectionRecord): void {
  db.prepare(
    `INSERT INTO data_connections (id, project_id, environment_id, kind, name, host_display, options_json,
                                   read_only, last_connected_at, created_at, updated_at)
     VALUES (:id, :project_id, :environment_id, :kind, :name, :host_display, :options_json,
             :read_only, :last_connected_at, :created_at, :updated_at)`
  ).run({
    id: record.id,
    project_id: record.projectId,
    environment_id: record.environmentId,
    kind: record.kind,
    name: record.name,
    host_display: record.hostDisplay,
    options_json: JSON.stringify(record.options),
    read_only: record.readOnly ? 1 : 0,
    last_connected_at: record.lastConnectedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt
  });
}

export function updateDataConnection(db: SqlDatabase, record: DataConnectionRecord): void {
  db.prepare(
    `UPDATE data_connections
        SET environment_id = :environment_id, name = :name, host_display = :host_display,
            options_json = :options_json, read_only = :read_only, updated_at = :updated_at
      WHERE id = :id`
  ).run({
    id: record.id,
    environment_id: record.environmentId,
    name: record.name,
    host_display: record.hostDisplay,
    options_json: JSON.stringify(record.options),
    read_only: record.readOnly ? 1 : 0,
    updated_at: record.updatedAt
  });
}

export function touchDataConnection(db: SqlDatabase, id: string, at: string): void {
  db.prepare('UPDATE data_connections SET last_connected_at = :at WHERE id = :id').run({ id, at });
}

export function deleteDataConnection(db: SqlDatabase, id: string): number {
  return db.prepare('DELETE FROM data_connections WHERE id = :id').run({ id }).changes;
}

/** Ids of every connection of a project, to clean their secrets when the project goes. */
export function listDataConnectionIds(db: SqlDatabase, projectId: string): string[] {
  return db
    .prepare('SELECT id FROM data_connections WHERE project_id = :project_id')
    .all<{ id: string }>({ project_id: projectId })
    .map((row) => row.id);
}

// ── saved queries ──────────────────────────────────────────────────────────

interface SavedRow {
  id: string;
  connection_id: string;
  namespace: string;
  name: string;
  kind: MongoSavedQueryKind;
  body_json: string;
  created_at: string;
}

function toSaved(row: SavedRow): MongoSavedQuery {
  return {
    id: row.id,
    connectionId: row.connection_id,
    namespace: row.namespace,
    name: row.name,
    kind: row.kind,
    body: JSON.parse(row.body_json) as MongoSavedQuery['body'],
    createdAt: row.created_at
  };
}

export function listSavedQueries(db: SqlDatabase, connectionId: string, namespace: string): MongoSavedQuery[] {
  return db
    .prepare(
      'SELECT * FROM mongo_saved_queries WHERE connection_id = :connection_id AND namespace = :namespace ORDER BY name COLLATE NOCASE, id'
    )
    .all<SavedRow>({ connection_id: connectionId, namespace })
    .map(toSaved);
}

export function insertSavedQuery(db: SqlDatabase, query: MongoSavedQuery): void {
  db.prepare(
    `INSERT INTO mongo_saved_queries (id, connection_id, namespace, name, kind, body_json, created_at)
     VALUES (:id, :connection_id, :namespace, :name, :kind, :body_json, :created_at)`
  ).run({
    id: query.id,
    connection_id: query.connectionId,
    namespace: query.namespace,
    name: query.name,
    kind: query.kind,
    body_json: JSON.stringify(query.body),
    created_at: query.createdAt
  });
}

export function deleteSavedQuery(db: SqlDatabase, id: string): number {
  return db.prepare('DELETE FROM mongo_saved_queries WHERE id = :id').run({ id }).changes;
}

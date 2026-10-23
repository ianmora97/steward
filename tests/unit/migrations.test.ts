import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openStewardDatabase } from '@main/db/connection';
import { currentSchemaVersion, migrate } from '@main/db/migrate';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, type Migration } from '@main/db/migrations';
import { createTempDirectory, createTestDatabase } from '../helpers/database';

describe('migration runner', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it('applies every migration on a fresh database and records the version', () => {
    const { database, cleanup } = createTestDatabase();
    cleanups.push(cleanup);

    expect(database.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    expect(database.migration.fromVersion).toBe(0);
    expect(database.migration.applied).toEqual(MIGRATIONS.map((m) => m.version));

    const recorded = database.db
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
      .all<{ version: number; name: string }>();
    expect(recorded.map((row) => row.version)).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it('is a no-op on a second open of the same file', () => {
    const { path, cleanup } = createTempDirectory('steward-db-reopen-');
    cleanups.push(cleanup);
    const file = join(path, 'steward.sqlite');

    const first = openStewardDatabase(file);
    first.db.close();

    const second = openStewardDatabase(file);
    cleanups.push(() => second.db.close());

    expect(second.migration.applied).toEqual([]);
    expect(second.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
  });

  it('backs the file up before upgrading a database that already holds data', () => {
    const { path, cleanup } = createTempDirectory('steward-db-upgrade-');
    cleanups.push(cleanup);
    const file = join(path, 'steward.sqlite');

    const database = openStewardDatabase(file);
    cleanups.push(() => database.db.close());

    const future: Migration = {
      version: LATEST_SCHEMA_VERSION + 1,
      name: 'test_future_migration',
      sql: 'CREATE TABLE future_table (id TEXT PRIMARY KEY);'
    };

    const outcome = migrate(database.db, { filePath: file, migrations: [...MIGRATIONS, future] });

    expect(outcome.applied).toEqual([future.version]);
    expect(outcome.backupPath).toBe(`${file}.v${LATEST_SCHEMA_VERSION}.backup`);
    expect(existsSync(outcome.backupPath as string)).toBe(true);
    expect(currentSchemaVersion(database.db)).toBe(future.version);
  });

  it('leaves the schema version untouched when a migration throws', () => {
    const { database, cleanup } = createTestDatabase();
    cleanups.push(cleanup);

    const broken: Migration = {
      version: LATEST_SCHEMA_VERSION + 1,
      name: 'broken',
      sql: 'CREATE TABLE this is not valid sql;'
    };

    expect(() => migrate(database.db, { migrations: [broken] })).toThrow();
    expect(currentSchemaVersion(database.db)).toBe(LATEST_SCHEMA_VERSION);
  });

  it('refuses to write a non-integer schema version', () => {
    const { database, cleanup } = createTestDatabase();
    cleanups.push(cleanup);

    const bogus: Migration = {
      version: 1.5 as number,
      name: 'bogus',
      sql: 'SELECT 1;'
    };

    expect(() => migrate(database.db, { migrations: [bogus] })).toThrow(/non-integer schema version/);
  });

  it('enforces foreign keys, so deleting a project removes its children', () => {
    const { database, cleanup } = createTestDatabase();
    cleanups.push(cleanup);

    const enabled = database.db
      .prepare('PRAGMA foreign_keys')
      .get<{ foreign_keys: number }>();
    expect(enabled?.foreign_keys).toBe(1);

    database.db
      .prepare(
        `INSERT INTO projects (id, name, slug, description, icon, color, created_at, updated_at, archived_at)
         VALUES ('0192f0c0-0000-7000-8000-000000000001', 'P', 'p', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`
      )
      .run();

    expect(() =>
      database.db
        .prepare(
          `INSERT INTO repositories (id, project_id, name, local_path, provider, remote_name, remote_url,
                                     default_branch, role, service_name, created_at, last_opened_at)
           VALUES ('0192f0c0-0000-7000-8000-000000000002', 'missing-project', 'r', '/tmp/r', 'unknown', NULL, NULL,
                   NULL, 'primary', NULL, '2026-01-01T00:00:00.000Z', NULL)`
        )
        .run()
    ).toThrow();
  });
});

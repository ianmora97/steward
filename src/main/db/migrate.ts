import { copyFileSync, existsSync } from 'node:fs';
import type { SqlDatabase } from './driver';
import { MIGRATIONS, type Migration } from './migrations';
import { nowIso } from './id';

export interface MigrationOutcome {
  fromVersion: number;
  toVersion: number;
  applied: number[];
  backupPath: string | null;
}

function readUserVersion(db: SqlDatabase): number {
  const row = db.prepare('PRAGMA user_version').get<{ user_version: number }>();
  return row?.user_version ?? 0;
}

function writeUserVersion(db: SqlDatabase, version: number): void {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`refusing to write non-integer schema version: ${String(version)}`);
  }
  // PRAGMA values cannot be bound as parameters; the value is an integer
  // produced by this module, never user input.
  db.exec(`PRAGMA user_version = ${version}`);
}

/**
 * Applies pending migrations in order.
 *
 * Before touching a database that already carries data, the file is copied
 * alongside itself so a failed upgrade is recoverable. Each migration runs in
 * its own transaction: a throwing migration leaves the schema at the previous
 * version rather than half-applied.
 */
export function migrate(
  db: SqlDatabase,
  options: { filePath?: string; migrations?: readonly Migration[] } = {}
): MigrationOutcome {
  const migrations = [...(options.migrations ?? MIGRATIONS)].sort((a, b) => a.version - b.version);

  // Validate the set before touching the database, so a malformed migration
  // never leaves a half-upgraded file behind.
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new Error(
        `migration "${migration.name}" has a non-integer schema version: ${String(migration.version)}`
      );
    }
    if (seen.has(migration.version)) {
      throw new Error(`duplicate migration version: ${migration.version}`);
    }
    seen.add(migration.version);
  }

  const fromVersion = readUserVersion(db);
  const pending = migrations.filter((m) => m.version > fromVersion);

  if (pending.length === 0) {
    return { fromVersion, toVersion: fromVersion, applied: [], backupPath: null };
  }

  let backupPath: string | null = null;
  const filePath = options.filePath;
  if (filePath !== undefined && filePath !== ':memory:' && fromVersion > 0 && existsSync(filePath)) {
    backupPath = `${filePath}.v${fromVersion}.backup`;
    copyFileSync(filePath, backupPath);
  }

  const applied: number[] = [];
  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (:version, :name, :applied_at)'
      ).run({ version: migration.version, name: migration.name, applied_at: nowIso() });
    });
    // user_version is set outside the transaction: SQLite does not roll back
    // PRAGMA writes, so setting it only after a committed migration keeps the
    // marker and the schema in step.
    writeUserVersion(db, migration.version);
    applied.push(migration.version);
  }

  return { fromVersion, toVersion: readUserVersion(db), applied, backupPath };
}

export function currentSchemaVersion(db: SqlDatabase): number {
  return readUserVersion(db);
}

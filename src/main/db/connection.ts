import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openSqlDatabase, type SqlDatabase } from './driver';
import { currentSchemaVersion, migrate, type MigrationOutcome } from './migrate';

export interface StewardDatabase {
  db: SqlDatabase;
  filePath: string;
  schemaVersion: number;
  migration: MigrationOutcome;
}

/**
 * Opens (and if needed creates) Steward's database, applies pragmas, then runs
 * migrations. The main process owns this connection exclusively; nothing in the
 * renderer can reach SQLite.
 */
export function openStewardDatabase(filePath: string): StewardDatabase {
  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const db = openSqlDatabase(filePath);

  // Referential integrity is opt-in per connection in SQLite, so the ON DELETE
  // CASCADE rules in the schema only hold once this is on.
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (filePath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec('PRAGMA synchronous = NORMAL');

  const migration = migrate(db, { filePath });

  return { db, filePath, schemaVersion: currentSchemaVersion(db), migration };
}

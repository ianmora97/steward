import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStewardDatabase, type StewardDatabase } from '@main/db/connection';

/** An isolated on-disk database per test, so migrations and WAL behave as they do in the app. */
export function createTestDatabase(): { database: StewardDatabase; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'steward-db-'));
  const database = openStewardDatabase(join(directory, 'steward.sqlite'));

  return {
    database,
    cleanup: () => {
      try {
        database.db.close();
      } catch {
        // Already closed by the test.
      }
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

export function createTempDirectory(prefix = 'steward-tmp-'): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

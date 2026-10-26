import type { SqlDatabase } from './driver';
import { nowIso } from './id';

interface SettingRow {
  value_json: string;
}

/** The stored value for a key, or `null` when it is absent or no longer parses (the caller then uses its default). */
export function getSetting(db: SqlDatabase, key: string): unknown {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key = :key').get<SettingRow>({ key });
  if (row === undefined) return null;
  try {
    return JSON.parse(row.value_json) as unknown;
  } catch {
    return null;
  }
}

export function setSetting(db: SqlDatabase, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO app_settings (key, value_json, updated_at)
     VALUES (:key, :value_json, :updated_at)
     ON CONFLICT (key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`
  ).run({ key, value_json: JSON.stringify(value), updated_at: nowIso() });
}

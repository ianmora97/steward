import type { TerminalProfile, TerminalSettings } from '@shared/schemas/terminal';
import type { SqlDatabase } from './driver';
import { nowIso } from './id';

interface SettingsRow {
  default_profile_id: string | null;
}

interface ProfileRow {
  id: string;
  name: string;
  shell_path: string;
  shell_args_json: string;
}

function toProfile(row: ProfileRow): TerminalProfile {
  return {
    id: row.id,
    name: row.name,
    file: row.shell_path,
    args: JSON.parse(row.shell_args_json) as string[],
    kind: 'custom'
  };
}

export function getTerminalSettings(db: SqlDatabase, projectId: string): TerminalSettings {
  const row = db
    .prepare('SELECT default_profile_id FROM project_terminal_settings WHERE project_id = :project_id')
    .get<SettingsRow>({ project_id: projectId });
  return { defaultProfileId: row?.default_profile_id ?? null };
}

export function setTerminalSettings(db: SqlDatabase, projectId: string, settings: TerminalSettings): void {
  db.prepare(
    `INSERT INTO project_terminal_settings (project_id, default_profile_id, updated_at)
     VALUES (:project_id, :default_profile_id, :updated_at)
     ON CONFLICT (project_id) DO UPDATE SET
       default_profile_id = excluded.default_profile_id,
       updated_at = excluded.updated_at`
  ).run({
    project_id: projectId,
    default_profile_id: settings.defaultProfileId,
    updated_at: nowIso()
  });
}

export function listCustomProfiles(db: SqlDatabase): TerminalProfile[] {
  return db
    .prepare('SELECT id, name, shell_path, shell_args_json FROM terminal_profiles ORDER BY created_at, id')
    .all<ProfileRow>()
    .map(toProfile);
}

export function findCustomProfile(db: SqlDatabase, id: string): TerminalProfile | null {
  const row = db
    .prepare('SELECT id, name, shell_path, shell_args_json FROM terminal_profiles WHERE id = :id')
    .get<ProfileRow>({ id });
  return row === undefined ? null : toProfile(row);
}

export function insertCustomProfile(db: SqlDatabase, profile: TerminalProfile): void {
  db.prepare(
    `INSERT INTO terminal_profiles (id, name, shell_path, shell_args_json, created_at)
     VALUES (:id, :name, :shell_path, :shell_args_json, :created_at)`
  ).run({
    id: profile.id,
    name: profile.name,
    shell_path: profile.file,
    shell_args_json: JSON.stringify(profile.args),
    created_at: nowIso()
  });
}

/** Deleting a profile also clears it as any project's default, so no project points at a profile that is gone. */
export function deleteCustomProfile(db: SqlDatabase, id: string): number {
  return db.transaction(() => {
    db.prepare('UPDATE project_terminal_settings SET default_profile_id = NULL WHERE default_profile_id = :id').run({
      id
    });
    return db.prepare('DELETE FROM terminal_profiles WHERE id = :id').run({ id }).changes;
  });
}

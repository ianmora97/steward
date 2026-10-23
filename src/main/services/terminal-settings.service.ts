import type {
  TerminalDeleteProfileInput,
  TerminalGetSettingsInput,
  TerminalProfile,
  TerminalSaveProfileInput,
  TerminalSetSettingsInput,
  TerminalSettings
} from '@shared/schemas/terminal';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { uuidv7 } from '../db/id';
import {
  deleteCustomProfile,
  getTerminalSettings,
  insertCustomProfile,
  setTerminalSettings
} from '../db/terminal-settings.repo';
import { requireProject } from './project.service';
import { assertShellFile, listProfiles } from './terminal-shell';

export { listProfiles };

export function getSettings(db: SqlDatabase, input: TerminalGetSettingsInput): TerminalSettings {
  requireProject(db, input.projectId);
  return getTerminalSettings(db, input.projectId);
}

/** A null `defaultProfileId` goes back to the first detected shell. */
export function setSettings(db: SqlDatabase, input: TerminalSetSettingsInput): TerminalSettings {
  requireProject(db, input.projectId);
  if (input.defaultProfileId !== null && !listProfiles(db).some((profile) => profile.id === input.defaultProfileId)) {
    throw new StewardServiceError('NOT_FOUND', 'that shell profile no longer exists');
  }
  const settings: TerminalSettings = { defaultProfileId: input.defaultProfileId };
  setTerminalSettings(db, input.projectId, settings);
  return settings;
}

export function saveProfile(db: SqlDatabase, input: TerminalSaveProfileInput): TerminalProfile {
  assertShellFile(input.shellPath);
  const profile: TerminalProfile = {
    id: uuidv7(),
    name: input.name,
    file: input.shellPath,
    args: input.shellArgs,
    kind: 'custom'
  };
  insertCustomProfile(db, profile);
  return profile;
}

export function deleteProfile(db: SqlDatabase, input: TerminalDeleteProfileInput): null {
  if (deleteCustomProfile(db, input.profileId) === 0) {
    throw new StewardServiceError('NOT_FOUND', 'that shell profile no longer exists');
  }
  return null;
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StewardDatabase } from '@main/db/connection';
import { createProject } from '@main/services/project.service';
import { listTabs, reorderTabs, restoreDefaultTabs, setTabVisibility } from '@main/services/tab.service';
import { createTestDatabase } from '../helpers/database';

describe('workspace tabs', () => {
  let database: StewardDatabase;
  let cleanup: () => void;
  let projectId: string;

  beforeEach(() => {
    ({ database, cleanup } = createTestDatabase());
    projectId = createProject(database.db, { name: 'Workspace' }).id;
  });

  afterEach(() => cleanup());

  it('applies a complete new order', () => {
    const before = listTabs(database.db, projectId).map((tab) => tab.tabKey);
    expect(before).toEqual(['git', 'terminal', 'settings']);

    const after = reorderTabs(database.db, projectId, ['settings', 'git', 'terminal']);

    expect(after.map((tab) => tab.tabKey)).toEqual(['settings', 'git', 'terminal']);
    expect(after.map((tab) => tab.position)).toEqual([0, 1, 2]);
  });

  it('rejects a partial or duplicated order rather than merging it', () => {
    expect(() => reorderTabs(database.db, projectId, ['git'])).toThrowError(/every tab/);
    expect(() => reorderTabs(database.db, projectId, ['git', 'git', 'terminal'])).toThrowError(/duplicates/);
    expect(listTabs(database.db, projectId).map((tab) => tab.tabKey)).toEqual([
      'git',
      'terminal',
      'settings'
    ]);
  });

  it('hides and restores a tab, keeping its row so it can come back', () => {
    const hidden = setTabVisibility(database.db, projectId, 'terminal', false);
    expect(hidden.find((tab) => tab.tabKey === 'terminal')?.visible).toBe(false);
    expect(hidden).toHaveLength(3);

    const restored = setTabVisibility(database.db, projectId, 'terminal', true);
    expect(restored.find((tab) => tab.tabKey === 'terminal')?.visible).toBe(true);
  });

  it('refuses to hide the Git tab', () => {
    expect(() => setTabVisibility(database.db, projectId, 'git', false)).toThrowError(/cannot be hidden/);
    expect(listTabs(database.db, projectId).find((tab) => tab.tabKey === 'git')?.visible).toBe(true);
  });

  it('reports a tab that does not belong to the project', () => {
    expect(() => setTabVisibility(database.db, projectId, 'actions', false)).toThrowError(/does not exist/);
  });

  it('restores the default set and order', () => {
    reorderTabs(database.db, projectId, ['settings', 'terminal', 'git']);
    setTabVisibility(database.db, projectId, 'terminal', false);

    const restored = restoreDefaultTabs(database.db, projectId);

    expect(restored.map((tab) => tab.tabKey)).toEqual(['git', 'terminal', 'settings']);
    expect(restored.every((tab) => tab.visible)).toBe(true);
  });
});

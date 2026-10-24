import { PINNED_TAB_KEYS, type TabKey, type WorkspaceTab } from '@shared/schemas/tabs';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { nowIso, uuidv7 } from '../db/id';
import { findIntegrationByProject } from '../db/integration.repo';
import {
  deleteTabsByProject,
  insertTab,
  listTabsByProject,
  setTabIntegration,
  updateTabPosition,
  updateTabVisibility
} from '../db/tab.repo';

/**
 * Tab layout is per-project user preference, stored as rows.
 *
 * The Git tab is seeded first for every new project. Later milestones insert
 * their tabs when the matching integration is configured, which is why the
 * default set here is only what Milestone 1 can actually show.
 */
interface TabDefinition {
  tabKey: TabKey;
  pinned: boolean;
}

const DEFAULT_TABS: readonly TabDefinition[] = [
  { tabKey: 'git', pinned: true },
  { tabKey: 'terminal', pinned: false },
  { tabKey: 'ssh', pinned: false },
  { tabKey: 'github', pinned: false },
  { tabKey: 'deployments', pinned: false },
  { tabKey: 'docker', pinned: false },
  { tabKey: 'settings', pinned: false }
];

export function seedDefaultTabs(db: SqlDatabase, projectId: string): WorkspaceTab[] {
  const updatedAt = nowIso();
  return DEFAULT_TABS.map((definition, index) =>
    insertTab(db, {
      id: uuidv7(),
      projectId,
      tabKey: definition.tabKey,
      position: index,
      visible: true,
      pinned: definition.pinned,
      source: 'builtin',
      integrationId: null,
      updatedAt
    })
  );
}

export function listTabs(db: SqlDatabase, projectId: string): WorkspaceTab[] {
  return listTabsByProject(db, projectId);
}

/**
 * Applies a complete ordering. A partial list is rejected rather than merged,
 * because merging a stale list is how tab order silently drifts.
 */
export function reorderTabs(db: SqlDatabase, projectId: string, orderedTabKeys: TabKey[]): WorkspaceTab[] {
  const existing = listTabsByProject(db, projectId);
  if (existing.length === 0) {
    throw new StewardServiceError('NOT_FOUND', 'that project has no tabs to reorder');
  }

  const existingKeys = new Set(existing.map((tab) => tab.tabKey));
  const requestedKeys = new Set(orderedTabKeys);

  if (requestedKeys.size !== orderedTabKeys.length) {
    throw new StewardServiceError('VALIDATION_FAILED', 'the tab order contains duplicates');
  }
  if (requestedKeys.size !== existingKeys.size || [...existingKeys].some((key) => !requestedKeys.has(key))) {
    throw new StewardServiceError(
      'VALIDATION_FAILED',
      'the tab order must list every tab of this project exactly once'
    );
  }

  const updatedAt = nowIso();
  db.transaction(() => {
    orderedTabKeys.forEach((tabKey, index) => {
      updateTabPosition(db, projectId, tabKey, index, updatedAt);
    });
  });

  return listTabsByProject(db, projectId);
}

export function setTabVisibility(
  db: SqlDatabase,
  projectId: string,
  tabKey: TabKey,
  visible: boolean
): WorkspaceTab[] {
  if (!visible && PINNED_TAB_KEYS.includes(tabKey)) {
    throw new StewardServiceError(
      'CONFLICT',
      'the Git tab cannot be hidden',
      'Git is the one tab every project keeps. It can be reordered but not removed.'
    );
  }

  const changes = updateTabVisibility(db, projectId, tabKey, visible, nowIso());
  if (changes === 0) {
    throw new StewardServiceError('NOT_FOUND', 'that tab does not exist in this project');
  }

  return listTabsByProject(db, projectId);
}

/** Restores the default set and order, bringing back anything the user hid. */
export function restoreDefaultTabs(db: SqlDatabase, projectId: string): WorkspaceTab[] {
  return db.transaction(() => {
    deleteTabsByProject(db, projectId);
    seedDefaultTabs(db, projectId);
    // The defaults know nothing about integrations; without this a connected GitHub would lose its tab.
    const github = findIntegrationByProject(db, projectId, 'github');
    return github === null ? listTabsByProject(db, projectId) : attachIntegrationTab(db, projectId, 'github', github.id);
  });
}

/** Adds the tab a connected integration provides, or brings back one the user hid. */
export function attachIntegrationTab(
  db: SqlDatabase,
  projectId: string,
  tabKey: TabKey,
  integrationId: string
): WorkspaceTab[] {
  const existing = listTabsByProject(db, projectId);
  const updatedAt = nowIso();
  if (existing.some((tab) => tab.tabKey === tabKey)) {
    updateTabVisibility(db, projectId, tabKey, true, updatedAt);
    setTabIntegration(db, projectId, tabKey, integrationId, updatedAt);
  } else {
    insertTab(db, {
      id: uuidv7(),
      projectId,
      tabKey,
      position: existing.reduce((max, tab) => Math.max(max, tab.position), -1) + 1,
      visible: true,
      pinned: false,
      source: 'integration',
      integrationId,
      updatedAt
    });
  }
  return listTabsByProject(db, projectId);
}

/**
 * Unlinks the tab from its integration but leaves it visible: the tab holds the
 * connect form, so hiding it on disconnect would leave no way to reconnect.
 */
export function detachIntegrationTab(db: SqlDatabase, projectId: string, tabKey: TabKey): WorkspaceTab[] {
  setTabIntegration(db, projectId, tabKey, null, nowIso());
  return listTabsByProject(db, projectId);
}

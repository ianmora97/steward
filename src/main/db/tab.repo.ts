import type { TabKey, TabSource, WorkspaceTab } from '@shared/schemas/tabs';
import type { SqlDatabase } from './driver';

interface WorkspaceTabRow {
  id: string;
  project_id: string;
  tab_key: TabKey;
  position: number;
  visible: number;
  pinned: number;
  source: TabSource;
  integration_id: string | null;
  updated_at: string;
}

function toTab(row: WorkspaceTabRow): WorkspaceTab {
  return {
    id: row.id,
    projectId: row.project_id,
    tabKey: row.tab_key,
    position: row.position,
    visible: row.visible === 1,
    pinned: row.pinned === 1,
    source: row.source,
    integrationId: row.integration_id,
    updatedAt: row.updated_at
  };
}

export function insertTab(db: SqlDatabase, tab: WorkspaceTab): WorkspaceTab {
  db.prepare(
    `INSERT INTO workspace_tabs (id, project_id, tab_key, position, visible, pinned, source, integration_id, updated_at)
     VALUES (:id, :project_id, :tab_key, :position, :visible, :pinned, :source, :integration_id, :updated_at)`
  ).run({
    id: tab.id,
    project_id: tab.projectId,
    tab_key: tab.tabKey,
    position: tab.position,
    visible: tab.visible ? 1 : 0,
    pinned: tab.pinned ? 1 : 0,
    source: tab.source,
    integration_id: tab.integrationId,
    updated_at: tab.updatedAt
  });
  return tab;
}

export function listTabsByProject(db: SqlDatabase, projectId: string): WorkspaceTab[] {
  return db
    .prepare('SELECT * FROM workspace_tabs WHERE project_id = :project_id ORDER BY position')
    .all<WorkspaceTabRow>({ project_id: projectId })
    .map(toTab);
}

export function updateTabPosition(
  db: SqlDatabase,
  projectId: string,
  tabKey: TabKey,
  position: number,
  updatedAt: string
): void {
  db.prepare(
    `UPDATE workspace_tabs SET position = :position, updated_at = :updated_at
      WHERE project_id = :project_id AND tab_key = :tab_key`
  ).run({ project_id: projectId, tab_key: tabKey, position, updated_at: updatedAt });
}

export function updateTabVisibility(
  db: SqlDatabase,
  projectId: string,
  tabKey: TabKey,
  visible: boolean,
  updatedAt: string
): number {
  return db
    .prepare(
      `UPDATE workspace_tabs SET visible = :visible, updated_at = :updated_at
        WHERE project_id = :project_id AND tab_key = :tab_key`
    )
    .run({ project_id: projectId, tab_key: tabKey, visible: visible ? 1 : 0, updated_at: updatedAt })
    .changes;
}

export function deleteTabsByProject(db: SqlDatabase, projectId: string): number {
  return db.prepare('DELETE FROM workspace_tabs WHERE project_id = :project_id').run({
    project_id: projectId
  }).changes;
}

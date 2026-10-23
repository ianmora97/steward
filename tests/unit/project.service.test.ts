import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listTabsByProject } from '@main/db/tab.repo';
import {
  createProject,
  deleteProject,
  getProjects,
  setProjectArchived,
  updateProject
} from '@main/services/project.service';
import type { StewardDatabase } from '@main/db/connection';
import { createTestDatabase } from '../helpers/database';

describe('project service', () => {
  let database: StewardDatabase;
  let cleanup: () => void;

  beforeEach(() => {
    ({ database, cleanup } = createTestDatabase());
  });

  afterEach(() => cleanup());

  it('creates a project and seeds the Git tab first', () => {
    const project = createProject(database.db, { name: 'Billing Platform' });

    expect(project.slug).toBe('billing-platform');
    expect(project.archivedAt).toBeNull();
    expect(project.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const tabs = listTabsByProject(database.db, project.id);
    expect(tabs[0]?.tabKey).toBe('git');
    expect(tabs[0]?.position).toBe(0);
    expect(tabs[0]?.pinned).toBe(true);
    expect(tabs.every((tab) => tab.visible)).toBe(true);
  });

  it('keeps slugs unique across projects with the same name', () => {
    const first = createProject(database.db, { name: 'Checkout' });
    const second = createProject(database.db, { name: 'Checkout' });
    const third = createProject(database.db, { name: 'Checkout' });

    expect([first.slug, second.slug, third.slug]).toEqual(['checkout', 'checkout-2', 'checkout-3']);
  });

  it('lists only active projects unless archived ones are requested', () => {
    const kept = createProject(database.db, { name: 'Kept' });
    const archived = createProject(database.db, { name: 'Archived' });
    setProjectArchived(database.db, archived.id, true);

    expect(getProjects(database.db).map((p) => p.id)).toEqual([kept.id]);
    expect(getProjects(database.db, true).map((p) => p.id).sort()).toEqual([archived.id, kept.id].sort());

    const restored = setProjectArchived(database.db, archived.id, false);
    expect(restored.archivedAt).toBeNull();
  });

  it('updates a project and re-slugs only when the name changes', () => {
    const project = createProject(database.db, { name: 'Gateway' });

    const described = updateProject(database.db, { id: project.id, description: 'Edge routing' });
    expect(described.slug).toBe('gateway');
    expect(described.description).toBe('Edge routing');

    const renamed = updateProject(database.db, { id: project.id, name: 'Edge Gateway' });
    expect(renamed.slug).toBe('edge-gateway');
  });

  it('reports a missing project instead of failing silently', () => {
    const missing = '0192f0c0-dead-7000-8000-000000000000';
    expect(() => updateProject(database.db, { id: missing, name: 'X' })).toThrowError(/no longer exists/);
    expect(() => deleteProject(database.db, missing)).toThrowError(/no longer exists/);
  });

  it('cascades deletion to the project tab layout', () => {
    const project = createProject(database.db, { name: 'Temporary' });
    expect(listTabsByProject(database.db, project.id).length).toBeGreaterThan(0);

    deleteProject(database.db, project.id);

    expect(listTabsByProject(database.db, project.id)).toEqual([]);
    expect(getProjects(database.db, true)).toEqual([]);
  });
});

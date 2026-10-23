import type { CreateProjectInput, Project, UpdateProjectInput } from '@shared/schemas/project';
import { slugify } from '@shared/schemas/common';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { nowIso, uuidv7 } from '../db/id';
import {
  deleteProjectRow,
  findProjectById,
  findProjectBySlug,
  insertProject,
  listProjects,
  setProjectArchivedAt,
  updateProjectRow
} from '../db/project.repo';
import { seedDefaultTabs } from './tab.service';

/**
 * A project is Steward's aggregate root: it owns repositories, workspace tabs
 * and — from later milestones — integrations, environments and execution
 * history. Everything scoped to a project is reached through its id.
 */
function uniqueSlug(db: SqlDatabase, name: string, excludeProjectId?: string): string {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;

  for (;;) {
    const existing = findProjectBySlug(db, candidate);
    if (existing === null || existing.id === excludeProjectId) return candidate;
    candidate = `${base}-${suffix}`.slice(0, 64).replace(/-+$/, '');
    suffix += 1;
    if (suffix > 1000) {
      throw new StewardServiceError('CONFLICT', 'could not derive a unique identifier for that name');
    }
  }
}

export function createProject(db: SqlDatabase, input: CreateProjectInput): Project {
  const timestamp = nowIso();
  const name = input.name.trim();

  return db.transaction(() => {
    const project: Project = {
      id: uuidv7(),
      name,
      slug: uniqueSlug(db, name),
      description: input.description ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null
    };

    insertProject(db, project);
    // Every new project gets the Git tab first. This is part of creating a
    // project, not a separate step a caller can forget.
    seedDefaultTabs(db, project.id);
    return project;
  });
}

export function getProjects(db: SqlDatabase, includeArchived = false): Project[] {
  return listProjects(db, includeArchived);
}

export function requireProject(db: SqlDatabase, id: string): Project {
  const project = findProjectById(db, id);
  if (project === null) {
    throw new StewardServiceError('NOT_FOUND', 'that project no longer exists');
  }
  return project;
}

export function updateProject(db: SqlDatabase, input: UpdateProjectInput): Project {
  const current = requireProject(db, input.id);
  const name = input.name === undefined ? current.name : input.name.trim();

  updateProjectRow(db, current.id, {
    name,
    slug: name === current.name ? current.slug : uniqueSlug(db, name, current.id),
    description: input.description === undefined ? current.description : input.description,
    icon: input.icon === undefined ? current.icon : input.icon,
    color: input.color === undefined ? current.color : input.color,
    updatedAt: nowIso()
  });

  return requireProject(db, current.id);
}

export function setProjectArchived(db: SqlDatabase, id: string, archived: boolean): Project {
  requireProject(db, id);
  setProjectArchivedAt(db, id, archived ? nowIso() : null, nowIso());
  return requireProject(db, id);
}

/**
 * Deletes a project and, by cascade, its repositories and tab layout. The
 * repositories' working copies on disk are never touched: Steward removes its
 * own records, not the user's code.
 */
export function deleteProject(db: SqlDatabase, id: string): { id: string } {
  requireProject(db, id);
  const changes = deleteProjectRow(db, id);
  if (changes === 0) {
    throw new StewardServiceError('NOT_FOUND', 'that project no longer exists');
  }
  return { id };
}

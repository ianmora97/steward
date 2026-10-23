import type { Project } from '@shared/schemas/project';
import type { SqlDatabase } from './driver';

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

export function insertProject(db: SqlDatabase, project: Project): Project {
  db.prepare(
    `INSERT INTO projects (id, name, slug, description, icon, color, created_at, updated_at, archived_at)
     VALUES (:id, :name, :slug, :description, :icon, :color, :created_at, :updated_at, :archived_at)`
  ).run({
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    icon: project.icon,
    color: project.color,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
    archived_at: project.archivedAt
  });
  return project;
}

export function listProjects(db: SqlDatabase, includeArchived: boolean): Project[] {
  const sql = includeArchived
    ? 'SELECT * FROM projects ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE'
    : 'SELECT * FROM projects WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE';
  return db.prepare(sql).all<ProjectRow>().map(toProject);
}

export function findProjectById(db: SqlDatabase, id: string): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = :id').get<ProjectRow>({ id });
  return row === undefined ? null : toProject(row);
}

export function findProjectBySlug(db: SqlDatabase, slug: string): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE slug = :slug').get<ProjectRow>({ slug });
  return row === undefined ? null : toProject(row);
}

export function updateProjectRow(
  db: SqlDatabase,
  id: string,
  fields: Pick<Project, 'name' | 'slug' | 'description' | 'icon' | 'color' | 'updatedAt'>
): void {
  db.prepare(
    `UPDATE projects
        SET name = :name, slug = :slug, description = :description,
            icon = :icon, color = :color, updated_at = :updated_at
      WHERE id = :id`
  ).run({
    id,
    name: fields.name,
    slug: fields.slug,
    description: fields.description,
    icon: fields.icon,
    color: fields.color,
    updated_at: fields.updatedAt
  });
}

export function setProjectArchivedAt(
  db: SqlDatabase,
  id: string,
  archivedAt: string | null,
  updatedAt: string
): void {
  db.prepare(
    'UPDATE projects SET archived_at = :archived_at, updated_at = :updated_at WHERE id = :id'
  ).run({ id, archived_at: archivedAt, updated_at: updatedAt });
}

export function deleteProjectRow(db: SqlDatabase, id: string): number {
  return db.prepare('DELETE FROM projects WHERE id = :id').run({ id }).changes;
}

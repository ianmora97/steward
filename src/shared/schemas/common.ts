import { z } from 'zod';

/** UUID v7 in canonical form. Ids are generated in the main process only. */
export const idSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'must be a UUID');

export const isoTimestampSchema = z.string().min(20).max(30);

export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase words separated by single hyphens');

export const displayNameSchema = z.string().trim().min(1, 'name is required').max(120);

/**
 * An absolute filesystem path. Shape only: existence, traversal and work-tree
 * checks happen in the main process (src/main/security/paths.ts), because the
 * renderer must never be the authority on what is reachable on disk.
 */
export const absolutePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(value), 'must be an absolute path');

export const emptyPayloadSchema = z.object({});

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return slug.length > 0 ? slug : 'project';
}

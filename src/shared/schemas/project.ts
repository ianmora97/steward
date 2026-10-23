import { z } from 'zod';
import { displayNameSchema, idSchema, isoTimestampSchema, slugSchema } from './common';

export const projectSchema = z.object({
  id: idSchema,
  name: displayNameSchema,
  slug: slugSchema,
  description: z.string().max(2000).nullable(),
  icon: z.string().max(32).nullable(),
  color: z.string().max(32).nullable(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
  archivedAt: isoTimestampSchema.nullable()
});

export const createProjectInputSchema = z.object({
  name: displayNameSchema,
  description: z.string().max(2000).optional(),
  icon: z.string().max(32).optional(),
  color: z.string().max(32).optional()
});

export const updateProjectInputSchema = z.object({
  id: idSchema,
  name: displayNameSchema.optional(),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().max(32).nullable().optional(),
  color: z.string().max(32).nullable().optional()
});

export const projectIdPayloadSchema = z.object({ id: idSchema });

export const listProjectsInputSchema = z.object({ includeArchived: z.boolean().optional() });

export type Project = z.infer<typeof projectSchema>;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
export type ListProjectsInput = z.infer<typeof listProjectsInputSchema>;

import { z } from 'zod';
import { absolutePathSchema, displayNameSchema, idSchema, isoTimestampSchema } from './common';

/**
 * A project owns many repositories. `role` and `serviceName` exist because one
 * project is not one repository and not one deployable: a project may hold a
 * web app, an API and infrastructure repositories side by side.
 */
export const repositoryRoleSchema = z.enum(['primary', 'service', 'infra', 'docs']);

export const providerSchema = z.enum(['github', 'other', 'unknown']);

export const repositorySchema = z.object({
  id: idSchema,
  projectId: idSchema,
  name: displayNameSchema,
  localPath: z.string(),
  provider: providerSchema,
  remoteName: z.string().max(120).nullable(),
  remoteUrl: z.string().max(2048).nullable(),
  defaultBranch: z.string().max(255).nullable(),
  role: repositoryRoleSchema,
  serviceName: z.string().max(120).nullable(),
  createdAt: isoTimestampSchema,
  lastOpenedAt: isoTimestampSchema.nullable()
});

export const addRepositoryInputSchema = z.object({
  projectId: idSchema,
  localPath: absolutePathSchema,
  name: displayNameSchema.optional(),
  role: repositoryRoleSchema.optional(),
  serviceName: z.string().max(120).optional()
});

export const repositoryIdPayloadSchema = z.object({ id: idSchema });

export const listRepositoriesInputSchema = z.object({ projectId: idSchema });

export const validateRepositoryPathInputSchema = z.object({ localPath: absolutePathSchema });

/**
 * Result of inspecting a candidate folder. `isGitRepository: false` is a normal,
 * reportable outcome rendered in the UI, not an error condition.
 */
export const repositoryProbeSchema = z.object({
  localPath: z.string(),
  exists: z.boolean(),
  isDirectory: z.boolean(),
  isGitRepository: z.boolean(),
  isBare: z.boolean(),
  workTreeRoot: z.string().nullable(),
  currentBranch: z.string().nullable(),
  detachedHead: z.boolean(),
  remoteName: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  provider: providerSchema,
  reason: z.string().nullable()
});

export type Repository = z.infer<typeof repositorySchema>;
export type RepositoryRole = z.infer<typeof repositoryRoleSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type AddRepositoryInput = z.infer<typeof addRepositoryInputSchema>;
export type ListRepositoriesInput = z.infer<typeof listRepositoriesInputSchema>;
export type RepositoryProbe = z.infer<typeof repositoryProbeSchema>;

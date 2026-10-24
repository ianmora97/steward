import { z } from 'zod';
import { displayNameSchema, idSchema, isoTimestampSchema } from './common';

export const ENVIRONMENT_KINDS = ['development', 'staging', 'production', 'custom'] as const;

export const environmentKindSchema = z.enum(ENVIRONMENT_KINDS);

export const environmentSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  key: z.string(),
  name: z.string(),
  kind: environmentKindSchema,
  /** Position in the project's own ordering (production first by default). */
  rank: z.number().int().min(0),
  /** A protected environment makes every deploy to it require typing its name. */
  isProtected: z.boolean(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema
});

export const environmentListInputSchema = z.object({ projectId: idSchema });

export const environmentCreateInputSchema = z.object({
  projectId: idSchema,
  name: displayNameSchema,
  kind: environmentKindSchema,
  isProtected: z.boolean()
});

export const environmentUpdateInputSchema = z.object({
  id: idSchema,
  name: displayNameSchema,
  kind: environmentKindSchema,
  isProtected: z.boolean(),
  /** Lowering protection weakens a guard, so main refuses it unless the user confirmed. */
  confirmed: z.boolean()
});

export const environmentReorderInputSchema = z.object({
  projectId: idSchema,
  /** The project's full ordering; a partial list is rejected so order cannot drift. */
  orderedIds: z.array(idSchema).min(1).max(100)
});

export const environmentIdInputSchema = z.object({ id: idSchema });

export type EnvironmentKind = z.infer<typeof environmentKindSchema>;
export type Environment = z.infer<typeof environmentSchema>;
export type EnvironmentListInput = z.infer<typeof environmentListInputSchema>;
export type EnvironmentCreateInput = z.infer<typeof environmentCreateInputSchema>;
export type EnvironmentUpdateInput = z.infer<typeof environmentUpdateInputSchema>;
export type EnvironmentReorderInput = z.infer<typeof environmentReorderInputSchema>;
export type EnvironmentIdInput = z.infer<typeof environmentIdInputSchema>;

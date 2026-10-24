import { z } from 'zod';
import { isValidGitRefName } from '../git-ref';
import { displayNameSchema, idSchema, isoTimestampSchema } from './common';
import { SSH_COMMAND_MAX_CHARS, SSH_COMMAND_MAX_TIMEOUT_SECONDS } from './ssh';

export const DEPLOY_TARGET_KINDS = ['ssh_command', 'github_workflow_dispatch'] as const;

/** A deploy can take minutes, so the target's own default is longer than a one-off command's. */
export const SSH_TARGET_DEFAULT_TIMEOUT_SECONDS = 120;

export const gitRefNameSchema = z
  .string()
  .trim()
  .refine(isValidGitRefName, 'not a valid branch or tag name');

export const sshTargetConfigSchema = z.object({
  /** Fixed when the target is created; deploying only confirms it. Stored as plain text: no secrets in here. */
  command: z
    .string()
    .max(SSH_COMMAND_MAX_CHARS)
    .refine((value) => value.trim() !== '', 'a command is required'),
  remoteDir: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => !value.includes('\0'), 'the directory cannot contain null bytes')
    .nullable(),
  timeoutSeconds: z.number().int().min(1).max(SSH_COMMAND_MAX_TIMEOUT_SECONDS)
});

/** Only files under .github/workflows, so the path cannot be used to read anything else in the repository. */
export const workflowPathSchema = z
  .string()
  .trim()
  .regex(/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/, 'not a workflow file path');

export const dispatchTargetConfigSchema = z.object({
  workflowId: z.number().int().positive(),
  workflowPath: workflowPathSchema,
  defaultRef: gitRefNameSchema
});

const targetFields = {
  environmentId: idSchema,
  name: displayNameSchema,
  requiresConfirmation: z.boolean()
};

const sshTargetBody = z.object({
  ...targetFields,
  kind: z.literal('ssh_command'),
  sshHostId: idSchema,
  config: sshTargetConfigSchema
});

const dispatchTargetBody = z.object({
  ...targetFields,
  kind: z.literal('github_workflow_dispatch'),
  repositoryId: idSchema,
  config: dispatchTargetConfigSchema
});

export const deployTargetCreateInputSchema = z.discriminatedUnion('kind', [
  sshTargetBody.extend({ projectId: idSchema }),
  dispatchTargetBody.extend({ projectId: idSchema })
]);

/** The kind cannot change: a different kind is a different target. */
export const deployTargetUpdateInputSchema = z.discriminatedUnion('kind', [
  sshTargetBody.extend({ id: idSchema }),
  dispatchTargetBody.extend({ id: idSchema })
]);

const viewFields = {
  id: idSchema,
  projectId: idSchema,
  environmentId: idSchema,
  name: z.string(),
  requiresConfirmation: z.boolean(),
  /** The server or repository it pointed at was deleted: it can be edited or deleted, never deployed. */
  broken: z.boolean(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema
};

export const deployTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    ...viewFields,
    kind: z.literal('ssh_command'),
    sshHostId: idSchema.nullable(),
    config: sshTargetConfigSchema
  }),
  z.object({
    ...viewFields,
    kind: z.literal('github_workflow_dispatch'),
    repositoryId: idSchema.nullable(),
    config: dispatchTargetConfigSchema
  })
]);

export const deployTargetListInputSchema = z.object({ projectId: idSchema });
export const deployTargetIdInputSchema = z.object({ id: idSchema });

export type DeployTargetKind = (typeof DEPLOY_TARGET_KINDS)[number];
export type SshTargetConfig = z.infer<typeof sshTargetConfigSchema>;
export type DispatchTargetConfig = z.infer<typeof dispatchTargetConfigSchema>;
export type DeployTarget = z.infer<typeof deployTargetSchema>;
export type DeployTargetCreateInput = z.infer<typeof deployTargetCreateInputSchema>;
export type DeployTargetUpdateInput = z.infer<typeof deployTargetUpdateInputSchema>;
export type DeployTargetListInput = z.infer<typeof deployTargetListInputSchema>;
export type DeployTargetIdInput = z.infer<typeof deployTargetIdInputSchema>;

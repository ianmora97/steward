import { z } from 'zod';
import { idSchema, isoTimestampSchema } from './common';
import { DEPLOY_TARGET_KINDS, gitRefNameSchema, workflowPathSchema } from './deploy-targets';

export const DEPLOYMENT_STATUSES = [
  'requested',
  'in_progress',
  'succeeded',
  'failed',
  'cancelled',
  'unknown'
] as const;

export const deploymentStatusSchema = z.enum(DEPLOYMENT_STATUSES);

/**
 * What made Steward sure of the outcome. It stays null while a deployment is
 * running and when the result is `unknown`: nothing vouches for it yet.
 */
export const deploymentSourceSchema = z.enum(['provider', 'exit_code']);

export const deploymentSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  environmentId: idSchema,
  environmentName: z.string(),
  /** Null once the target was deleted; the history keeps the name it had. */
  deployTargetId: idSchema.nullable(),
  targetName: z.string(),
  targetKind: z.enum(DEPLOY_TARGET_KINDS),
  /** The repository a workflow deploy ran in; null for SSH deploys and after the repository is removed. */
  repositoryId: idSchema.nullable(),
  executionId: idSchema.nullable(),
  ref: z.string().nullable(),
  commitSha: z.string().nullable(),
  status: deploymentStatusSchema,
  statusSource: deploymentSourceSchema.nullable(),
  runId: z.number().int().nullable(),
  runUrl: z.string().nullable(),
  requestedAt: isoTimestampSchema,
  finishedAt: isoTimestampSchema.nullable(),
  notes: z.string().nullable()
});

export const WORKFLOW_INPUT_NAME = /^[A-Za-z0-9_-]{1,100}$/;
export const WORKFLOW_INPUT_MAX_COUNT = 25;
export const WORKFLOW_INPUT_MAX_CHARS = 2000;

export const deploymentStartInputSchema = z.object({
  targetId: idSchema,
  /** Workflow deploys only; null uses the target's default. */
  ref: gitRefNameSchema.nullable(),
  /** Workflow inputs by name, always strings (GitHub sends booleans as "true" / "false"). */
  inputs: z
    .record(z.string().regex(WORKFLOW_INPUT_NAME), z.string().max(WORKFLOW_INPUT_MAX_CHARS))
    .refine((values) => Object.keys(values).length <= WORKFLOW_INPUT_MAX_COUNT, 'too many inputs'),
  /** Enough for a target that asks for confirmation in an unprotected environment. */
  confirmed: z.boolean(),
  /** Required for a protected environment: the name typed exactly as the environment is called. */
  confirmation: z.object({ environmentName: z.string().max(200) }).nullable()
});

export const workflowInputSpecSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  required: z.boolean(),
  /** What the form shows: GitHub's own input types, anything it adds later reads as text. */
  type: z.enum(['string', 'boolean', 'choice', 'number', 'environment']),
  default: z.string().nullable(),
  options: z.array(z.string())
});

export const deploymentWorkflowInputsInputSchema = z.object({
  projectId: idSchema,
  repositoryId: idSchema,
  workflowPath: workflowPathSchema,
  ref: gitRefNameSchema
});

export const deploymentListInputSchema = z.object({
  projectId: idSchema,
  limit: z.number().int().min(1).max(200)
});

export const deploymentIdInputSchema = z.object({ id: idSchema });

export const deploymentLogSchema = z.object({
  text: z.string(),
  /** The log was longer than what is shown; only its end is returned. */
  truncated: z.boolean()
});

export type DeploymentStatus = z.infer<typeof deploymentStatusSchema>;
export type DeploymentSource = z.infer<typeof deploymentSourceSchema>;
export type Deployment = z.infer<typeof deploymentSchema>;
export type DeploymentStartInput = z.infer<typeof deploymentStartInputSchema>;
export type WorkflowInputSpec = z.infer<typeof workflowInputSpecSchema>;
export type DeploymentWorkflowInputsInput = z.infer<typeof deploymentWorkflowInputsInputSchema>;
export type DeploymentListInput = z.infer<typeof deploymentListInputSchema>;
export type DeploymentIdInput = z.infer<typeof deploymentIdInputSchema>;
export type DeploymentLog = z.infer<typeof deploymentLogSchema>;

import { z } from 'zod';
import { idSchema, isoTimestampSchema } from './common';

export const githubConnectionStatusSchema = z.enum(['unconfigured', 'connected', 'auth_error', 'unreachable']);
export type GithubConnectionStatus = z.infer<typeof githubConnectionStatusSchema>;

/** What the renderer may know about a connection. The token is never part of it. */
export const githubIntegrationSchema = z.object({
  projectId: idSchema,
  status: githubConnectionStatusSchema,
  login: z.string().nullable(),
  scopes: z.array(z.string()),
  checkedAt: isoTimestampSchema.nullable(),
  lastError: z.string().nullable()
});
export type GithubIntegration = z.infer<typeof githubIntegrationSchema>;

export const githubConnectInputSchema = z.object({
  projectId: idSchema,
  token: z
    .string()
    .trim()
    .min(20, 'that does not look like a GitHub token')
    .max(255)
    .regex(/^\S+$/, 'a token has no spaces')
});
export type GithubConnectInput = z.infer<typeof githubConnectInputSchema>;

export const githubProjectInputSchema = z.object({ projectId: idSchema });
export type GithubProjectInput = z.infer<typeof githubProjectInputSchema>;

export const githubPullStateSchema = z.enum(['open', 'closed', 'all']);
export type GithubPullState = z.infer<typeof githubPullStateSchema>;

export const githubPullSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  /** Null when the author's account was deleted. */
  author: z.string().nullable(),
  headRef: z.string(),
  baseRef: z.string(),
  draft: z.boolean(),
  state: z.enum(['open', 'closed', 'merged']),
  url: z.string(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema
});
export type GithubPull = z.infer<typeof githubPullSchema>;

export const githubPullPageSchema = z.object({
  items: z.array(githubPullSchema),
  page: z.number().int().min(1),
  hasNext: z.boolean()
});
export type GithubPullPage = z.infer<typeof githubPullPageSchema>;

const branchNameSchema = z.string().trim().min(1).max(255);

export const githubListPullsInputSchema = z.object({
  projectId: idSchema,
  repositoryId: idSchema,
  state: githubPullStateSchema.default('open'),
  page: z.number().int().min(1).max(1000).default(1)
});
export type GithubListPullsInput = z.input<typeof githubListPullsInputSchema>;

export const githubListBranchesInputSchema = z.object({ projectId: idSchema, repositoryId: idSchema });
export type GithubListBranchesInput = z.infer<typeof githubListBranchesInputSchema>;

export const githubBranchListSchema = z.object({
  names: z.array(z.string()),
  defaultBranch: z.string()
});
export type GithubBranchList = z.infer<typeof githubBranchListSchema>;

/** Creating a PR publishes to GitHub, so it needs the explicit confirmation flag like the destructive Git actions. */
export const githubCreatePullInputSchema = z
  .object({
    projectId: idSchema,
    repositoryId: idSchema,
    base: branchNameSchema,
    head: branchNameSchema,
    title: z.string().trim().min(1, 'a title is required').max(256),
    body: z.string().max(65536),
    draft: z.boolean(),
    confirmed: z.literal(true)
  })
  .refine((input) => input.base !== input.head, { message: 'base and head must be different', path: ['head'] });
export type GithubCreatePullInput = z.infer<typeof githubCreatePullInputSchema>;

export const githubCreatedPullSchema = z.object({ number: z.number().int(), url: z.string() });
export type GithubCreatedPull = z.infer<typeof githubCreatedPullSchema>;

export const githubOpenUrlInputSchema = z.object({ url: z.string().max(2048) });
export type GithubOpenUrlInput = z.infer<typeof githubOpenUrlInputSchema>;

export const githubRepositoryInputSchema = z.object({ projectId: idSchema, repositoryId: idSchema });
export type GithubRepositoryInput = z.infer<typeof githubRepositoryInputSchema>;

export const githubWorkflowSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  path: z.string(),
  state: z.string()
});
export type GithubWorkflow = z.infer<typeof githubWorkflowSchema>;

/** `status` and `conclusion` stay free strings: GitHub adds values over time and an unknown one must not break the list. */
export const githubRunSchema = z.object({
  id: z.number().int(),
  runNumber: z.number().int(),
  title: z.string(),
  workflowId: z.number().int(),
  workflowName: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  event: z.string(),
  branch: z.string().nullable(),
  sha: z.string(),
  actor: z.string().nullable(),
  url: z.string(),
  createdAt: isoTimestampSchema,
  startedAt: isoTimestampSchema.nullable(),
  updatedAt: isoTimestampSchema
});
export type GithubRun = z.infer<typeof githubRunSchema>;

export const githubRunPageSchema = z.object({
  items: z.array(githubRunSchema),
  page: z.number().int().min(1),
  hasNext: z.boolean()
});
export type GithubRunPage = z.infer<typeof githubRunPageSchema>;

export const githubStepSchema = z.object({
  number: z.number().int(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable()
});
export type GithubStep = z.infer<typeof githubStepSchema>;

export const githubJobSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  startedAt: isoTimestampSchema.nullable(),
  completedAt: isoTimestampSchema.nullable(),
  url: z.string(),
  steps: z.array(githubStepSchema)
});
export type GithubJob = z.infer<typeof githubJobSchema>;

export const githubJobLogSchema = z.object({
  text: z.string(),
  /** Only the end of the log is kept; the start was cut. */
  truncated: z.boolean(),
  /** Too big to download at all; `text` is empty. */
  tooLarge: z.boolean()
});
export type GithubJobLog = z.infer<typeof githubJobLogSchema>;

export const githubHealthSchema = z.object({
  status: z.enum(['unknown', 'healthy', 'degraded', 'failing']),
  basedOnRuns: z.number().int().min(0),
  failingWorkflows: z.array(z.string())
});
export type GithubHealth = z.infer<typeof githubHealthSchema>;

const githubNumericIdSchema = z.number().int().min(1);

export const githubListRunsInputSchema = z.object({
  projectId: idSchema,
  repositoryId: idSchema,
  workflowId: githubNumericIdSchema.nullable().default(null),
  page: z.number().int().min(1).max(1000).default(1)
});
export type GithubListRunsInput = z.input<typeof githubListRunsInputSchema>;

export const githubListJobsInputSchema = z.object({
  projectId: idSchema,
  repositoryId: idSchema,
  runId: githubNumericIdSchema
});
export type GithubListJobsInput = z.infer<typeof githubListJobsInputSchema>;

export const githubGetJobLogInputSchema = z.object({
  projectId: idSchema,
  repositoryId: idSchema,
  jobId: githubNumericIdSchema
});
export type GithubGetJobLogInput = z.infer<typeof githubGetJobLogInputSchema>;

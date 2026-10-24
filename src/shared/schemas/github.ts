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

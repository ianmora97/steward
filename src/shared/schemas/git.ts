import { z } from 'zod';
import { idSchema, isoTimestampSchema } from './common';

/**
 * Git tab contracts. Every call is scoped by `repositoryId`, never by a bare
 * path: the main process resolves the id to a repository that belongs to a
 * project, so the renderer cannot point Git at an arbitrary folder.
 */
export const repositoryScopeSchema = z.object({ repositoryId: idSchema });

/**
 * Paths are repository-relative. Absolute paths and `..` segments are rejected
 * here and again in the main process; Git is also run with literal pathspecs so
 * a file called `:(glob)*` is a file name, not a pattern.
 */
export const repoRelativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'), 'must not contain null bytes')
  .refine((value) => !/^(?:[a-zA-Z]:|[\\/])/.test(value), 'must be relative to the repository')
  .refine((value) => !value.split(/[\\/]/).includes('..'), 'must not leave the repository');

const pathListSchema = z.array(repoRelativePathSchema).min(1).max(500);

/** Branch and ref names are validated with `git check-ref-format`; this is the shape gate. */
export const refNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !value.includes('\0'), 'must not contain null bytes')
  .refine((value) => !value.startsWith('-'), 'must not start with a hyphen');

export const gitStatusInputSchema = repositoryScopeSchema;

export const gitDiffInputSchema = repositoryScopeSchema.extend({
  path: repoRelativePathSchema,
  /** `staged` diffs the index against HEAD; otherwise the work tree against the index. */
  staged: z.boolean(),
  /** An untracked file has no index entry, so it is diffed against nothing. */
  untracked: z.boolean().optional()
});

export const gitStageInputSchema = repositoryScopeSchema.extend({ paths: pathListSchema });

export const gitDiscardInputSchema = repositoryScopeSchema.extend({
  paths: pathListSchema,
  /** Discarding is irreversible. The UI must show what is lost and set this only after the user agrees. */
  confirmed: z.literal(true)
});

export const gitCommitInputSchema = repositoryScopeSchema.extend({
  message: z.string().trim().min(1, 'a commit message is required').max(20_000)
});

export const gitCreateBranchInputSchema = repositoryScopeSchema.extend({
  name: refNameSchema,
  startPoint: refNameSchema.optional(),
  checkout: z.boolean().optional()
});

export const gitCheckoutInputSchema = repositoryScopeSchema.extend({
  name: refNameSchema,
  /** `origin/feature` style names create a local tracking branch. */
  remote: z.boolean().optional()
});

export const gitDeleteBranchInputSchema = repositoryScopeSchema
  .extend({
    name: refNameSchema,
    /** Deleting a branch with unmerged commits loses them from every branch. */
    force: z.boolean().optional(),
    confirmed: z.boolean().optional()
  })
  .refine((value) => value.force !== true || value.confirmed === true, {
    message: 'force-deleting a branch requires confirmation',
    path: ['confirmed']
  });

export const gitPullInputSchema = repositoryScopeSchema.extend({
  /** `ff-only` never creates a merge commit; `merge` may, and may leave conflicts. */
  mode: z.enum(['ff-only', 'merge']).optional()
});

export const listExecutionsInputSchema = repositoryScopeSchema.extend({
  limit: z.number().int().min(1).max(200).optional()
});

/* Results ----------------------------------------------------------------- */

export const fileChangeKindSchema = z.enum([
  'modified',
  'added',
  'deleted',
  'renamed',
  'copied',
  'typechange',
  'untracked',
  'conflicted'
]);

export const gitFileEntrySchema = z.object({
  path: z.string(),
  /** Set for renames and copies. */
  originalPath: z.string().nullable(),
  /** Change recorded in the index (staged), or null if the file has none staged. */
  staged: fileChangeKindSchema.nullable(),
  /** Change in the work tree not yet staged, or null. `untracked` appears only here. */
  unstaged: fileChangeKindSchema.nullable(),
  conflicted: z.boolean()
});

export const gitStatusSchema = z.object({
  branch: z.string().nullable(),
  detached: z.boolean(),
  head: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number().int(),
  behind: z.number().int(),
  /** An unfinished merge is surfaced so the UI never leaves the user in it unaware. */
  mergeInProgress: z.boolean(),
  files: z.array(gitFileEntrySchema),
  hasCommits: z.boolean()
});

export const gitDiffSchema = z.object({
  path: z.string(),
  staged: z.boolean(),
  text: z.string(),
  binary: z.boolean(),
  truncated: z.boolean(),
  empty: z.boolean()
});

export const gitBranchSchema = z.object({
  name: z.string(),
  fullName: z.string(),
  remote: z.boolean(),
  current: z.boolean(),
  sha: z.string(),
  upstream: z.string().nullable(),
  ahead: z.number().int(),
  behind: z.number().int(),
  upstreamGone: z.boolean()
});

export const gitBranchListSchema = z.object({
  current: z.string().nullable(),
  detached: z.boolean(),
  branches: z.array(gitBranchSchema)
});

export const gitCommitResultSchema = z.object({
  sha: z.string(),
  summary: z.string()
});

export const gitSyncResultSchema = z.object({
  operation: z.enum(['fetch', 'pull', 'push']),
  /** Git's own words, redacted and capped. Shown verbatim so nothing is paraphrased into a false success. */
  output: z.string()
});

export const executionSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  repositoryId: idSchema.nullable(),
  kind: z.string(),
  context: z.enum(['local', 'remote']),
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string().nullable(),
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out']),
  exitCode: z.number().int().nullable(),
  confirmedByUser: z.boolean(),
  startedAt: isoTimestampSchema,
  finishedAt: isoTimestampSchema.nullable(),
  durationMs: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable()
});

export type GitFileEntry = z.infer<typeof gitFileEntrySchema>;
export type GitFileChangeKind = z.infer<typeof fileChangeKindSchema>;
export type GitStatus = z.infer<typeof gitStatusSchema>;
export type GitDiff = z.infer<typeof gitDiffSchema>;
export type GitBranch = z.infer<typeof gitBranchSchema>;
export type GitBranchList = z.infer<typeof gitBranchListSchema>;
export type GitCommitResult = z.infer<typeof gitCommitResultSchema>;
export type GitSyncResult = z.infer<typeof gitSyncResultSchema>;
export type Execution = z.infer<typeof executionSchema>;
export type GitDiffInput = z.infer<typeof gitDiffInputSchema>;
export type GitStageInput = z.infer<typeof gitStageInputSchema>;
export type GitDiscardInput = z.infer<typeof gitDiscardInputSchema>;
export type GitCommitInput = z.infer<typeof gitCommitInputSchema>;
export type GitCreateBranchInput = z.infer<typeof gitCreateBranchInputSchema>;
export type GitCheckoutInput = z.infer<typeof gitCheckoutInputSchema>;
export type GitDeleteBranchInput = z.infer<typeof gitDeleteBranchInputSchema>;
export type GitPullInput = z.infer<typeof gitPullInputSchema>;
export type ListExecutionsInput = z.infer<typeof listExecutionsInputSchema>;

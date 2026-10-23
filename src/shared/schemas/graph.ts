import { z } from 'zod';
import { isoTimestampSchema } from './common';
import { repoRelativePathSchema, repositoryScopeSchema } from './git';

/** A full or abbreviated commit id. Hex only, so it can never be read as an option. */
export const commitShaSchema = z.string().regex(/^[0-9a-f]{7,40}$/i, 'must be a commit hash');

export const MAX_HISTORY_PAGE = 500;

export const gitHistoryInputSchema = repositoryScopeSchema.extend({
  skip: z.number().int().min(0).max(10_000_000),
  limit: z.number().int().min(1).max(MAX_HISTORY_PAGE),
  /** `all` walks every branch, tag and remote ref; `head` only what the current HEAD reaches. */
  scope: z.enum(['all', 'head'])
});

export const gitCommitDetailInputSchema = repositoryScopeSchema.extend({ sha: commitShaSchema });

export const gitCommitDiffInputSchema = repositoryScopeSchema.extend({
  sha: commitShaSchema,
  path: repoRelativePathSchema
});

export const refKindSchema = z.enum(['head', 'local', 'remote', 'tag']);

export const graphRefSchema = z.object({
  name: z.string(),
  kind: refKindSchema,
  /** The branch HEAD currently points at, or the detached HEAD marker. */
  current: z.boolean()
});

export const graphCommitSchema = z.object({
  sha: z.string(),
  parents: z.array(z.string()),
  author: z.string(),
  email: z.string(),
  date: isoTimestampSchema,
  subject: z.string(),
  refs: z.array(graphRefSchema)
});

export const gitHistorySchema = z.object({
  commits: z.array(graphCommitSchema),
  /** True when a full page came back, so another page may exist. */
  hasMore: z.boolean()
});

export const commitFileStatusSchema = z.enum(['added', 'modified', 'deleted', 'renamed', 'copied', 'typechange']);

export const commitFileSchema = z.object({
  path: z.string(),
  originalPath: z.string().nullable(),
  status: commitFileStatusSchema,
  additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
  binary: z.boolean()
});

export const gitCommitDetailSchema = z.object({
  sha: z.string(),
  parents: z.array(z.string()),
  author: z.string(),
  email: z.string(),
  authorDate: isoTimestampSchema,
  committer: z.string(),
  commitDate: isoTimestampSchema,
  subject: z.string(),
  body: z.string(),
  files: z.array(commitFileSchema),
  /** Changed files are compared with the first parent; true for merge commits. */
  isMerge: z.boolean()
});

export type GitHistoryInput = z.infer<typeof gitHistoryInputSchema>;
export type GitCommitDetailInput = z.infer<typeof gitCommitDetailInputSchema>;
export type GitCommitDiffInput = z.infer<typeof gitCommitDiffInputSchema>;
export type GraphRef = z.infer<typeof graphRefSchema>;
export type GraphCommit = z.infer<typeof graphCommitSchema>;
export type GitHistory = z.infer<typeof gitHistorySchema>;
export type CommitFile = z.infer<typeof commitFileSchema>;
export type GitCommitDetail = z.infer<typeof gitCommitDetailSchema>;

import { z } from 'zod';
import { idSchema, isoTimestampSchema } from './common';

/**
 * Tabs are rows, not code. The Git tab is seeded at position 0 for every new
 * project; integration tabs are inserted when their integration is configured.
 * Hiding a tab keeps its row so it can be restored later.
 */
export const tabKeySchema = z.enum(['git', 'terminal', 'ssh', 'actions', 'deployments', 'settings']);

export const tabSourceSchema = z.enum(['builtin', 'integration']);

export const workspaceTabSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  tabKey: tabKeySchema,
  position: z.number().int().min(0),
  visible: z.boolean(),
  pinned: z.boolean(),
  source: tabSourceSchema,
  integrationId: idSchema.nullable(),
  updatedAt: isoTimestampSchema
});

export const listTabsInputSchema = z.object({ projectId: idSchema });

export const reorderTabsInputSchema = z.object({
  projectId: idSchema,
  /** Full ordered list of this project's tab keys. Partial lists are rejected so order cannot drift. */
  orderedTabKeys: z.array(tabKeySchema).min(1)
});

export const setTabVisibilityInputSchema = z.object({
  projectId: idSchema,
  tabKey: tabKeySchema,
  visible: z.boolean()
});

export const restoreTabsInputSchema = z.object({ projectId: idSchema });

export type WorkspaceTab = z.infer<typeof workspaceTabSchema>;
export type TabKey = z.infer<typeof tabKeySchema>;
export type TabSource = z.infer<typeof tabSourceSchema>;
export type ReorderTabsInput = z.infer<typeof reorderTabsInputSchema>;
export type SetTabVisibilityInput = z.infer<typeof setTabVisibilityInputSchema>;

/** The Git tab appears first in every new project and cannot be hidden. */
export const PINNED_TAB_KEYS: readonly TabKey[] = ['git'];

/** Tabs available before any integration is configured. */
export const BUILTIN_TAB_KEYS: readonly TabKey[] = ['git', 'terminal', 'settings'];

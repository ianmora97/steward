import { z } from 'zod';
import { idSchema, isoTimestampSchema } from './common';

/**
 * Tabs are rows, not code. The Git tab is seeded at position 0 for every new
 * project; integration tabs are inserted when their integration is configured.
 * Hiding a tab keeps its row so it can be restored later.
 */
export const tabKeySchema = z.enum(['git', 'terminal', 'ssh', 'github', 'deployments', 'docker', 'mongodb', 'redis', 'monitoring', 'settings']);

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

/** Git and Terminal are on the bar of every project and cannot be removed from it. */
export const PINNED_TAB_KEYS: readonly TabKey[] = ['git', 'terminal'];

/**
 * Services a project adds when it needs them (the **+** on the tab bar) and removes when it does not.
 * `github` is not one of them: its pull requests and Actions live inside the Git tab.
 */
export const OPTIONAL_TAB_KEYS: readonly TabKey[] = ['ssh', 'deployments', 'docker', 'mongodb', 'redis', 'monitoring'];

/** What each optional tab is for, shown in the **+** menu. */
export const TAB_DESCRIPTIONS: Partial<Record<TabKey, string>> = {
  ssh: 'SSH access to your servers and their status',
  deployments: 'Environments, deploy targets and history',
  docker: 'Containers, images and Compose',
  mongodb: 'Browse and edit MongoDB databases',
  redis: 'Browse keys, run commands, watch a Redis',
  monitoring: 'Logs, metrics and troubleshooting from Grafana, Loki and Prometheus'
};

/** Tabs available before any integration is configured. */
export const BUILTIN_TAB_KEYS: readonly TabKey[] = ['git', 'terminal', 'settings'];

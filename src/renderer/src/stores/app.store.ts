import { create } from 'zustand';
import type { Project } from '@shared/schemas/project';
import type { Repository, RepositoryProbe } from '@shared/schemas/repository';
import type { TabKey, WorkspaceTab } from '@shared/schemas/tabs';
import type { AppInfo } from '@shared/types/ipc';
import type { StewardError, StewardResult } from '@shared/types/result';

/**
 * Renderer state.
 *
 * Only Steward's own configuration lives here. Git and provider data are never
 * cached as a system of record: later milestones re-read them from Git and the
 * provider APIs.
 */
export type AppView = 'overview' | 'project';

interface AppState {
  appInfo: AppInfo | null;
  view: AppView;
  projects: Project[];
  /** Repositories of every project, for the overview cards. */
  repositoriesByProject: Record<string, Repository[]>;
  selectedProjectId: string | null;
  repositories: Repository[];
  tabs: WorkspaceTab[];
  activeTabKey: TabKey | null;
  busy: boolean;
  error: StewardError | null;

  initialize: () => Promise<void>;
  dismissError: () => void;
  showOverview: () => void;
  selectProject: (projectId: string) => Promise<void>;
  createProject: (input: { name: string; description?: string }) => Promise<boolean>;
  deleteProject: (projectId: string) => Promise<void>;
  refreshProjects: () => Promise<void>;

  validatePath: (localPath: string) => Promise<RepositoryProbe | null>;
  pickDirectory: () => Promise<string | null>;
  addRepository: (input: { localPath: string; name?: string }) => Promise<boolean>;
  removeRepository: (repositoryId: string) => Promise<void>;

  setActiveTab: (tabKey: TabKey) => void;
  moveTab: (tabKey: TabKey, direction: -1 | 1) => Promise<void>;
  setTabVisibility: (tabKey: TabKey, visible: boolean) => Promise<void>;
  restoreTabs: () => Promise<void>;
  /** Re-reads the tab list, e.g. after an integration added or removed its tab. */
  refreshTabs: (activate?: TabKey) => Promise<void>;
}

const api = () => window.steward;

export const useAppStore = create<AppState>((set, get) => {
  /**
   * Unwraps a result, recording the error for the UI instead of throwing.
   * Failures are shown to the user; nothing is reported only to the console.
   */
  async function unwrap<T>(operation: Promise<StewardResult<T>>): Promise<T | null> {
    set({ busy: true });
    try {
      const result = await operation;
      if (!result.success) {
        set({ error: result.error });
        return null;
      }
      set({ error: null });
      return result.data;
    } catch (cause) {
      set({
        error: {
          code: 'UNKNOWN',
          message: 'Steward could not reach its main process',
          details: cause instanceof Error ? cause.message : undefined
        }
      });
      return null;
    } finally {
      set({ busy: false });
    }
  }

  async function loadWorkspace(projectId: string): Promise<void> {
    const [repositories, tabs] = await Promise.all([
      unwrap(api().repositories.list({ projectId })),
      unwrap(api().tabs.list({ projectId }))
    ]);

    const visibleTabs = (tabs ?? []).filter((tab) => tab.visible);
    const current = get().activeTabKey;
    const keepCurrent = current !== null && visibleTabs.some((tab) => tab.tabKey === current);

    set({
      repositories: repositories ?? [],
      tabs: tabs ?? [],
      activeTabKey: keepCurrent ? current : (visibleTabs[0]?.tabKey ?? null)
    });
  }

  /** Repositories of every project in one pass, so the overview cards need no per-card request. */
  async function loadOverviewRepositories(projects: Project[]): Promise<void> {
    const lists = await Promise.all(projects.map((project) => api().repositories.list({ projectId: project.id })));
    const byProject: Record<string, Repository[]> = {};
    projects.forEach((project, index) => {
      const list = lists[index];
      byProject[project.id] = list?.success ? list.data : [];
    });
    set({ repositoriesByProject: byProject });
  }

  return {
    appInfo: null,
    view: 'overview',
    projects: [],
    repositoriesByProject: {},
    selectedProjectId: null,
    repositories: [],
    tabs: [],
    activeTabKey: null,
    busy: false,
    error: null,

    initialize: async () => {
      const appInfo = await unwrap(api().app.getInfo());
      if (appInfo !== null) set({ appInfo });

      const projects = await unwrap(api().projects.list({}));
      set({ projects: projects ?? [] });
      await loadOverviewRepositories(projects ?? []);
    },

    showOverview: () => {
      set({ view: 'overview' });
      void loadOverviewRepositories(get().projects);
    },

    dismissError: () => set({ error: null }),

    refreshProjects: async () => {
      const projects = await unwrap(api().projects.list({}));
      if (projects === null) return;
      set({ projects });
      await loadOverviewRepositories(projects);
    },

    selectProject: async (projectId) => {
      set({ selectedProjectId: projectId, activeTabKey: null, view: 'project' });
      await loadWorkspace(projectId);
    },

    createProject: async (input) => {
      const project = await unwrap(api().projects.create(input));
      if (project === null) return false;
      await get().refreshProjects();
      await get().selectProject(project.id);
      return true;
    },

    deleteProject: async (projectId) => {
      const removed = await unwrap(api().projects.remove({ id: projectId }));
      if (removed === null) return;

      await get().refreshProjects();
      if (get().selectedProjectId === projectId) {
        set({ selectedProjectId: null, repositories: [], tabs: [], activeTabKey: null, view: 'overview' });
      }
    },

    validatePath: async (localPath) => unwrap(api().repositories.validatePath({ localPath })),

    pickDirectory: async () => {
      const pick = await unwrap(api().repositories.pickDirectory());
      return pick === null || pick.cancelled ? null : pick.localPath;
    },

    addRepository: async (input) => {
      const projectId = get().selectedProjectId;
      if (projectId === null) return false;

      const payload = input.name === undefined ? { projectId, localPath: input.localPath } : { projectId, localPath: input.localPath, name: input.name };
      const repository = await unwrap(api().repositories.add(payload));
      if (repository === null) return false;

      await loadWorkspace(projectId);
      return true;
    },

    removeRepository: async (repositoryId) => {
      const projectId = get().selectedProjectId;
      const removed = await unwrap(api().repositories.remove({ id: repositoryId }));
      if (removed !== null && projectId !== null) await loadWorkspace(projectId);
    },

    setActiveTab: (tabKey) => set({ activeTabKey: tabKey }),

    moveTab: async (tabKey, direction) => {
      const projectId = get().selectedProjectId;
      if (projectId === null) return;

      // Settings is pinned to the end of the bar, so it takes no part in the swap and is appended back.
      const ordered: TabKey[] = [...get().tabs]
        .sort((a, b) => a.position - b.position)
        .map((tab) => tab.tabKey)
        .filter((key) => key !== 'settings');
      const index = ordered.indexOf(tabKey);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= ordered.length) return;

      const swapped = [...ordered];
      const moving = swapped[index] as TabKey;
      swapped[index] = swapped[target] as TabKey;
      swapped[target] = moving;
      if (get().tabs.some((tab) => tab.tabKey === 'settings')) swapped.push('settings');

      const tabs = await unwrap(api().tabs.reorder({ projectId, orderedTabKeys: swapped }));
      if (tabs !== null) set({ tabs });
    },

    setTabVisibility: async (tabKey, visible) => {
      const projectId = get().selectedProjectId;
      if (projectId === null) return;

      const tabs = await unwrap(api().tabs.setVisibility({ projectId, tabKey, visible }));
      if (tabs === null) return;

      const stillVisible = tabs.filter((tab) => tab.visible);
      const current = get().activeTabKey;
      set({
        tabs,
        activeTabKey:
          current !== null && stillVisible.some((tab) => tab.tabKey === current)
            ? current
            : (stillVisible[0]?.tabKey ?? null)
      });
    },

    restoreTabs: async () => {
      const projectId = get().selectedProjectId;
      if (projectId === null) return;

      const tabs = await unwrap(api().tabs.restoreDefaults({ projectId }));
      if (tabs !== null) set({ tabs, activeTabKey: tabs.filter((t) => t.visible)[0]?.tabKey ?? null });
    },

    refreshTabs: async (activate) => {
      const projectId = get().selectedProjectId;
      if (projectId === null) return;

      const tabs = await unwrap(api().tabs.list({ projectId }));
      if (tabs === null || get().selectedProjectId !== projectId) return;
      const visible = tabs.filter((tab) => tab.visible);
      const current = get().activeTabKey;
      const target =
        activate !== undefined && visible.some((tab) => tab.tabKey === activate)
          ? activate
          : current !== null && visible.some((tab) => tab.tabKey === current)
            ? current
            : (visible[0]?.tabKey ?? null);
      set({ tabs, activeTabKey: target });
    }
  };
});

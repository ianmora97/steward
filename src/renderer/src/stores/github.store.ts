import { create } from 'zustand';
import type {
  GithubCreatePullInput,
  GithubCreatedPull,
  GithubIntegration,
  GithubPull,
  GithubPullState
} from '@shared/schemas/github';
import type { StewardError, StewardResult } from '@shared/types/result';
import { useAppStore } from './app.store';

/**
 * GitHub tab state. The token is typed into a form and sent once; nothing here
 * ever holds it, and the integration view the main process returns has no token.
 * Pull requests are a view of what GitHub last said, re-read on every change of
 * repository or filter; a response for a view the user already left is dropped.
 */
interface GithubState {
  integrationByProject: Record<string, GithubIntegration>;
  busy: boolean;
  error: StewardError | null;

  repositoryId: string | null;
  pullsState: GithubPullState;
  pulls: GithubPull[];
  page: number;
  hasNext: boolean;
  loadingPulls: boolean;

  loadStatus: (projectId: string) => Promise<void>;
  connect: (projectId: string, token: string) => Promise<boolean>;
  importFromGh: (projectId: string) => Promise<boolean>;
  disconnect: (projectId: string) => Promise<void>;
  dismissError: () => void;

  selectRepository: (projectId: string, repositoryId: string | null) => Promise<void>;
  setPullsState: (projectId: string, state: GithubPullState) => Promise<void>;
  reloadPulls: (projectId: string) => Promise<void>;
  loadMore: (projectId: string) => Promise<void>;
  createPull: (input: Omit<GithubCreatePullInput, 'confirmed'>) => Promise<GithubCreatedPull | null>;
  openUrl: (url: string) => Promise<void>;
}

const api = () => window.steward;

function unreachableError(cause: unknown): StewardError {
  return {
    code: 'UNKNOWN',
    message: 'Steward could not reach its main process',
    details: cause instanceof Error ? cause.message : undefined
  };
}

export const useGithubStore = create<GithubState>((set, get) => {
  /** Bumped on every pull request load, so a slow response cannot overwrite a newer view. */
  let pullsRequest = 0;

  async function run(projectId: string, operation: Promise<StewardResult<GithubIntegration>>): Promise<boolean> {
    set({ busy: true });
    try {
      const result = await operation;
      if (!result.success) {
        set({ error: result.error });
        return false;
      }
      set({ error: null, integrationByProject: { ...get().integrationByProject, [projectId]: result.data } });
      return true;
    } catch (cause) {
      set({ error: unreachableError(cause) });
      return false;
    } finally {
      set({ busy: false });
    }
  }

  async function fetchPulls(projectId: string, page: number): Promise<void> {
    const { repositoryId, pullsState } = get();
    if (repositoryId === null) return;
    const request = ++pullsRequest;
    set({ loadingPulls: true });
    try {
      const result = await api().github.listPulls({ projectId, repositoryId, state: pullsState, page });
      if (request !== pullsRequest) return;
      if (!result.success) {
        set({ error: result.error });
        // A rejected token changes the connection state, which the panel shows.
        if (result.error.code === 'GITHUB_AUTH_FAILED' || result.error.code === 'GITHUB_UNREACHABLE') {
          void get().loadStatus(projectId);
        }
        return;
      }
      set({
        error: null,
        pulls: page === 1 ? result.data.items : [...get().pulls, ...result.data.items],
        page: result.data.page,
        hasNext: result.data.hasNext
      });
    } catch (cause) {
      if (request === pullsRequest) set({ error: unreachableError(cause) });
    } finally {
      if (request === pullsRequest) set({ loadingPulls: false });
    }
  }

  return {
    integrationByProject: {},
    busy: false,
    error: null,

    repositoryId: null,
    pullsState: 'open',
    pulls: [],
    page: 1,
    hasNext: false,
    loadingPulls: false,

    loadStatus: async (projectId) => {
      await run(projectId, api().github.status({ projectId }));
    },

    connect: async (projectId, token) => {
      const connected = await run(projectId, api().github.connect({ projectId, token }));
      if (connected) await useAppStore.getState().refreshTabs('github');
      return connected;
    },

    importFromGh: async (projectId) => {
      const connected = await run(projectId, api().github.importFromGh({ projectId }));
      if (connected) await useAppStore.getState().refreshTabs('github');
      return connected;
    },

    disconnect: async (projectId) => {
      const done = await run(projectId, api().github.disconnect({ projectId }));
      if (done) {
        set({ repositoryId: null, pulls: [], page: 1, hasNext: false });
        await useAppStore.getState().refreshTabs();
      }
    },

    dismissError: () => set({ error: null }),

    selectRepository: async (projectId, repositoryId) => {
      set({ repositoryId, pulls: [], page: 1, hasNext: false });
      if (repositoryId === null) {
        pullsRequest++;
        set({ loadingPulls: false });
        return;
      }
      await fetchPulls(projectId, 1);
    },

    setPullsState: async (projectId, state) => {
      set({ pullsState: state, pulls: [], page: 1, hasNext: false });
      await fetchPulls(projectId, 1);
    },

    reloadPulls: (projectId) => fetchPulls(projectId, 1),

    loadMore: (projectId) => fetchPulls(projectId, get().page + 1),

    createPull: async (input) => {
      try {
        const result = await api().github.createPull({ ...input, confirmed: true });
        if (!result.success) {
          set({ error: result.error });
          return null;
        }
        set({ error: null });
        return result.data;
      } catch (cause) {
        set({ error: unreachableError(cause) });
        return null;
      }
    },

    openUrl: async (url) => {
      const result = await api().github.openUrl({ url });
      if (!result.success) set({ error: result.error });
    }
  };
});

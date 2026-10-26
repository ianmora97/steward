import { create } from 'zustand';
import type {
  GithubCreatePullInput,
  GithubCreatedPull,
  GithubHealth,
  GithubIntegration,
  GithubJob,
  GithubJobLog,
  GithubPull,
  GithubPullState,
  GithubRun,
  GithubWorkflow
} from '@shared/schemas/github';
import type { StewardError, StewardResult } from '@shared/types/result';
import { useAppStore } from './app.store';
import { toast } from './toast.store';

/**
 * GitHub tab state. The token is typed into a form and sent once; nothing here
 * ever holds it, and the integration view the main process returns has no token.
 * Pull requests and Actions are a view of what GitHub last said, re-read on
 * every change of repository or filter; a response for a view the user already
 * left is dropped.
 */
export type GithubView = 'pulls' | 'actions';

interface GithubState {
  integrationByProject: Record<string, GithubIntegration>;
  busy: boolean;
  error: StewardError | null;

  repositoryId: string | null;
  view: GithubView;

  pullsState: GithubPullState;
  pulls: GithubPull[];
  page: number;
  hasNext: boolean;
  loadingPulls: boolean;

  workflows: GithubWorkflow[];
  workflowId: number | null;
  runs: GithubRun[];
  runsPage: number;
  runsHasNext: boolean;
  health: GithubHealth | null;
  jobsByRun: Record<number, GithubJob[]>;
  loadingRuns: boolean;

  loadStatus: (projectId: string) => Promise<void>;
  connect: (projectId: string, token: string) => Promise<boolean>;
  importFromGh: (projectId: string) => Promise<boolean>;
  disconnect: (projectId: string) => Promise<void>;
  dismissError: () => void;
  setView: (view: GithubView) => void;

  selectRepository: (projectId: string, repositoryId: string | null) => Promise<void>;
  setPullsState: (projectId: string, state: GithubPullState) => Promise<void>;
  reloadPulls: (projectId: string) => Promise<void>;
  loadMore: (projectId: string) => Promise<void>;
  createPull: (input: Omit<GithubCreatePullInput, 'confirmed'>) => Promise<GithubCreatedPull | null>;
  openUrl: (url: string) => Promise<void>;

  loadActions: (projectId: string) => Promise<void>;
  refreshActions: (projectId: string) => Promise<void>;
  setWorkflow: (projectId: string, workflowId: number | null) => Promise<void>;
  loadMoreRuns: (projectId: string) => Promise<void>;
  loadJobs: (projectId: string, runId: number) => Promise<void>;
  /** Returns the result as is: the log viewer explains its own failures (expired log, no permission). */
  fetchJobLog: (projectId: string, jobId: number) => Promise<StewardResult<GithubJobLog>>;
}

const api = () => window.steward;

function unreachableError(cause: unknown): StewardError {
  return {
    code: 'UNKNOWN',
    message: 'Steward could not reach its main process',
    details: cause instanceof Error ? cause.message : undefined
  };
}

const EMPTY_ACTIONS = {
  workflows: [] as GithubWorkflow[],
  runs: [] as GithubRun[],
  runsPage: 1,
  runsHasNext: false,
  health: null,
  jobsByRun: {} as Record<number, GithubJob[]>,
  loadingRuns: false
};

export const useGithubStore = create<GithubState>((set, get) => {
  /** Bumped on every pull request load, so a slow response cannot overwrite a newer view. */
  let pullsRequest = 0;
  /** Bumped whenever the Actions view is reset (repository, refresh, disconnect). */
  let actionsEpoch = 0;
  /** Bumped on every runs load (filter change, next page), within an epoch. */
  let runsRequest = 0;

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

  /** A rejected token or a lost connection changes the connection state, which the panel shows. */
  function noteFailure(projectId: string, error: StewardError): void {
    set({ error });
    if (error.code === 'GITHUB_AUTH_FAILED' || error.code === 'GITHUB_UNREACHABLE') {
      void get().loadStatus(projectId);
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
        noteFailure(projectId, result.error);
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

  async function fetchRuns(projectId: string, page: number): Promise<void> {
    const { repositoryId, workflowId } = get();
    if (repositoryId === null) return;
    const epoch = actionsEpoch;
    const request = ++runsRequest;
    set({ loadingRuns: true });
    try {
      const result = await api().github.listRuns({ projectId, repositoryId, workflowId, page });
      if (epoch !== actionsEpoch || request !== runsRequest) return;
      if (!result.success) {
        noteFailure(projectId, result.error);
        return;
      }
      set({
        runs: page === 1 ? result.data.items : [...get().runs, ...result.data.items],
        runsPage: result.data.page,
        runsHasNext: result.data.hasNext
      });
    } catch (cause) {
      if (epoch === actionsEpoch && request === runsRequest) set({ error: unreachableError(cause) });
    } finally {
      if (epoch === actionsEpoch && request === runsRequest) set({ loadingRuns: false });
    }
  }

  async function startActions(projectId: string, keepFilter: boolean): Promise<void> {
    const { repositoryId } = get();
    const epoch = ++actionsEpoch;
    runsRequest++;
    set({ ...EMPTY_ACTIONS, workflowId: keepFilter ? get().workflowId : null });
    if (repositoryId === null) return;

    void fetchRuns(projectId, 1);
    try {
      const [workflows, health] = await Promise.all([
        api().github.listWorkflows({ projectId, repositoryId }),
        api().github.getHealth({ projectId, repositoryId })
      ]);
      if (epoch !== actionsEpoch) return;
      if (workflows.success) set({ workflows: workflows.data });
      else noteFailure(projectId, workflows.error);
      if (health.success) set({ health: health.data });
      else if (workflows.success) noteFailure(projectId, health.error);
    } catch (cause) {
      if (epoch === actionsEpoch) set({ error: unreachableError(cause) });
    }
  }

  return {
    integrationByProject: {},
    busy: false,
    error: null,

    repositoryId: null,
    view: 'pulls',

    pullsState: 'open',
    pulls: [],
    page: 1,
    hasNext: false,
    loadingPulls: false,

    ...EMPTY_ACTIONS,
    workflowId: null,

    loadStatus: async (projectId) => {
      await run(projectId, api().github.status({ projectId }));
    },

    connect: async (projectId, token) => {
      const connected = await run(projectId, api().github.connect({ projectId, token }));
      if (connected) {
        toast.success('GitHub connected');
        await useAppStore.getState().refreshTabs('github');
      }
      return connected;
    },

    importFromGh: async (projectId) => {
      const connected = await run(projectId, api().github.importFromGh({ projectId }));
      if (connected) {
        toast.success('GitHub connected from the gh CLI');
        await useAppStore.getState().refreshTabs('github');
      }
      return connected;
    },

    disconnect: async (projectId) => {
      const done = await run(projectId, api().github.disconnect({ projectId }));
      if (done) {
        toast.success('GitHub disconnected');
        actionsEpoch++;
        set({ repositoryId: null, pulls: [], page: 1, hasNext: false, workflowId: null, ...EMPTY_ACTIONS });
        await useAppStore.getState().refreshTabs();
      }
    },

    dismissError: () => set({ error: null }),

    setView: (view) => set({ view }),

    selectRepository: async (projectId, repositoryId) => {
      actionsEpoch++;
      set({ repositoryId, pulls: [], page: 1, hasNext: false, workflowId: null, ...EMPTY_ACTIONS });
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
        toast.success(`Pull request #${result.data.number} created`);
        return result.data;
      } catch (cause) {
        set({ error: unreachableError(cause) });
        return null;
      }
    },

    openUrl: async (url) => {
      const result = await api().github.openUrl({ url });
      if (!result.success) set({ error: result.error });
    },

    loadActions: (projectId) => startActions(projectId, false),

    refreshActions: (projectId) => startActions(projectId, true),

    setWorkflow: async (projectId, workflowId) => {
      runsRequest++;
      set({ workflowId, runs: [], runsPage: 1, runsHasNext: false });
      await fetchRuns(projectId, 1);
    },

    loadMoreRuns: (projectId) => fetchRuns(projectId, get().runsPage + 1),

    loadJobs: async (projectId, runId) => {
      const { repositoryId } = get();
      if (repositoryId === null || get().jobsByRun[runId] !== undefined) return;
      const epoch = actionsEpoch;
      try {
        const result = await api().github.listJobs({ projectId, repositoryId, runId });
        if (epoch !== actionsEpoch) return;
        if (!result.success) {
          noteFailure(projectId, result.error);
          return;
        }
        set({ jobsByRun: { ...get().jobsByRun, [runId]: result.data } });
      } catch (cause) {
        if (epoch === actionsEpoch) set({ error: unreachableError(cause) });
      }
    },

    fetchJobLog: async (projectId, jobId) => {
      const { repositoryId } = get();
      if (repositoryId === null) {
        return { success: false, error: { code: 'NOT_FOUND', message: 'no repository selected' } };
      }
      try {
        return await api().github.getJobLog({ projectId, repositoryId, jobId });
      } catch (cause) {
        return { success: false, error: unreachableError(cause) };
      }
    }
  };
});

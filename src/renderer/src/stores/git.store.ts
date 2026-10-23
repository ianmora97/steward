import { create } from 'zustand';
import type { Execution, GitBranchList, GitDiff, GitStatus } from '@shared/schemas/git';
import type { StewardError, StewardResult } from '@shared/types/result';

/**
 * Git tab state.
 *
 * This is a view of what Git last reported, not a copy to be trusted: every
 * action re-reads status, branches and history from the main process, and a
 * response that arrives after the user switched repository is discarded.
 */
export interface SelectedFile {
  path: string;
  staged: boolean;
  untracked: boolean;
}

interface GitState {
  repositoryId: string | null;
  status: GitStatus | null;
  branches: GitBranchList | null;
  executions: Execution[];
  selected: SelectedFile | null;
  diff: GitDiff | null;
  busy: boolean;
  error: StewardError | null;
  /** Git's own output from the last fetch/pull/push, shown verbatim. */
  notice: string | null;

  selectRepository: (repositoryId: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  dismiss: () => void;
  selectFile: (file: SelectedFile | null) => Promise<void>;

  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  commit: (message: string) => Promise<boolean>;

  createBranch: (name: string, checkout: boolean) => Promise<boolean>;
  checkout: (name: string, remote: boolean) => Promise<void>;
  deleteBranch: (name: string, force: boolean) => Promise<boolean>;

  fetch: () => Promise<void>;
  pull: (mode: 'ff-only' | 'merge') => Promise<void>;
  push: () => Promise<void>;
  abortMerge: () => Promise<void>;
}

const api = () => window.steward.git;

export const useGitStore = create<GitState>((set, get) => {
  /** Runs one operation for the current repository; drops the result if the repository changed meanwhile. */
  async function run<T>(operation: (repositoryId: string) => Promise<StewardResult<T>>): Promise<T | null> {
    const repositoryId = get().repositoryId;
    if (repositoryId === null) return null;

    set({ busy: true });
    try {
      const result = await operation(repositoryId);
      if (get().repositoryId !== repositoryId) return null;
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

  async function reload(): Promise<void> {
    const repositoryId = get().repositoryId;
    if (repositoryId === null) return;

    const [status, branches, executions] = await Promise.all([
      api().status({ repositoryId }),
      api().listBranches({ repositoryId }),
      api().listExecutions({ repositoryId, limit: 40 })
    ]);
    if (get().repositoryId !== repositoryId) return;

    // Status failing (folder deleted, git missing) is the interesting error;
    // report it rather than the secondary ones.
    if (!status.success) {
      set({ status: null, branches: null, error: status.error });
      return;
    }
    set({
      status: status.data,
      branches: branches.success ? branches.data : null,
      executions: executions.success ? executions.data : [],
      error: branches.success ? null : branches.error
    });

    await reloadDiff();
  }

  async function reloadDiff(): Promise<void> {
    const { selected, status, repositoryId } = get();
    if (selected === null || repositoryId === null || status === null) {
      set({ diff: null });
      return;
    }

    // If the selected change is gone (committed, discarded), clear the pane.
    const entry = status.files.find((file) => file.path === selected.path);
    const stillThere =
      entry !== undefined && (selected.staged ? entry.staged !== null : entry.unstaged !== null || entry.conflicted);
    if (!stillThere) {
      set({ selected: null, diff: null });
      return;
    }

    const result = await api().diff({
      repositoryId,
      path: selected.path,
      staged: selected.staged,
      untracked: selected.untracked
    });
    if (get().repositoryId !== repositoryId) return;
    set(result.success ? { diff: result.data } : { diff: null, error: result.error });
  }

  async function mutate<T>(
    operation: (repositoryId: string) => Promise<StewardResult<T>>,
    notice: (data: T) => string | null = () => null
  ): Promise<T | null> {
    const data = await run(operation);
    // Refresh even after a failure: Git may have partly applied the change
    // (a conflicted merge, say), and the screen must show what is true now.
    await reload();
    if (data !== null) set({ notice: notice(data) });
    return data;
  }

  return {
    repositoryId: null,
    status: null,
    branches: null,
    executions: [],
    selected: null,
    diff: null,
    busy: false,
    error: null,
    notice: null,

    selectRepository: async (repositoryId) => {
      set({
        repositoryId,
        status: null,
        branches: null,
        executions: [],
        selected: null,
        diff: null,
        error: null,
        notice: null
      });
      if (repositoryId === null) return;
      set({ busy: true });
      try {
        await reload();
      } finally {
        set({ busy: false });
      }
    },

    refresh: async () => {
      set({ busy: true });
      try {
        await reload();
      } finally {
        set({ busy: false });
      }
    },

    dismiss: () => set({ error: null, notice: null }),

    selectFile: async (file) => {
      set({ selected: file, diff: null });
      if (file !== null) await reloadDiff();
    },

    stage: async (paths) => {
      await mutate((repositoryId) => api().stage({ repositoryId, paths }));
    },

    unstage: async (paths) => {
      await mutate((repositoryId) => api().unstage({ repositoryId, paths }));
    },

    discard: async (paths) => {
      await mutate((repositoryId) => api().discard({ repositoryId, paths, confirmed: true }));
    },

    commit: async (message) => {
      const result = await mutate(
        (repositoryId) => api().commit({ repositoryId, message }),
        (data) => `Committed ${data.sha}: ${data.summary}`
      );
      return result !== null;
    },

    createBranch: async (name, checkout) => {
      const result = await mutate((repositoryId) => api().createBranch({ repositoryId, name, checkout }));
      return result !== null;
    },

    checkout: async (name, remote) => {
      await mutate((repositoryId) => api().checkout({ repositoryId, name, remote }));
    },

    deleteBranch: async (name, force) => {
      const result = await mutate((repositoryId) =>
        api().deleteBranch(force ? { repositoryId, name, force: true, confirmed: true } : { repositoryId, name })
      );
      return result !== null;
    },

    fetch: async () => {
      await mutate(
        (repositoryId) => api().fetch({ repositoryId }),
        (data) => data.output || 'Fetched. Nothing new on the remote.'
      );
    },

    pull: async (mode) => {
      await mutate(
        (repositoryId) => api().pull({ repositoryId, mode }),
        (data) => data.output || 'Pulled.'
      );
    },

    push: async () => {
      await mutate(
        (repositoryId) => api().push({ repositoryId }),
        (data) => data.output || 'Pushed.'
      );
    },

    abortMerge: async () => {
      await mutate((repositoryId) => api().abortMerge({ repositoryId }));
    }
  };
});

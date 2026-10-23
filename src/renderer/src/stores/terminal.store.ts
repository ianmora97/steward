import { create } from 'zustand';
import type { TerminalSession } from '@shared/schemas/terminal';
import type { StewardError } from '@shared/types/result';

/**
 * Terminal tab state: which sessions exist per project and which is showing.
 * The processes live in the main process; this is only a view of them, kept in
 * step by `load` and the exit event.
 */
interface TerminalState {
  sessionsByProject: Record<string, TerminalSession[]>;
  activeByProject: Record<string, string | null>;
  error: StewardError | null;

  load: (projectId: string) => Promise<void>;
  create: (projectId: string, repositoryId: string, profileId?: string) => Promise<void>;
  close: (projectId: string, sessionId: string) => Promise<void>;
  setActive: (projectId: string, sessionId: string) => void;
  applyExit: (sessionId: string, exitCode: number | null) => void;
  dismissError: () => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessionsByProject: {},
  activeByProject: {},
  error: null,

  load: async (projectId) => {
    const result = await window.steward.terminal.list({ projectId });
    if (!result.success) {
      set({ error: result.error });
      return;
    }
    const sessions = result.data;
    set((state) => {
      const active = state.activeByProject[projectId] ?? null;
      const stillThere = sessions.some((session) => session.id === active);
      return {
        sessionsByProject: { ...state.sessionsByProject, [projectId]: sessions },
        activeByProject: {
          ...state.activeByProject,
          [projectId]: stillThere ? active : (sessions[0]?.id ?? null)
        }
      };
    });
  },

  create: async (projectId, repositoryId, profileId) => {
    const result = await window.steward.terminal.create({
      projectId,
      repositoryId,
      cols: 80,
      rows: 24,
      ...(profileId === undefined ? {} : { profileId })
    });
    if (!result.success) {
      set({ error: result.error });
      return;
    }
    const session = result.data;
    set((state) => ({
      error: null,
      sessionsByProject: {
        ...state.sessionsByProject,
        [projectId]: [...(state.sessionsByProject[projectId] ?? []), session]
      },
      activeByProject: { ...state.activeByProject, [projectId]: session.id }
    }));
  },

  close: async (projectId, sessionId) => {
    const result = await window.steward.terminal.close({ sessionId });
    if (!result.success) {
      set({ error: result.error });
      return;
    }
    set((state) => {
      const remaining = (state.sessionsByProject[projectId] ?? []).filter((session) => session.id !== sessionId);
      const wasActive = state.activeByProject[projectId] === sessionId;
      return {
        sessionsByProject: { ...state.sessionsByProject, [projectId]: remaining },
        activeByProject: wasActive
          ? { ...state.activeByProject, [projectId]: remaining[remaining.length - 1]?.id ?? null }
          : state.activeByProject
      };
    });
  },

  setActive: (projectId, sessionId) =>
    set((state) => ({ activeByProject: { ...state.activeByProject, [projectId]: sessionId } })),

  applyExit: (sessionId, exitCode) => {
    const next: Record<string, TerminalSession[]> = {};
    for (const [projectId, sessions] of Object.entries(get().sessionsByProject)) {
      next[projectId] = sessions.map((session) =>
        session.id === sessionId ? { ...session, status: 'exited', exitCode } : session
      );
    }
    set({ sessionsByProject: next });
  },

  dismissError: () => set({ error: null })
}));

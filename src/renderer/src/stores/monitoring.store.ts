import { create } from 'zustand';
import type {
  ObservabilityServiceEntry,
  ObservabilitySignal,
  ObservabilitySource,
  ObservabilitySourceStatus
} from '@shared/schemas/observability';
import type { StewardError } from '@shared/types/result';
import { isStale } from '../features/monitoring/monitoring-meta';

/** The sources of each project, shared by every view of the Monitoring tab. Credentials are never here: only "saved". */
interface MonitoringState {
  sources: Record<string, ObservabilitySource[] | undefined>;
  /** The services and signals of each project: what Investigate and the Services view work with. */
  services: Record<string, ObservabilityServiceEntry[] | undefined>;
  signals: Record<string, ObservabilitySignal[] | undefined>;
  /** Sources being checked right now, for the spinner on their row. */
  checking: Record<string, true | undefined>;
  error: StewardError | null;

  load: (projectId: string) => Promise<void>;
  loadCatalog: (projectId: string) => Promise<void>;
  setServices: (projectId: string, services: ObservabilityServiceEntry[]) => void;
  setSignals: (projectId: string, signals: ObservabilitySignal[]) => void;
  upsert: (source: ObservabilitySource) => void;
  drop: (projectId: string, sourceId: string) => void;
  /** Checks a source now and keeps the answer. Resolves to it, or null when the check itself could not run. */
  check: (sourceId: string) => Promise<ObservabilitySourceStatus | null>;
  /** Checks the sources whose last answer is missing or older than the cache time, all at once. */
  checkStale: (projectId: string) => void;
  dismissError: () => void;
}

function withStatus(source: ObservabilitySource, status: ObservabilitySourceStatus): ObservabilitySource {
  return { ...source, status };
}

export const useMonitoringStore = create<MonitoringState>((set, get) => ({
  sources: {},
  services: {},
  signals: {},
  checking: {},
  error: null,

  load: async (projectId) => {
    const result = await window.steward.observability.listSources({ projectId });
    if (result.success) {
      set((state) => ({ sources: { ...state.sources, [projectId]: result.data } }));
      get().checkStale(projectId);
    } else {
      set((state) => ({ sources: { ...state.sources, [projectId]: state.sources[projectId] ?? [] }, error: result.error }));
    }
  },

  loadCatalog: async (projectId) => {
    const [services, signals] = await Promise.all([
      window.steward.observability.listServices({ projectId }),
      window.steward.observability.listSignals({ projectId })
    ]);
    set((state) => ({
      services: { ...state.services, [projectId]: services.success ? services.data : (state.services[projectId] ?? []) },
      signals: { ...state.signals, [projectId]: signals.success ? signals.data : (state.signals[projectId] ?? []) },
      error: !services.success ? services.error : !signals.success ? signals.error : state.error
    }));
  },

  setServices: (projectId, services) => set((state) => ({ services: { ...state.services, [projectId]: services } })),

  setSignals: (projectId, signals) => set((state) => ({ signals: { ...state.signals, [projectId]: signals } })),

  upsert: (source) =>
    set((state) => {
      const list = state.sources[source.projectId] ?? [];
      const exists = list.some((candidate) => candidate.id === source.id);
      const next = exists ? list.map((candidate) => (candidate.id === source.id ? source : candidate)) : [...list, source];
      next.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
      return { sources: { ...state.sources, [source.projectId]: next } };
    }),

  drop: (projectId, sourceId) =>
    set((state) => ({
      sources: { ...state.sources, [projectId]: (state.sources[projectId] ?? []).filter((candidate) => candidate.id !== sourceId) }
    })),

  check: async (sourceId) => {
    set((state) => ({ checking: { ...state.checking, [sourceId]: true } }));
    const result = await window.steward.observability.testSource({ id: sourceId });
    set((state) => {
      const { [sourceId]: _done, ...checking } = state.checking;
      if (!result.success) return { checking, error: result.error };
      const sources: Record<string, ObservabilitySource[] | undefined> = {};
      for (const [projectId, list] of Object.entries(state.sources)) {
        sources[projectId] = list?.map((source) => (source.id === sourceId ? withStatus(source, result.data) : source));
      }
      return { checking, sources };
    });
    return result.success ? result.data : null;
  },

  checkStale: (projectId) => {
    const { sources, checking, check } = get();
    for (const source of sources[projectId] ?? []) {
      if (checking[source.id] === undefined && isStale(source.status)) void check(source.id);
    }
  },

  dismissError: () => set({ error: null })
}));

import { create } from 'zustand';
import type { Check, CheckFinishedEvent, CheckResult, DomainSummary } from '@shared/schemas/cloud';
import type { StewardError } from '@shared/types/result';

/** How many results of a check the page keeps and asks for. */
export const RESULTS_KEPT = 50;

/** The domains of each project and the checks and results of the domains that were opened, shared by every view of the Cloud tab. */
interface CloudState {
  domains: Record<string, DomainSummary[] | undefined>;
  /** Checks by domain id. */
  checks: Record<string, Check[] | undefined>;
  /** Newest first, by check id. */
  results: Record<string, CheckResult[] | undefined>;
  error: StewardError | null;

  load: (projectId: string) => Promise<void>;
  upsert: (domain: DomainSummary) => void;
  drop: (projectId: string, domainId: string) => void;
  loadChecks: (domainId: string) => Promise<void>;
  loadResults: (checkId: string) => Promise<void>;
  upsertCheck: (check: Check) => void;
  dropCheck: (domainId: string, checkId: string) => void;
  /** A check finished somewhere (a schedule, Run now): what the page already shows catches up without asking again. */
  applyFinished: (event: CheckFinishedEvent) => void;
  dismissError: () => void;
}

export const useCloudStore = create<CloudState>((set) => ({
  domains: {},
  checks: {},
  results: {},
  error: null,

  load: async (projectId) => {
    const result = await window.steward.cloud.listDomains({ projectId });
    if (result.success) {
      set((state) => ({ domains: { ...state.domains, [projectId]: result.data } }));
    } else {
      set((state) => ({ domains: { ...state.domains, [projectId]: state.domains[projectId] ?? [] }, error: result.error }));
    }
  },

  upsert: (domain) =>
    set((state) => {
      const list = state.domains[domain.projectId] ?? [];
      const exists = list.some((candidate) => candidate.id === domain.id);
      const next = exists ? list.map((candidate) => (candidate.id === domain.id ? domain : candidate)) : [...list, domain];
      next.sort((a, b) => a.hostname.localeCompare(b.hostname));
      return { domains: { ...state.domains, [domain.projectId]: next } };
    }),

  drop: (projectId, domainId) =>
    set((state) => ({
      domains: { ...state.domains, [projectId]: (state.domains[projectId] ?? []).filter((candidate) => candidate.id !== domainId) }
    })),

  loadChecks: async (domainId) => {
    const result = await window.steward.cloud.listChecks({ domainId });
    if (result.success) set((state) => ({ checks: { ...state.checks, [domainId]: result.data } }));
    else set((state) => ({ checks: { ...state.checks, [domainId]: state.checks[domainId] ?? [] }, error: result.error }));
  },

  loadResults: async (checkId) => {
    const result = await window.steward.cloud.checkResults({ checkId, limit: RESULTS_KEPT });
    if (result.success) set((state) => ({ results: { ...state.results, [checkId]: result.data } }));
    else set((state) => ({ results: { ...state.results, [checkId]: state.results[checkId] ?? [] }, error: result.error }));
  },

  upsertCheck: (check) =>
    set((state) => {
      const list = state.checks[check.domainId] ?? [];
      const exists = list.some((candidate) => candidate.id === check.id);
      const next = exists ? list.map((candidate) => (candidate.id === check.id ? check : candidate)) : [...list, check];
      return { checks: { ...state.checks, [check.domainId]: next } };
    }),

  dropCheck: (domainId, checkId) =>
    set((state) => {
      const { [checkId]: _gone, ...results } = state.results;
      return {
        checks: { ...state.checks, [domainId]: (state.checks[domainId] ?? []).filter((candidate) => candidate.id !== checkId) },
        results
      };
    }),

  applyFinished: (event) =>
    set((state) => {
      const checks = state.checks[event.domainId];
      const loaded = state.results[event.checkId];
      return {
        ...(checks === undefined
          ? {}
          : {
              checks: {
                ...state.checks,
                [event.domainId]: checks.map((check) => (check.id === event.checkId ? { ...check, lastResult: event.result } : check))
              }
            }),
        ...(loaded === undefined || loaded.some((result) => result.id === event.result.id)
          ? {}
          : { results: { ...state.results, [event.checkId]: [event.result, ...loaded].slice(0, RESULTS_KEPT) } })
      };
    }),

  dismissError: () => set({ error: null })
}));

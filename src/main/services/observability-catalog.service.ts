import type {
  ObservabilityServiceCreateInput,
  ObservabilityServiceEntry,
  ObservabilityServiceIdInput,
  ObservabilityServiceListInput,
  ObservabilityServiceUpdateInput,
  ObservabilitySignal,
  ObservabilitySignalCreateInput,
  ObservabilitySignalIdInput,
  ObservabilitySignalListInput,
  ObservabilitySignalPreview,
  ObservabilitySignalPreviewInput,
  ObservabilitySignalReorderInput,
  ObservabilitySignalUpdateInput,
  SignalKind
} from '@shared/schemas/observability';
import { StewardServiceError } from '@shared/types/result';
import type { SqlDatabase } from '../db/driver';
import { findEnvironmentById } from '../db/environment.repo';
import { nowIso, uuidv7 } from '../db/id';
import {
  deleteService,
  deleteSignal,
  findService,
  findServiceByName,
  findSignal,
  findSignalByName,
  insertService,
  insertSignal,
  listServicesByProject,
  listSignalsByProject,
  setSignalPosition,
  updateService,
  updateSignal,
  type ObservabilityServiceRecord,
  type ObservabilitySignalRecord
} from '../db/observability.repo';
import { findRepositoryById } from '../db/repository.repo';
import { findSshHost } from '../db/ssh-host.repo';
import { requireProject } from './project.service';

export interface ObservabilityCatalogDeps {
  db: SqlDatabase;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;

/** The names between `{{ }}` in a template. */
function placeholdersOf(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] ?? '');
}

/**
 * Puts a service's selector and matcher into a signal's template: `{{selector}}` is the whole LogQL selector,
 * `{{matcher}}` the inside of a PromQL one. Nothing else is interpreted, and a missing value says what to add.
 */
export function renderSignalQuery(
  template: string,
  service: { logSelector: string | null; metricMatcher: string | null }
): string {
  return template.replace(PLACEHOLDER, (_whole, name: string) => {
    if (name === 'matcher') {
      if (service.metricMatcher === null) {
        throw new StewardServiceError('VALIDATION_FAILED', 'This signal needs the metric matcher of the service', 'Add it in the Services view, for example job="api".');
      }
      return service.metricMatcher;
    }
    if (name === 'selector') {
      if (service.logSelector === null) {
        throw new StewardServiceError('VALIDATION_FAILED', 'This signal needs the log selector of the service', 'Add it in the Services view, for example {app="api"}.');
      }
      return service.logSelector;
    }
    throw new StewardServiceError('VALIDATION_FAILED', `Unknown placeholder {{${name}}}`, 'Only {{matcher}} and {{selector}} exist.');
  });
}

/** Common exporters' names: they are a starting point to edit, never assumed to exist on a given server. */
export const DEFAULT_SIGNALS: readonly { name: string; kind: SignalKind; queryTemplate: string; unit: string }[] = [
  {
    name: 'Error rate (5xx)',
    kind: 'promql',
    queryTemplate:
      '100 * sum(rate(http_requests_total{ {{matcher}}, status=~"5.." }[5m])) / sum(rate(http_requests_total{ {{matcher}} }[5m]))',
    unit: '%'
  },
  {
    name: 'Latency p95',
    kind: 'promql',
    queryTemplate: 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{ {{matcher}} }[5m])))',
    unit: 's'
  },
  { name: 'CPU', kind: 'promql', queryTemplate: 'sum(rate(process_cpu_seconds_total{ {{matcher}} }[5m]))', unit: 'cores' },
  { name: 'Memory', kind: 'promql', queryTemplate: 'sum(process_resident_memory_bytes{ {{matcher}} })', unit: 'B' },
  {
    name: 'Error log rate',
    kind: 'logql_metric',
    queryTemplate: 'sum(rate({{selector}} |~ "(?i)error|exception|panic|fatal" [1m]))',
    unit: 'lines/s'
  }
];

/** A kind and its template must agree: a PromQL signal has no log selector to fill and the other way round. */
function assertTemplateConsistent(kind: SignalKind, template: string): void {
  const names = placeholdersOf(template);
  const unknown = names.find((name) => name !== 'matcher' && name !== 'selector');
  if (unknown !== undefined) {
    throw new StewardServiceError('VALIDATION_FAILED', `Unknown placeholder {{${unknown}}}`, 'Only {{matcher}} and {{selector}} exist.');
  }
  if (kind === 'promql' && names.includes('selector')) {
    throw new StewardServiceError('VALIDATION_FAILED', 'A PromQL signal uses {{matcher}}, not {{selector}}');
  }
  if (kind === 'logql_metric' && names.includes('matcher')) {
    throw new StewardServiceError('VALIDATION_FAILED', 'A LogQL signal uses {{selector}}, not {{matcher}}');
  }
}

export function createObservabilityCatalogService(deps: ObservabilityCatalogDeps) {
  const { db } = deps;

  function requireService(id: string): ObservabilityServiceRecord {
    const record = findService(db, id);
    if (record === null) throw new StewardServiceError('NOT_FOUND', 'that service no longer exists');
    return record;
  }

  function requireSignal(id: string): ObservabilitySignalRecord {
    const record = findSignal(db, id);
    if (record === null) throw new StewardServiceError('NOT_FOUND', 'that signal no longer exists');
    return record;
  }

  function environmentName(projectId: string, environmentId: string | null): string | null {
    if (environmentId === null) return null;
    const environment = findEnvironmentById(db, environmentId);
    if (environment === null || environment.projectId !== projectId) {
      throw new StewardServiceError('NOT_FOUND', 'that environment no longer exists');
    }
    return environment.name;
  }

  /** What a service points at must belong to the same project: an id from another project is refused. */
  function assertLinks(projectId: string, input: { repositoryId: string | null; sshHostId: string | null; dockerContainer: string | null }): void {
    if (input.repositoryId !== null && findRepositoryById(db, input.repositoryId)?.projectId !== projectId) {
      throw new StewardServiceError('NOT_FOUND', 'that repository is not in this project');
    }
    if (input.sshHostId !== null && findSshHost(db, input.sshHostId)?.projectId !== projectId) {
      throw new StewardServiceError('NOT_FOUND', 'that server is not in this project');
    }
    if (input.dockerContainer !== null && input.sshHostId === null) {
      // A container with no server would mean "this machine", which Steward only reads through its own Docker tab.
      throw new StewardServiceError('VALIDATION_FAILED', 'Choose the server where the container runs');
    }
  }

  function toView(record: ObservabilityServiceRecord): ObservabilityServiceEntry {
    return { ...record, environmentName: environmentName(record.projectId, record.environmentId) };
  }

  function assertServiceNameFree(projectId: string, environmentId: string | null, name: string, exceptId: string | null): void {
    const clash = findServiceByName(db, projectId, environmentId, name);
    if (clash !== null && clash.id !== exceptId) {
      throw new StewardServiceError('CONFLICT', 'a service with that name already exists in this environment');
    }
  }

  function seedDefaultSignals(projectId: string): void {
    if (listSignalsByProject(db, projectId).length > 0) return;
    const now = nowIso();
    DEFAULT_SIGNALS.forEach((signal, position) => {
      insertSignal(db, { id: uuidv7(), projectId, ...signal, position, createdAt: now });
    });
  }

  function listServices(input: ObservabilityServiceListInput): ObservabilityServiceEntry[] {
    requireProject(db, input.projectId);
    return listServicesByProject(db, input.projectId).map(toView);
  }

  function createService(input: ObservabilityServiceCreateInput): ObservabilityServiceEntry {
    requireProject(db, input.projectId);
    environmentName(input.projectId, input.environmentId);
    assertLinks(input.projectId, input);
    assertServiceNameFree(input.projectId, input.environmentId, input.name, null);
    const now = nowIso();
    const record: ObservabilityServiceRecord = {
      id: uuidv7(),
      projectId: input.projectId,
      environmentId: input.environmentId,
      name: input.name,
      repositoryId: input.repositoryId,
      logSelector: input.logSelector,
      metricMatcher: input.metricMatcher,
      sshHostId: input.sshHostId,
      dockerContainer: input.dockerContainer,
      createdAt: now,
      updatedAt: now
    };
    insertService(db, record);
    // The first service of a project brings the usual signals with it; they are the user's to edit afterwards.
    seedDefaultSignals(input.projectId);
    return toView(record);
  }

  function updateServiceEntry(input: ObservabilityServiceUpdateInput): ObservabilityServiceEntry {
    const record = requireService(input.id);
    environmentName(record.projectId, input.environmentId);
    assertLinks(record.projectId, input);
    assertServiceNameFree(record.projectId, input.environmentId, input.name, record.id);
    const updated: ObservabilityServiceRecord = {
      ...record,
      environmentId: input.environmentId,
      name: input.name,
      repositoryId: input.repositoryId,
      logSelector: input.logSelector,
      metricMatcher: input.metricMatcher,
      sshHostId: input.sshHostId,
      dockerContainer: input.dockerContainer,
      updatedAt: nowIso()
    };
    updateService(db, updated);
    return toView(updated);
  }

  function removeService(input: ObservabilityServiceIdInput): { id: string } {
    const record = requireService(input.id);
    deleteService(db, record.id);
    return { id: record.id };
  }

  function toSignalView(record: ObservabilitySignalRecord): ObservabilitySignal {
    return { ...record };
  }

  function listSignals(input: ObservabilitySignalListInput): ObservabilitySignal[] {
    requireProject(db, input.projectId);
    return listSignalsByProject(db, input.projectId).map(toSignalView);
  }

  function assertSignalNameFree(projectId: string, name: string, exceptId: string | null): void {
    const clash = findSignalByName(db, projectId, name);
    if (clash !== null && clash.id !== exceptId) {
      throw new StewardServiceError('CONFLICT', 'a signal with that name already exists in this project');
    }
  }

  function createSignal(input: ObservabilitySignalCreateInput): ObservabilitySignal {
    requireProject(db, input.projectId);
    assertTemplateConsistent(input.kind, input.queryTemplate);
    assertSignalNameFree(input.projectId, input.name, null);
    const existing = listSignalsByProject(db, input.projectId);
    const record: ObservabilitySignalRecord = {
      id: uuidv7(),
      projectId: input.projectId,
      name: input.name,
      kind: input.kind,
      queryTemplate: input.queryTemplate,
      unit: input.unit,
      position: existing.length === 0 ? 0 : Math.max(...existing.map((signal) => signal.position)) + 1,
      createdAt: nowIso()
    };
    insertSignal(db, record);
    return toSignalView(record);
  }

  function updateSignalEntry(input: ObservabilitySignalUpdateInput): ObservabilitySignal {
    const record = requireSignal(input.id);
    assertTemplateConsistent(input.kind, input.queryTemplate);
    assertSignalNameFree(record.projectId, input.name, record.id);
    const updated: ObservabilitySignalRecord = {
      ...record,
      name: input.name,
      kind: input.kind,
      queryTemplate: input.queryTemplate,
      unit: input.unit
    };
    updateSignal(db, updated);
    return toSignalView(updated);
  }

  function removeSignal(input: ObservabilitySignalIdInput): { id: string } {
    const record = requireSignal(input.id);
    deleteSignal(db, record.id);
    return { id: record.id };
  }

  /** A complete ordering only: merging a stale partial list is how the order silently drifts. */
  function reorderSignals(input: ObservabilitySignalReorderInput): ObservabilitySignal[] {
    requireProject(db, input.projectId);
    const existing = listSignalsByProject(db, input.projectId);
    const wanted = new Set(input.orderedIds);
    if (wanted.size !== input.orderedIds.length) {
      throw new StewardServiceError('VALIDATION_FAILED', 'The signal order contains duplicates');
    }
    if (wanted.size !== existing.length || existing.some((signal) => !wanted.has(signal.id))) {
      throw new StewardServiceError('CONFLICT', 'The list of signals changed. Reload and try again.');
    }
    input.orderedIds.forEach((id, position) => setSignalPosition(db, id, position));
    return listSignalsByProject(db, input.projectId).map(toSignalView);
  }

  function previewSignal(input: ObservabilitySignalPreviewInput): ObservabilitySignalPreview {
    const service = requireService(input.serviceId);
    return { query: renderSignalQuery(input.queryTemplate, service) };
  }

  return {
    listServices,
    createService,
    updateService: updateServiceEntry,
    removeService,
    listSignals,
    createSignal,
    updateSignal: updateSignalEntry,
    removeSignal,
    reorderSignals,
    previewSignal,
    requireService,
    listSignalRecords: (projectId: string): ObservabilitySignalRecord[] => listSignalsByProject(db, projectId)
  };
}

export type ObservabilityCatalogService = ReturnType<typeof createObservabilityCatalogService>;

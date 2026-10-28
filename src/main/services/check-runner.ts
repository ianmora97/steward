import {
  dnsCheckConfigSchema,
  httpCheckConfigSchema,
  tlsCheckConfigSchema,
  type CheckFinishedEvent
} from '@shared/schemas/cloud';
import { StewardServiceError } from '@shared/types/result';
import { findCheck, findDomain, insertResult, type CheckRecord, type CheckResultRecord } from '../db/cloud.repo';
import type { SqlDatabase } from '../db/driver';
import { nowIso, uuidv7 } from '../db/id';
import { runDnsCheck } from './check-dns';
import { runHttpCheck } from './check-http';
import { failure, type CheckOutcome } from './check-outcome';
import { runTlsCheck } from './check-tls';
import { redactSecrets } from './git-errors';

const MAX_SUMMARY_CHARS = 300;
const MAX_DETAIL_BYTES = 8 * 1024;
const MAX_DEPTH = 6;

export interface CheckRunnerDeps {
  db: SqlDatabase;
  /** Tells the page a check finished. */
  emit: (event: CheckFinishedEvent) => void;
}

/** Strings are masked wherever they sit; the shape is kept. A cap on depth keeps a hostile value from looping. */
function redactDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, depth + 1)]));
  }
  return value;
}

function sanitize(outcome: CheckOutcome): Pick<CheckResultRecord, 'summary' | 'detail'> {
  const summary = redactSecrets(outcome.summary).slice(0, MAX_SUMMARY_CHARS);
  const detail = redactDeep(outcome.detail) as Record<string, unknown>;
  // A detail that outgrows its cap is replaced, never cut: half of a JSON document is no document.
  if (Buffer.byteLength(JSON.stringify(detail)) > MAX_DETAIL_BYTES) return { summary, detail: { truncated: true } };
  return { summary, detail };
}

async function execute(check: CheckRecord, hostname: string, signal: AbortSignal): Promise<CheckOutcome> {
  switch (check.kind) {
    case 'dns':
      return runDnsCheck({ hostname, config: dnsCheckConfigSchema.parse(check.config), signal });
    case 'tls':
      return runTlsCheck({ hostname, config: tlsCheckConfigSchema.parse(check.config), signal });
    case 'http':
      return runHttpCheck({ hostname, config: httpCheckConfigSchema.parse(check.config), signal });
  }
}

/**
 * Runs one check, keeps the result and tells the page. What goes wrong at the destination is already a `fail`
 * outcome; what goes wrong here (a setting that no longer parses, a bug in an engine) is logged in main and kept as
 * a generic `fail`, so a broken check shows up as broken instead of silently not running. Resolves to `null` when the
 * check was deleted while it ran, and rejects with `CANCELLED` when it was stopped.
 */
export function createCheckRunner(deps: CheckRunnerDeps) {
  const { db, emit } = deps;

  return async function run(checkId: string, signal: AbortSignal): Promise<CheckResultRecord | null> {
    const check = findCheck(db, checkId);
    if (check === null || check.domainId === null) return null;
    const domain = findDomain(db, check.domainId);
    if (domain === null) return null;

    let outcome: CheckOutcome;
    try {
      outcome = await execute(check, domain.hostname, signal);
    } catch (error) {
      if (error instanceof StewardServiceError && error.code === 'CANCELLED') throw error;
      if (signal.aborted) throw error;
      console.error(`[steward] check ${check.kind} of ${domain.hostname} failed unexpectedly:`, error);
      outcome = failure('The check could not run because of an internal error');
    }

    const { summary, detail } = sanitize(outcome);
    const result: CheckResultRecord = {
      id: uuidv7(),
      checkId: check.id,
      ts: nowIso(),
      status: outcome.status,
      latencyMs: outcome.latencyMs,
      summary,
      detail
    };
    try {
      insertResult(db, result);
    } catch (error) {
      // The check (or its domain, or the project) was deleted while it ran: its result has nowhere to go.
      if (findCheck(db, check.id) === null) return null;
      throw error;
    }
    emit({ projectId: check.projectId, domainId: domain.id, checkId: check.id, result });
    return result;
  };
}

export type CheckRunner = ReturnType<typeof createCheckRunner>;

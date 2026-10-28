import type {
  CheckFinishedEvent,
  CheckIdInput,
  CheckResultsInput,
  CreateCheckInput,
  CreateDomainInput,
  DeleteCheckInput,
  DeleteDomainInput,
  ListChecksInput,
  ListDomainsInput,
  UpdateCheckInput,
  UpdateDomainInput
} from '@shared/schemas/cloud';
import type { SqlDatabase } from '../db/driver';
import { createCheckRunner } from './check-runner';
import { createCheckScheduler } from './check-scheduler';
import { createCheckService } from './check.service';
import { createDomainService } from './domain.service';

export interface CloudServiceDeps {
  db: SqlDatabase;
  /** Tells the page a check finished. */
  emitCheckFinished: (event: CheckFinishedEvent) => void;
}

/**
 * Cloud as the IPC layer sees it: the domains of a project and the checks that watch them. The checks start running
 * as soon as this is created and stop with `shutdown`: they only run while Steward is open.
 */
export function createCloudService(deps: CloudServiceDeps) {
  const runner = createCheckRunner({ db: deps.db, emit: deps.emitCheckFinished });
  const scheduler = createCheckScheduler({ db: deps.db, run: runner });
  const checks = createCheckService({ db: deps.db, scheduler });
  const domains = createDomainService({ db: deps.db, checks });
  scheduler.start();

  return {
    listDomains: (input: ListDomainsInput) => domains.list(input),
    createDomain: (input: CreateDomainInput) => domains.create(input),
    updateDomain: (input: UpdateDomainInput) => domains.update(input),
    removeDomain: (input: DeleteDomainInput) => domains.remove(input),
    listChecks: (input: ListChecksInput) => checks.list(input),
    createCheck: (input: CreateCheckInput) => checks.create(input),
    updateCheck: (input: UpdateCheckInput) => checks.update(input),
    removeCheck: (input: DeleteCheckInput) => checks.remove(input),
    runCheck: (input: CheckIdInput) => checks.runNow(input),
    checkResults: (input: CheckResultsInput) => checks.results(input),
    /** Called before a project is deleted: its checks stop now, and the rows cascade away with it. Nothing here is secret. */
    purgeProject: (projectId: string): void => scheduler.forgetProject(projectId),
    shutdown: (): void => scheduler.shutdown()
  };
}

export type CloudService = ReturnType<typeof createCloudService>;

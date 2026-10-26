import { StewardServiceError } from '@shared/types/result';
import type { DataConnectionRecord } from '../db/data-connection.repo';
import type { SqlDatabase } from '../db/driver';
import { findEnvironmentById } from '../db/environment.repo';
import { insertExecution, updateExecutionFinish } from '../db/execution.repo';
import { nowIso, uuidv7 } from '../db/id';
import { translateRedisError } from './redis-errors';
import type { RedisHandle, RedisPool } from './redis-pool';

export interface RedisAccessDeps {
  db: SqlDatabase;
  pool: RedisPool;
}

/**
 * What every Redis service needs before touching the server: the open handle, one place that turns failures
 * into the outcomes the page explains, the read-only rule, and the activity record of a write.
 */
export function createRedisAccess(deps: RedisAccessDeps) {
  const { db, pool } = deps;

  async function connect(connectionId: string): Promise<{ handle: RedisHandle; record: DataConnectionRecord }> {
    return pool.acquire(connectionId);
  }

  /** Every client failure leaves as one of the outcomes the page knows how to explain. */
  async function guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw translateRedisError(error);
    }
  }

  function protectedEnvironment(record: DataConnectionRecord): boolean {
    if (record.environmentId === null) return false;
    return findEnvironmentById(db, record.environmentId)?.isProtected === true;
  }

  /** The one check every write passes, in main: hiding buttons in the UI is not protection. */
  function assertWritable(record: DataConnectionRecord): void {
    if (record.readOnly) {
      throw new StewardServiceError(
        'CONNECTION_READ_ONLY',
        'This connection is read-only',
        'Turn off read-only in the connection\'s settings to change data.'
      );
    }
  }

  /** In a protected environment a destructive step also asks for the connection's name to be typed. */
  function assertTypedName(record: DataConnectionRecord, typed: string | undefined, force: boolean): void {
    if ((force || protectedEnvironment(record)) && typed !== record.name) {
      throw new StewardServiceError(
        'CONFIRMATION_REQUIRED',
        'Type the connection\'s name to confirm',
        `Type "${record.name}" to continue.`
      );
    }
  }

  /** Records a write in the activity history without its contents: the command and the key, never the value. */
  async function audited<T>(record: DataConnectionRecord, command: string, key: string, work: () => Promise<T>): Promise<T> {
    const executionId = uuidv7();
    const startedAt = nowIso();
    insertExecution(db, {
      id: executionId,
      projectId: record.projectId,
      repositoryId: null,
      kind: 'redis_write',
      context: 'remote',
      command: 'redis',
      args: [command, key],
      cwd: null,
      status: 'running',
      exitCode: null,
      confirmedByUser: true,
      startedAt,
      finishedAt: null,
      durationMs: null,
      errorCode: null,
      errorMessage: null,
      logPath: null,
      sshHostId: null
    });
    try {
      const result = await work();
      updateExecutionFinish(db, executionId, {
        status: 'succeeded',
        exitCode: 0,
        finishedAt: nowIso(),
        durationMs: Date.now() - Date.parse(startedAt),
        errorCode: null,
        errorMessage: null
      });
      return result;
    } catch (error) {
      const known = error instanceof StewardServiceError;
      updateExecutionFinish(db, executionId, {
        status: 'failed',
        exitCode: null,
        finishedAt: nowIso(),
        durationMs: Date.now() - Date.parse(startedAt),
        errorCode: known ? error.code : 'UNKNOWN',
        errorMessage: known ? error.message : 'the operation failed'
      });
      throw error;
    }
  }

  return { connect, guard, protectedEnvironment, assertWritable, assertTypedName, audited, pool };
}

export type RedisAccess = ReturnType<typeof createRedisAccess>;

import { DatabaseSync } from 'node:sqlite';

/**
 * The SQLite surface Steward depends on, kept deliberately small.
 *
 * The active implementation is `node:sqlite`, which ships inside Node and
 * therefore inside Electron: no native module to compile and no ABI to match
 * per Electron release. `better-sqlite3` was the first choice but publishes no
 * prebuilt binaries, so it requires a full C++ toolchain (MSVC on Windows) on
 * every machine that installs Steward's dependencies.
 *
 * Everything above this file uses only this interface, so swapping drivers is
 * a change to this file alone.
 */
export interface SqlRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export type SqlParams = Record<string, SqlValue> | SqlValue[];
export type SqlValue = string | number | null;

export interface SqlStatement {
  run: (params?: SqlParams) => SqlRunResult;
  get: <T>(params?: SqlParams) => T | undefined;
  all: <T>(params?: SqlParams) => T[];
}

export interface SqlDatabase {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqlStatement;
  close: () => void;
  /** Runs `fn` inside a transaction, rolling back if it throws. */
  transaction: <T>(fn: () => T) => T;
  readonly driverName: string;
}

function toArgs(params?: SqlParams): [] | [SqlParams] {
  return params === undefined ? [] : [params];
}

export function openSqlDatabase(filePath: string): SqlDatabase {
  const db = new DatabaseSync(filePath);

  const database: SqlDatabase = {
    driverName: 'node:sqlite',
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        run: (params) => {
          const result = statement.run(...(toArgs(params) as never[]));
          return {
            changes: Number(result.changes),
            lastInsertRowid: result.lastInsertRowid as number | bigint
          };
        },
        get: <T>(params?: SqlParams) => statement.get(...(toArgs(params) as never[])) as T | undefined,
        all: <T>(params?: SqlParams) => statement.all(...(toArgs(params) as never[])) as T[]
      };
    },
    close: () => db.close(),
    transaction: <T>(fn: () => T): T => {
      db.exec('BEGIN');
      try {
        const value = fn();
        db.exec('COMMIT');
        return value;
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // A rollback failure must not mask the original error.
        }
        throw error;
      }
    }
  };

  return database;
}

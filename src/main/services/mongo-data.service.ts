import type { Document } from 'bson';
import type { Collection, MongoClient } from 'mongodb';
import {
  MONGO_FIND_LIMIT_DEFAULT,
  MONGO_INSERT_MAX_DOCS,
  MONGO_MAX_TIME_DEFAULT_MS,
  MONGO_RESPONSE_MAX_BYTES,
  type MongoAggregateExplainInput,
  type MongoAggregateInput,
  type MongoAggregateResult,
  type MongoCollectionInfo,
  type MongoCollectionStats,
  type MongoCountInput,
  type MongoCountResult,
  type MongoCreateCollectionInput,
  type MongoDatabaseInfo,
  type MongoDatabaseInput,
  type MongoDeleteManyInput,
  type MongoDeleteOneInput,
  type MongoDocument,
  type MongoDropCollectionInput,
  type MongoDropDatabaseInput,
  type MongoExplainInput,
  type MongoExplainSummary,
  type MongoFindInput,
  type MongoFindResult,
  type MongoIndex,
  type MongoIndexCreateInput,
  type MongoIndexDropInput,
  type MongoInsertInput,
  type MongoInsertResult,
  type MongoNamespaceInput,
  type MongoReplaceInput,
  type MongoSavedQuery,
  type MongoSavedQueryDeleteInput,
  type MongoSavedQueryListInput,
  type MongoSavedQuerySaveInput,
  type MongoSchemaInput,
  type MongoSchemaResult,
  type MongoUpdateManyInput,
  type MongoValidation,
  type MongoValidationSetInput,
  type MongoWriteResult,
  type MongoConnectionIdInput
} from '@shared/schemas/mongodb';
import { StewardServiceError } from '@shared/types/result';
import {
  deleteSavedQuery,
  insertSavedQuery,
  listSavedQueries,
  type DataConnectionRecord
} from '../db/data-connection.repo';
import type { SqlDatabase } from '../db/driver';
import { findEnvironmentById } from '../db/environment.repo';
import { insertExecution, updateExecutionFinish } from '../db/execution.repo';
import { nowIso, uuidv7 } from '../db/id';
import { translateMongoError } from './mongo-errors';
import {
  fromEjson,
  parseArrayText,
  parseDocumentsText,
  parseObjectText,
  toEjson,
  toMongoDocument
} from './mongo-ejson';
import type { MongoPool } from './mongo-pool';
import { analyzeSchema } from './mongo-schema';

/**
 * Documents are read without promoting BSON values to JavaScript numbers. Promotion turns an Int32 and a Double that
 * hold the same whole number into the same JS number, so editing a document would silently change a field's type.
 */
const RAW_VALUES = { promoteValues: false } as const;

const AGGREGATE_PREVIEW_LIMIT = 20;
const AGGREGATE_RUN_LIMIT = 1000;

type Json = Record<string, unknown>;

function rec(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Plain counters can arrive as numbers or as 64-bit values; either reads as a number here. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    const converted = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(converted) ? converted : null;
  }
  return null;
}

/**
 * What an explain says in one glance: whether it scanned an index or the whole collection, how much it
 * examined, how long it took. Works on the plain and the sharded shapes; the full output is kept alongside.
 */
export function summarizeExplain(explain: Document): MongoExplainSummary {
  const root = rec(explain);
  const shards = rec(rec(root['queryPlanner'])['winningPlan'])['shards'];
  const firstShard = Array.isArray(shards) ? rec(shards[0]) : null;
  const planner = rec(firstShard === null ? root['queryPlanner'] : firstShard['queryPlanner'] ?? root['queryPlanner']);
  const winning = rec(planner['winningPlan']);
  const stats = rec(firstShard === null ? root['executionStats'] : firstShard['executionStats'] ?? root['executionStats']);

  const stages: string[] = [];
  let indexName: string | null = null;
  const visit = (node: unknown, depth: number): void => {
    const plan = rec(node);
    if (depth > 12) return;
    const stage = str(plan['stage']);
    if (stage !== null) {
      stages.push(stage);
      if (stage === 'IXSCAN' && indexName === null) indexName = str(plan['indexName']);
    }
    for (const key of ['queryPlan', 'inputStage', 'winningPlan']) if (plan[key] !== undefined) visit(plan[key], depth + 1);
    const many = plan['inputStages'];
    if (Array.isArray(many)) for (const child of many) visit(child, depth + 1);
  };
  visit(winning, 0);

  const stage = stages.includes('COLLSCAN') ? 'COLLSCAN' : stages.includes('IXSCAN') ? 'IXSCAN' : (stages[0] ?? 'UNKNOWN');
  return {
    stage,
    indexName: stage === 'IXSCAN' ? indexName : null,
    usesIndex: stage === 'IXSCAN' || stages.includes('IXSCAN'),
    nReturned: asNumber(stats['nReturned']),
    keysExamined: asNumber(stats['totalKeysExamined']),
    docsExamined: asNumber(stats['totalDocsExamined']),
    executionTimeMillis: asNumber(stats['executionTimeMillis']),
    raw: toEjson(explain)
  };
}

const WRITE_STAGES = ['$out', '$merge'];

export interface MongoDataDeps {
  db: SqlDatabase;
  pool: MongoPool;
}

export function createMongoDataService(deps: MongoDataDeps) {
  const { db, pool } = deps;

  async function connect(connectionId: string): Promise<{ client: MongoClient; record: DataConnectionRecord }> {
    return pool.acquire(connectionId);
  }

  function collectionOf(client: MongoClient, input: { db: string; collection: string }): Collection<Document> {
    return client.db(input.db).collection<Document>(input.collection);
  }

  /** Every driver failure leaves as one of the outcomes the page knows how to explain. */
  async function guard<T>(record: DataConnectionRecord, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw translateMongoError(error, record.hostDisplay);
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

  /** Records a write in the activity history without its contents: what happened and where, not the data. */
  async function audited<T>(record: DataConnectionRecord, operation: string, namespace: string, work: () => Promise<T>): Promise<T> {
    const executionId = uuidv7();
    const startedAt = nowIso();
    insertExecution(db, {
      id: executionId,
      projectId: record.projectId,
      repositoryId: null,
      kind: 'mongo_write',
      context: 'remote',
      command: 'mongodb',
      args: [operation, namespace],
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

  // ── exploring ────────────────────────────────────────────────────────────

  async function listDatabases(input: MongoConnectionIdInput): Promise<MongoDatabaseInfo[]> {
    const { client, record } = await connect(input.id);
    return guard(record, async () => {
      // authorizedDatabases: a user without the cluster-wide privilege still sees the databases it can use.
      const result = await client.db('admin').admin().listDatabases({ authorizedDatabases: true });
      return result.databases
        .map((database) => ({ name: database.name, sizeOnDisk: asNumber(database.sizeOnDisk), empty: database.empty === true }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async function listCollections(input: MongoDatabaseInput): Promise<MongoCollectionInfo[]> {
    const { client, record } = await connect(input.connectionId);
    return guard(record, async () => {
      const found = await client.db(input.db).listCollections().toArray();
      return found
        .map<MongoCollectionInfo>((entry) => ({
          name: entry.name,
          type: entry.type === 'view' ? 'view' : rec(rec(entry)['options'])['timeseries'] !== undefined ? 'timeseries' : 'collection'
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async function collectionStats(input: MongoNamespaceInput): Promise<MongoCollectionStats> {
    const { client, record } = await connect(input.connectionId);
    return guard(record, async () => {
      const collection = collectionOf(client, input);
      const empty: MongoCollectionStats = {
        documentCount: null,
        size: null,
        avgObjSize: null,
        storageSize: null,
        indexCount: null,
        totalIndexSize: null
      };
      try {
        const [stats] = await collection.aggregate([{ $collStats: { storageStats: {} } }], { maxTimeMS: 10_000 }).toArray();
        const storage = rec(rec(stats)['storageStats']);
        return {
          documentCount: asNumber(storage['count']),
          size: asNumber(storage['size']),
          avgObjSize: asNumber(storage['avgObjSize']),
          storageSize: asNumber(storage['storageSize']),
          indexCount: asNumber(storage['nindexes']),
          totalIndexSize: asNumber(storage['totalIndexSize'])
        };
      } catch {
        // Views and some permission sets have no $collStats: an estimate is better than nothing.
        const count = await collection.estimatedDocumentCount({ maxTimeMS: 10_000 }).catch(() => null);
        return { ...empty, documentCount: count };
      }
    });
  }

  // ── reading ──────────────────────────────────────────────────────────────

  async function find(input: MongoFindInput): Promise<MongoFindResult> {
    const { client, record } = await connect(input.connectionId);
    const filter = parseObjectText(input.filter, 'The filter');
    const projection = input.project?.trim() ? parseObjectText(input.project, 'The projection') : undefined;
    const sort = input.sort?.trim() ? parseObjectText(input.sort, 'The sort') : undefined;
    const limit = input.limit ?? MONGO_FIND_LIMIT_DEFAULT;
    const started = Date.now();

    return guard(record, async () => {
      const cursor = collectionOf(client, input).find(filter, {
        ...(projection === undefined ? {} : { projection }),
        ...(sort === undefined ? {} : { sort }),
        skip: input.skip ?? 0,
        limit: limit + 1,
        maxTimeMS: input.maxTimeMS ?? MONGO_MAX_TIME_DEFAULT_MS,
        ...RAW_VALUES
      });
      const documents: MongoDocument[] = [];
      let bytes = 0;
      let hasMore = false;
      let truncated = false;
      try {
        for await (const document of cursor) {
          if (documents.length >= limit) {
            hasMore = true;
            break;
          }
          const converted = toMongoDocument(document);
          if (bytes + converted.json.length > MONGO_RESPONSE_MAX_BYTES && documents.length > 0) {
            hasMore = true;
            truncated = true;
            break;
          }
          bytes += converted.json.length;
          documents.push(converted);
        }
      } finally {
        await cursor.close().catch(() => undefined);
      }
      return { documents, hasMore, truncated, elapsedMs: Date.now() - started };
    });
  }

  async function count(input: MongoCountInput): Promise<MongoCountResult> {
    const { client, record } = await connect(input.connectionId);
    const filter = parseObjectText(input.filter, 'The filter');
    const maxTimeMS = input.maxTimeMS ?? MONGO_MAX_TIME_DEFAULT_MS;
    return guard(record, async () => {
      const collection = collectionOf(client, input);
      if (Object.keys(filter).length === 0 && input.exact !== true) {
        return { count: await collection.estimatedDocumentCount({ maxTimeMS }), estimated: true };
      }
      return { count: await collection.countDocuments(filter, { maxTimeMS }), estimated: false };
    });
  }

  async function explain(input: MongoExplainInput): Promise<MongoExplainSummary> {
    const { client, record } = await connect(input.connectionId);
    const filter = parseObjectText(input.filter, 'The filter');
    const sort = input.sort?.trim() ? parseObjectText(input.sort, 'The sort') : undefined;
    return guard(record, async () => {
      const cursor = collectionOf(client, input).find(filter, {
        ...(sort === undefined ? {} : { sort }),
        maxTimeMS: input.maxTimeMS ?? MONGO_MAX_TIME_DEFAULT_MS
      });
      return summarizeExplain(await cursor.explain('executionStats'));
    });
  }

  // ── writing ──────────────────────────────────────────────────────────────

  async function insert(input: MongoInsertInput): Promise<MongoInsertResult> {
    const { client, record } = await connect(input.connectionId);
    assertWritable(record);
    const documents = parseDocumentsText(input.documents, 'The document');
    if (documents.length > MONGO_INSERT_MAX_DOCS) {
      throw new StewardServiceError('MONGO_QUERY_INVALID', `at most ${MONGO_INSERT_MAX_DOCS} documents can be inserted at once`, 'Use Import for more.');
    }
    return audited(record, 'insert', `${input.db}.${input.collection}`, () =>
      guard(record, async () => {
        const result = await collectionOf(client, input).insertMany(documents);
        return { insertedCount: result.insertedCount };
      })
    );
  }

  async function replace(input: MongoReplaceInput): Promise<MongoWriteResult> {
    const { client, record } = await connect(input.connectionId);
    assertWritable(record);
    const id = fromEjson(input.id, 'The document id');
    const replacement = parseObjectText(input.document, 'The document', false);
    return audited(record, 'replace', `${input.db}.${input.collection}`, () =>
      guard(record, async () => {
        const collection = collectionOf(client, input);
        const current = await collection.findOne({ _id: id } as Document, RAW_VALUES);
        if (current === null) throw new StewardServiceError('NOT_FOUND', 'That document no longer exists');
        // Someone else may have changed it since it was loaded: say so instead of overwriting their change.
        if (input.force !== true && toEjson(current) !== input.expected) {
          throw new StewardServiceError(
            'MONGO_DOC_CHANGED',
            'This document changed on the server since you opened it',
            'Reload it to see the new version, or save anyway to overwrite it.'
          );
        }
        const result = await collection.replaceOne({ _id: id } as Document, replacement);
        return { count: result.modifiedCount };
      })
    );
  }

  async function deleteOne(input: MongoDeleteOneInput): Promise<MongoWriteResult> {
    const { client, record } = await connect(input.connectionId);
    assertWritable(record);
    const id = fromEjson(input.id, 'The document id');
    return audited(record, 'deleteOne', `${input.db}.${input.collection}`, () =>
      guard(record, async () => {
        const result = await collectionOf(client, input).deleteOne({ _id: id } as Document);
        return { count: result.deletedCount };
      })
    );
  }

  /**
   * Many documents at once: the number the user saw must still be the number it would touch, and an empty
   * filter (every document) needs the collection's name typed.
   */
  async function checkedMatch(
    record: DataConnectionRecord,
    collection: Collection<Document>,
    filterText: string,
    expectedCount: number,
    confirmCollection: string | undefined,
    collectionName: string
  ): Promise<Document> {
    const filter = parseObjectText(filterText, 'The filter');
    if (Object.keys(filter).length === 0 && confirmCollection !== collectionName) {
      throw new StewardServiceError(
        'CONFIRMATION_REQUIRED',
        'An empty filter matches every document',
        `Type the collection's name (${collectionName}) to confirm.`
      );
    }
    const actual = await guard(record, () => collection.countDocuments(filter, { maxTimeMS: MONGO_MAX_TIME_DEFAULT_MS }));
    if (actual !== expectedCount) {
      throw new StewardServiceError(
        'MONGO_COUNT_MISMATCH',
        `The filter now matches ${actual} documents, not ${expectedCount}`,
        'The data changed since you looked. Check the count again before confirming.'
      );
    }
    return filter;
  }

  async function deleteMany(input: MongoDeleteManyInput): Promise<MongoWriteResult> {
    const { client, record } = await connect(input.connectionId);
    assertWritable(record);
    const collection = collectionOf(client, input);
    const filter = await checkedMatch(record, collection, input.filter, input.expectedCount, input.confirmCollection, input.collection);
    return audited(record, 'deleteMany', `${input.db}.${input.collection}`, () =>
      guard(record, async () => ({ count: (await collection.deleteMany(filter)).deletedCount }))
    );
  }

  async function updateMany(input: MongoUpdateManyInput): Promise<MongoWriteResult> {
    const { client, record } = await connect(input.connectionId);
    assertWritable(record);
    const collection = collectionOf(client, input);
    const update = input.update.trim().startsWith('[')
      ? parseArrayText(input.update, 'The update')
      : parseObjectText(input.update, 'The update', false);
    if (!Array.isArray(update) && !Object.keys(update).every((key) => key.startsWith('$'))) {
      throw new StewardServiceError('MONGO_QUERY_INVALID', 'The update must use operators', 'For example { $set: { status: "done" } }.');
    }
    const filter = await checkedMatch(record, collection, input.filter, input.expectedCount, input.confirmCollection, input.collection);
    return audited(record, 'updateMany', `${input.db}.${input.collection}`, () =>
      guard(record, async () => ({ count: (await collection.updateMany(filter, update)).modifiedCount }))
    );
  }

  async function createCollection(input: MongoCreateCollectionInput): Promise<{ collection: string }> {
    const { client, record } = await connect(input.connectionId);
    assertWritable(record);
    return audited(record, 'createCollection', `${input.db}.${input.collection}`, () =>
      guard(record, async () => {
        await client.db(input.db).createCollection(input.collection);
        return { collection: input.collection };
      })
    );
  }

  /** Dropping needs the exact name typed, and on a protected connection the connection's own name too. */
  function assertDropConfirmed(record: DataConnectionRecord, name: string, confirmName: string, confirmConnection: string | undefined): void {
    if (confirmName !== name) {
      throw new StewardServiceError('CONFIRMATION_MISMATCH', 'That is not the exact name', `Type ${name} to confirm.`);
    }
    if (protectedEnvironment(record) && confirmConnection !== record.name) {
      throw new StewardServiceError(
        'CONFIRMATION_REQUIRED',
        `${record.name} is in a protected environment`,
        `Also type the connection's name (${record.name}).`
      );
    }
  }

  async function dropCollection(input: MongoDropCollectionInput): Promise<{ collection: string }> {
    const { client, record } = await connect(input.connectionId);
    assertWritable(record);
    assertDropConfirmed(record, input.collection, input.confirmName, input.confirmConnection);
    return audited(record, 'dropCollection', `${input.db}.${input.collection}`, () =>
      guard(record, async () => {
        await client.db(input.db).dropCollection(input.collection);
        return { collection: input.collection };
      })
    );
  }

  async function dropDatabase(input: MongoDropDatabaseInput): Promise<{ db: string }> {
    const { client, record } = await connect(input.connectionId);
    assertWritable(record);
    assertDropConfirmed(record, input.db, input.confirmName, input.confirmConnection);
    return audited(record, 'dropDatabase', input.db, () =>
      guard(record, async () => {
        await client.db(input.db).dropDatabase();
        return { db: input.db };
      })
    );
  }

  // ── aggregation ──────────────────────────────────────────────────────────

  function parsePipeline(text: string, record: DataConnectionRecord, confirmedWrite: boolean | undefined): Document[] {
    const stages = parseArrayText(text, 'The pipeline');
    const writes = stages.some((stage) => Object.keys(stage).some((key) => WRITE_STAGES.includes(key)));
    if (writes) {
      assertWritable(record);
      if (confirmedWrite !== true) {
        throw new StewardServiceError(
          'CONFIRMATION_REQUIRED',
          '$out and $merge write to the database',
          'Confirm that this pipeline may write.'
        );
      }
    }
    return stages;
  }

  async function aggregate(input: MongoAggregateInput): Promise<MongoAggregateResult> {
    const { client, record } = await connect(input.connectionId);
    const stageLimit = input.previewUpToStage;
    const preview = stageLimit !== undefined;
    // A preview strips write stages, so only a real run has to be allowed to write.
    const stages = preview ? parseArrayText(input.pipeline, 'The pipeline') : parsePipeline(input.pipeline, record, input.confirmedWrite);
    // A preview never writes and never returns more than a screenful, however the pipeline ends.
    const pipeline = preview
      ? [
          ...stages
            .slice(0, stageLimit + 1)
            .filter((stage) => !Object.keys(stage).some((key) => WRITE_STAGES.includes(key))),
          { $limit: AGGREGATE_PREVIEW_LIMIT }
        ]
      : stages;
    const started = Date.now();

    const run = (): Promise<MongoAggregateResult> =>
      guard(record, async () => {
        const cursor = collectionOf(client, input).aggregate(pipeline, {
          allowDiskUse: input.allowDiskUse === true,
          maxTimeMS: input.maxTimeMS ?? MONGO_MAX_TIME_DEFAULT_MS,
          ...RAW_VALUES
        });
        const documents: MongoDocument[] = [];
        let bytes = 0;
        let truncated = false;
        try {
          for await (const document of cursor) {
            if (documents.length >= AGGREGATE_RUN_LIMIT) {
              truncated = true;
              break;
            }
            const converted = toMongoDocument(document);
            if (bytes + converted.json.length > MONGO_RESPONSE_MAX_BYTES && documents.length > 0) {
              truncated = true;
              break;
            }
            bytes += converted.json.length;
            documents.push(converted);
          }
        } finally {
          await cursor.close().catch(() => undefined);
        }
        return { documents, truncated, elapsedMs: Date.now() - started };
      });

    const writes = !preview && stages.some((stage) => Object.keys(stage).some((key) => WRITE_STAGES.includes(key)));
    return writes ? audited(record, 'aggregate-write', `${input.db}.${input.collection}`, run) : run();
  }

  async function explainAggregate(input: MongoAggregateExplainInput): Promise<MongoExplainSummary> {
    const { client, record } = await connect(input.connectionId);
    // Explaining a pipeline never runs its write stage, but it is still refused on a read-only connection with one.
    const stages = parseArrayText(input.pipeline, 'The pipeline');
    return guard(record, async () => {
      const explained = await collectionOf(client, input)
        .aggregate(stages, { maxTimeMS: input.maxTimeMS ?? MONGO_MAX_TIME_DEFAULT_MS })
        .explain('executionStats');
      return summarizeExplain(explained);
    });
  }

  // ── indexes ──────────────────────────────────────────────────────────────

  async function listIndexes(input: MongoNamespaceInput): Promise<MongoIndex[]> {
    const { client, record } = await connect(input.connectionId);
    return guard(record, async () => {
      const collection = collectionOf(client, input);
      const specs = await collection.indexes();

      const usage = new Map<string, number>();
      const sizes = new Map<string, number>();
      // Usage and size are extras: a view, or a user without the privilege, simply shows blanks.
      try {
        for (const entry of await collection.aggregate([{ $indexStats: {} }]).toArray()) {
          const name = str(entry['name']);
          const accesses = asNumber(rec(entry['accesses'])['ops']);
          if (name !== null && accesses !== null) usage.set(name, accesses);
        }
      } catch {
        // ignored on purpose
      }
      try {
        const [stats] = await collection.aggregate([{ $collStats: { storageStats: {} } }]).toArray();
        for (const [name, size] of Object.entries(rec(rec(rec(stats)['storageStats'])['indexSizes']))) {
          const bytes = asNumber(size);
          if (bytes !== null) sizes.set(name, bytes);
        }
      } catch {
        // ignored on purpose
      }

      return specs.map<MongoIndex>((spec) => {
        const name = String(spec.name);
        return {
          name,
          keys: Object.entries(rec(spec.key))
            .map(([field, direction]) => `${field}: ${String(direction)}`)
            .join(', '),
          unique: spec.unique === true,
          sparse: spec.sparse === true,
          expireAfterSeconds: asNumber(spec.expireAfterSeconds),
          partial: spec.partialFilterExpression !== undefined,
          accesses: usage.get(name) ?? null,
          sizeBytes: sizes.get(name) ?? null
        };
      });
    });
  }

  async function createIndex(input: MongoIndexCreateInput): Promise<{ name: string }> {
    const { client, record } = await connect(input.connectionId);
    assertWritable(record);
    if (protectedEnvironment(record) && input.confirmed !== true) {
      throw new StewardServiceError(
        'CONFIRMATION_REQUIRED',
        'Building an index can slow a busy database',
        'This connection is in a protected environment: confirm that you want to build it.'
      );
    }
    const keys = parseObjectText(input.keys, 'The index keys', false);
    const partial = input.partialFilterExpression?.trim() ? parseObjectText(input.partialFilterExpression, 'The partial filter') : undefined;
    return audited(record, 'createIndex', `${input.db}.${input.collection}`, () =>
      guard(record, async () => {
        const name = await collectionOf(client, input).createIndex(keys as Record<string, 1 | -1>, {
          ...(input.name === undefined || input.name === '' ? {} : { name: input.name }),
          ...(input.unique === true ? { unique: true } : {}),
          ...(input.sparse === true ? { sparse: true } : {}),
          ...(input.expireAfterSeconds === undefined ? {} : { expireAfterSeconds: input.expireAfterSeconds }),
          ...(partial === undefined ? {} : { partialFilterExpression: partial })
        });
        return { name };
      })
    );
  }

  async function dropIndex(input: MongoIndexDropInput): Promise<{ name: string }> {
    const { client, record } = await connect(input.connectionId);
    assertWritable(record);
    if (input.name === '_id_') throw new StewardServiceError('VALIDATION_FAILED', 'The _id index cannot be dropped');
    return audited(record, 'dropIndex', `${input.db}.${input.collection}`, () =>
      guard(record, async () => {
        await collectionOf(client, input).dropIndex(input.name);
        return { name: input.name };
      })
    );
  }

  // ── schema and validation ────────────────────────────────────────────────

  async function analyzeSchemaOf(input: MongoSchemaInput): Promise<MongoSchemaResult> {
    const { client, record } = await connect(input.connectionId);
    return guard(record, async () => {
      const sample = await collectionOf(client, input)
        .aggregate([{ $sample: { size: input.sampleSize ?? 1000 } }], { maxTimeMS: MONGO_MAX_TIME_DEFAULT_MS, ...RAW_VALUES })
        .toArray();
      return { sampled: sample.length, fields: analyzeSchema(sample) };
    });
  }

  function validationOf(options: Json): MongoValidation {
    const level = str(options['validationLevel']);
    const action = str(options['validationAction']);
    return {
      validator: options['validator'] === undefined ? '' : toEjson(options['validator']),
      validationLevel: level === 'off' || level === 'moderate' ? level : 'strict',
      validationAction: action === 'warn' ? 'warn' : 'error'
    };
  }

  async function getValidation(input: MongoNamespaceInput): Promise<MongoValidation> {
    const { client, record } = await connect(input.connectionId);
    return guard(record, async () => {
      const [found] = await client.db(input.db).listCollections({ name: input.collection }).toArray();
      return validationOf(rec(rec(found)['options']));
    });
  }

  async function setValidation(input: MongoValidationSetInput): Promise<MongoValidation> {
    const { client, record } = await connect(input.connectionId);
    assertWritable(record);
    const validator = parseObjectText(input.validator, 'The validator');
    return audited(record, 'setValidation', `${input.db}.${input.collection}`, () =>
      guard(record, async () => {
        await client.db(input.db).command({
          collMod: input.collection,
          validator,
          validationLevel: input.validationLevel,
          validationAction: input.validationAction
        });
        return { validator: toEjson(validator), validationLevel: input.validationLevel, validationAction: input.validationAction };
      })
    );
  }

  // ── saved queries ────────────────────────────────────────────────────────

  function listSaved(input: MongoSavedQueryListInput): MongoSavedQuery[] {
    return listSavedQueries(db, input.connectionId, `${input.db}.${input.collection}`);
  }

  function saveQuery(input: MongoSavedQuerySaveInput): MongoSavedQuery {
    const saved: MongoSavedQuery = {
      id: uuidv7(),
      connectionId: input.connectionId,
      namespace: `${input.db}.${input.collection}`,
      name: input.name,
      kind: input.kind,
      body: input.body,
      createdAt: nowIso()
    };
    insertSavedQuery(db, saved);
    return saved;
  }

  function deleteSaved(input: MongoSavedQueryDeleteInput): { id: string } {
    if (deleteSavedQuery(db, input.id) === 0) throw new StewardServiceError('NOT_FOUND', 'that saved query no longer exists');
    return { id: input.id };
  }

  return {
    listDatabases,
    listCollections,
    collectionStats,
    find,
    count,
    explain,
    insert,
    replace,
    deleteOne,
    deleteMany,
    updateMany,
    createCollection,
    dropCollection,
    dropDatabase,
    aggregate,
    explainAggregate,
    listIndexes,
    createIndex,
    dropIndex,
    analyzeSchema: analyzeSchemaOf,
    getValidation,
    setValidation,
    listSavedQueries: listSaved,
    saveQuery,
    deleteSavedQuery: deleteSaved,
    // Shared with the import/export module.
    connect,
    guard,
    assertWritable,
    audited,
    collectionOf
  };
}

export type MongoDataService = ReturnType<typeof createMongoDataService>;

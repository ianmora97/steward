import type { SqlDatabase } from '../db/driver';
import type { SecretStore } from '../security/secret-store';
import { createMongoConnectionService } from './mongo-connection.service';
import { createMongoDataService } from './mongo-data.service';
import { createMongoIoService, type MongoDialogs } from './mongo-io.service';
import { createMongoPool } from './mongo-pool';

export interface MongoServiceDeps {
  db: SqlDatabase;
  secrets: SecretStore;
  dialogs: MongoDialogs;
}

/** MongoDB as the IPC layer sees it: connections, data and import/export behind one object. */
export function createMongoService(deps: MongoServiceDeps) {
  const pool = createMongoPool({ db: deps.db, secrets: deps.secrets });
  const connections = createMongoConnectionService({ db: deps.db, secrets: deps.secrets, pool });
  const data = createMongoDataService({ db: deps.db, pool });
  const io = createMongoIoService({ data, dialogs: deps.dialogs });

  return {
    listConnections: connections.list,
    createConnection: connections.create,
    updateConnection: connections.update,
    removeConnection: connections.remove,
    testConnection: connections.test,
    testDraft: connections.testDraft,
    purgeProject: connections.purgeProject,
    pickFile: io.pickFile,
    exportQuery: io.exportQuery,
    importFile: io.importFile,
    listDatabases: data.listDatabases,
    listCollections: data.listCollections,
    collectionStats: data.collectionStats,
    find: data.find,
    count: data.count,
    explain: data.explain,
    insert: data.insert,
    replace: data.replace,
    deleteOne: data.deleteOne,
    deleteMany: data.deleteMany,
    updateMany: data.updateMany,
    createCollection: data.createCollection,
    dropCollection: data.dropCollection,
    dropDatabase: data.dropDatabase,
    aggregate: data.aggregate,
    explainAggregate: data.explainAggregate,
    listIndexes: data.listIndexes,
    createIndex: data.createIndex,
    dropIndex: data.dropIndex,
    analyzeSchema: data.analyzeSchema,
    getValidation: data.getValidation,
    setValidation: data.setValidation,
    listSavedQueries: data.listSavedQueries,
    saveQuery: data.saveQuery,
    deleteSavedQuery: data.deleteSavedQuery,
    shutdown: (): Promise<void> => pool.closeAll()
  };
}

export type MongoService = ReturnType<typeof createMongoService>;

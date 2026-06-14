import { createMongoAuditStore, type MongoAuditCollection } from "@veritio/storage";

export interface MongoTransactionContext {
  collection?: MongoAuditCollection;
  options?: Record<string, unknown>;
}

export interface MongoAuditStoreHost {
  collection: MongoAuditCollection;
  withTransaction<T>(run: (context: MongoTransactionContext) => Promise<T>): Promise<T>;
}

export function createMongoServerAuditStore(host: MongoAuditStoreHost) {
  return createMongoAuditStore({
    collection: host.collection,
    transaction: host.withTransaction,
  });
}

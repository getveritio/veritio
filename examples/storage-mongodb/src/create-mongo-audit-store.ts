import { createMongoAuditStore, type MongoAuditCollection } from "@veritio/storage";

export interface MongoTransactionContext {
  collection?: MongoAuditCollection;
  options?: Record<string, unknown>;
}

export interface MongoAuditStoreHost {
  collection: MongoAuditCollection;
  withTransaction<T>(run: (context: MongoTransactionContext) => Promise<T>): Promise<T>;
}

/**
 * Creates a Mongo AuditStore from host-injected collection and transaction
 * hooks, keeping driver sessions outside the OSS adapter boundary.
 */
export function createMongoServerAuditStore(host: MongoAuditStoreHost) {
  return createMongoAuditStore({
    collection: host.collection,
    transaction: host.withTransaction,
  });
}

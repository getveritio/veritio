import {
  createNeonAuditStore,
  createPostgresAuditStore,
  type SqlAuditExecutor,
  type SqlAuditStoreOptions,
} from "@veritio/storage";

export type PostgresAuditExecutor = SqlAuditExecutor;
export type PostgresAuditStoreOptions = SqlAuditStoreOptions;

export function createPostgresServerAuditStore(options: PostgresAuditStoreOptions) {
  return createPostgresAuditStore(options);
}

export function createNeonServerAuditStore(options: PostgresAuditStoreOptions) {
  return createNeonAuditStore(options);
}

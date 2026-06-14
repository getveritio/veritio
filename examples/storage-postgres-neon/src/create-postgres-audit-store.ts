import {
  createNeonAuditStore,
  createPostgresAuditStore,
  type SqlAuditExecutor,
  type SqlAuditStoreOptions,
} from "@veritio/storage";

export type PostgresAuditExecutor = SqlAuditExecutor;
export type PostgresAuditStoreOptions = SqlAuditStoreOptions;

/**
 * Creates a Postgres AuditStore from a host-injected executor instead of reading
 * database configuration inside the example.
 */
export function createPostgresServerAuditStore(options: PostgresAuditStoreOptions) {
  return createPostgresAuditStore(options);
}

/**
 * Creates a Neon AuditStore through the Postgres-compatible storage adapter.
 */
export function createNeonServerAuditStore(options: PostgresAuditStoreOptions) {
  return createNeonAuditStore(options);
}

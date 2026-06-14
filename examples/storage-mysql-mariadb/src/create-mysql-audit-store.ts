import {
  createMariaDbAuditStore,
  createMysqlAuditStore,
  type SqlAuditExecutor,
  type SqlAuditStoreOptions,
} from "@veritio/storage";

export type MySqlAuditExecutor = SqlAuditExecutor;
export type MySqlAuditStoreOptions = SqlAuditStoreOptions;

/**
 * Creates a MySQL AuditStore from a host-injected executor instead of reading
 * database configuration inside the example.
 */
export function createMySqlServerAuditStore(options: MySqlAuditStoreOptions) {
  return createMysqlAuditStore(options);
}

/**
 * Creates a MariaDB AuditStore through the MySQL-compatible storage adapter.
 */
export function createMariaDbServerAuditStore(options: MySqlAuditStoreOptions) {
  return createMariaDbAuditStore(options);
}

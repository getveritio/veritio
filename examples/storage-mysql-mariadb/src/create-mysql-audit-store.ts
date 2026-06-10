import {
  createMariaDbAuditStore,
  createMysqlAuditStore,
  type SqlAuditExecutor,
  type SqlAuditStoreOptions,
} from "@veritio/storage";

export type MySqlAuditExecutor = SqlAuditExecutor;
export type MySqlAuditStoreOptions = SqlAuditStoreOptions;

export function createMySqlServerAuditStore(options: MySqlAuditStoreOptions) {
  return createMysqlAuditStore(options);
}

export function createMariaDbServerAuditStore(options: MySqlAuditStoreOptions) {
  return createMariaDbAuditStore(options);
}

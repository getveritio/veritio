import { createAuditRecorder } from "@veritio/core";
import { createMySqlServerAuditStore, type MySqlAuditStoreOptions } from "./create-mysql-audit-store";

export function createServerAuditRecorder(options: MySqlAuditStoreOptions) {
  return createAuditRecorder({
    store: createMySqlServerAuditStore(options),
  });
}

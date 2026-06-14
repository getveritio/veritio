import { createAuditRecorder } from "@veritio/core";
import { createMySqlServerAuditStore, type MySqlAuditStoreOptions } from "./create-mysql-audit-store";

/**
 * Wraps host-injected MySQL or MariaDB storage in the generic Veritio recorder
 * API.
 */
export function createServerAuditRecorder(options: MySqlAuditStoreOptions) {
  return createAuditRecorder({
    store: createMySqlServerAuditStore(options),
  });
}

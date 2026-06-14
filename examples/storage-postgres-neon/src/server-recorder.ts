import { createAuditRecorder } from "@veritio/core";
import { createPostgresServerAuditStore, type PostgresAuditStoreOptions } from "./create-postgres-audit-store";

/**
 * Wraps host-injected Postgres storage in the generic Veritio recorder API.
 */
export function createServerAuditRecorder(options: PostgresAuditStoreOptions) {
  return createAuditRecorder({
    store: createPostgresServerAuditStore(options),
  });
}

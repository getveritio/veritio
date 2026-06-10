import { createAuditRecorder } from "@veritio/core";
import { createPostgresServerAuditStore, type PostgresAuditStoreOptions } from "./create-postgres-audit-store";

export function createServerAuditRecorder(options: PostgresAuditStoreOptions) {
  return createAuditRecorder({
    store: createPostgresServerAuditStore(options),
  });
}

import { createAuditRecorder } from "@veritio/core";
import { createMongoServerAuditStore, type MongoAuditStoreHost } from "./create-mongo-audit-store";

/**
 * Wraps host-injected Mongo storage in the generic Veritio recorder API.
 */
export function createServerAuditRecorder(host: MongoAuditStoreHost) {
  return createAuditRecorder({
    store: createMongoServerAuditStore(host),
  });
}

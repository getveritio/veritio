import { createAuditRecorder } from "@veritio/core";
import { createMongoServerAuditStore, type MongoAuditStoreHost } from "./create-mongo-audit-store";

export function createServerAuditRecorder(host: MongoAuditStoreHost) {
  return createAuditRecorder({
    store: createMongoServerAuditStore(host),
  });
}

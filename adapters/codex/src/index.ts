/**
 * Public surface of @veritio/codex. The runtime entrypoint is the
 * `veritio-codex-notify` bin (src/notify.ts); these pure helpers are exported
 * for testing and for hosts embedding the mapping directly.
 */
export { resolveConfig, type CodexAdapterConfig } from "./config.js";
export { postToIngest } from "./ingest.js";
export {
  buildSessionContext,
  promptHashOf,
  sessionIdOf,
  sha256,
  turnIdOf,
  type CodexNotifyPayload,
} from "./map.js";

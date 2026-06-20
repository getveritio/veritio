import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolved adapter configuration. The local file store is always the working sink
 * (the reference MCP reads it); when both an ingest URL and key are present the
 * hook ALSO ships the invocation's records to a Veritio ingest endpoint.
 */
export interface AdapterConfig {
  localDir: string;
  ingest?: { url: string; key: string };
  tenantId: string;
  /** The enforcing human (stable id, never an email/username). */
  actorId: string;
  /** The agent actor id. */
  agentActorId: string;
  workspaceId?: string;
  environment: string;
}

/**
 * Reads configuration from the environment. This is the ONLY place env is read
 * (the process boundary), so map/redact/state stay pure and no credential is
 * embedded in the hook logic. Fails closed if ingest is half-configured.
 */
export function resolveConfig(env: NodeJS.ProcessEnv): AdapterConfig {
  const url = env.VERITIO_INGEST_URL?.trim();
  const key = env.VERITIO_INGEST_KEY?.trim();
  if ((url && !key) || (key && !url)) {
    throw new Error("ingest requires both VERITIO_INGEST_URL and VERITIO_INGEST_KEY");
  }

  const config: AdapterConfig = {
    localDir: env.VERITIO_LOCAL_DIR?.trim() || join(homedir(), ".veritio", "claude-code"),
    tenantId: env.VERITIO_TENANT_ID?.trim() || "local",
    actorId: env.VERITIO_ACTOR_ID?.trim() || "local_developer",
    agentActorId: env.VERITIO_AGENT_ACTOR_ID?.trim() || "agent_claude_code",
    environment: env.VERITIO_ENVIRONMENT?.trim() || "development",
  };
  if (url && key) {
    config.ingest = { url, key };
  }
  const workspaceId = env.VERITIO_WORKSPACE_ID?.trim();
  if (workspaceId) {
    config.workspaceId = workspaceId;
  }
  return config;
}

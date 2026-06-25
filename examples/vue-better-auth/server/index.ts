import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth";
import {
  cloudStatus,
  listChangeFeed,
  listEntries,
  runGovernedAction,
  type GovernedActionInput,
  type GovernedActionKind,
} from "./governed-entries";
import { listAgentSessions, runAgentSession } from "./governed-session";

const app = express();

/**
 * Mounts Better Auth before JSON body parsing so auth requests keep their
 * native request shape; Veritio tenant scope is resolved in the auth boundary.
 */
app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json());

/**
 * Returns the governed-change snapshot the SPA renders: current entities, the
 * recent change feed, the recent agent sessions, and the browser-safe cloud
 * config (NEVER the ingest token). This is the read half of the governed-change
 * flow; identity, tenant, and the ingest key all stay on this server boundary.
 */
app.get("/api/governed/snapshot", (_request, response) => {
  response.json({
    entries: listEntries(),
    feed: listChangeFeed(),
    sessions: listAgentSessions(),
    cloud: cloudStatus(),
  });
});

/**
 * Runs one governed agent session: a multi-step, `sessionId`-grouped workflow
 * (session → prompt → tool read → proposal → file change → governed recalcs →
 * human approval) that populates the Cloud's Agent Sessions / Activity Graph /
 * Code Changes / Changes surfaces from one click. Tenant, the agent/actor
 * identity, and the ingest key all stay on this server boundary.
 */
app.post("/api/governed/session", async (_request, response) => {
  try {
    response.json(await runAgentSession());
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "agent session failed" });
  }
});

/**
 * Runs one governed action (create / update / agent recalc / rollback). The body
 * is validated and fails closed before it can affect an entry id, actor id, or
 * the rollback target; the governed engine then builds the change draft, stages
 * the outbox, and dispatches server-to-server to hosted ingest.
 */
app.post("/api/governed/action", async (request, response) => {
  let input: GovernedActionInput;
  try {
    input = readGovernedActionInput(request.body);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "invalid action input" });
    return;
  }
  try {
    response.json(await runGovernedAction(input));
  } catch (error) {
    response.status(409).json({ error: error instanceof Error ? error.message : "governed action failed" });
  }
});

/**
 * Validates and narrows the governed-action request body before it reaches the
 * server-owned engine. Identifiers feed change ids and idempotency-key material,
 * so they fail closed; tenant and the ingest key are never accepted from the
 * browser (the engine owns them).
 */
function readGovernedActionInput(body: unknown): GovernedActionInput {
  if (typeof body !== "object" || body === null) {
    throw new TypeError("request body must be a JSON object");
  }
  const raw = body as Record<string, unknown>;
  const kinds: GovernedActionKind[] = ["create", "update", "agent_recalc", "rollback"];
  if (typeof raw.kind !== "string" || !kinds.includes(raw.kind as GovernedActionKind)) {
    throw new TypeError("kind must be one of create, update, agent_recalc, rollback");
  }
  if (typeof raw.entryId !== "string") {
    throw new TypeError("entryId is required");
  }
  const input: GovernedActionInput = { kind: raw.kind as GovernedActionKind, entryId: readIdentifier(raw.entryId) };
  if (typeof raw.name === "string") input.name = raw.name;
  if (typeof raw.customerEmail === "string") input.customerEmail = raw.customerEmail;
  if (raw.quantity !== undefined) input.quantity = readNumber(raw.quantity, "quantity");
  if (raw.monthlyPrice !== undefined) input.monthlyPrice = readNumber(raw.monthlyPrice, "monthlyPrice");
  if (raw.status === "active" || raw.status === "archived") input.status = raw.status;
  if (typeof raw.rollbackToRevisionId === "string")
    input.rollbackToRevisionId = readIdentifier(raw.rollbackToRevisionId);
  if (typeof raw.actorId === "string") input.actorId = readIdentifier(raw.actorId);
  return input;
}

/** Accepts a finite numeric field and fails closed on anything else. */
function readNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number`);
  }
  return value;
}

/**
 * Accepts compact demo identifiers and fails closed before values enter hashed
 * resource ids or idempotency keys.
 */
function readIdentifier(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(trimmed)) {
    throw new TypeError("identifier must be 1-80 URL-safe characters");
  }
  return trimmed;
}

app.listen(3001);

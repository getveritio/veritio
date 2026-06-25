import { json, type RequestHandler } from "@sveltejs/kit";
import {
  cloudStatus,
  listChangeFeed,
  listEntries,
  runGovernedAction,
  type GovernedActionInput,
  type GovernedActionKind,
} from "$lib/server/governed-entries";
import { listAgentSessions } from "$lib/server/governed-session";

/**
 * Returns the governed-change snapshot the page renders: current entities, the
 * recent change feed, the recent agent sessions, and the browser-safe cloud
 * config (NEVER the ingest token). This is the read half of the governed-change
 * flow; identity, tenant, and the ingest key all stay on this `$lib/server`
 * boundary.
 */
export const GET: RequestHandler = () =>
  json({ entries: listEntries(), feed: listChangeFeed(), sessions: listAgentSessions(), cloud: cloudStatus() });

/**
 * Runs one governed action (create / update / agent recalc / rollback). The body
 * is validated and fails closed before it can affect an entry id, actor id, or
 * the rollback target; the governed engine then builds the change draft, stages
 * the outbox, and dispatches server-to-server to hosted ingest. Tenant and the
 * ingest key are never accepted from the browser.
 */
export const POST: RequestHandler = async ({ request }) => {
  let input: GovernedActionInput;
  try {
    input = readGovernedActionInput(await readJsonBody(request));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "invalid action input" }, { status: 400 });
  }
  try {
    return json(await runGovernedAction(input));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "governed action failed" }, { status: 409 });
  }
};

/** Parses JSON while treating an empty/invalid body as an empty object. */
async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

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

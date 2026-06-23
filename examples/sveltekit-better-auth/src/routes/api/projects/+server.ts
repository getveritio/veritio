import { json, type RequestHandler } from "@sveltejs/kit";
import {
  recordProjectMutation,
  resolveReferenceSession,
  type ProjectMutationKind,
} from "$lib/server/veritio";

/**
 * Creates a demo project and records both the audit event and graph edge from
 * the SvelteKit server boundary.
 */
export const POST: RequestHandler = async (event) => recordProjectRouteMutation(event, "create", 201);

/**
 * Updates a demo project and appends a modified edge to the activity graph.
 */
export const PUT: RequestHandler = async (event) => recordProjectRouteMutation(event, "update", 200);

/**
 * Deletes a demo project and records the delete event and graph edge.
 */
export const DELETE: RequestHandler = async (event) => recordProjectRouteMutation(event, "delete", 200);

/**
 * Parses project mutation input, validates identifiers, and delegates all
 * evidence writes to the host-owned Veritio helper.
 */
async function recordProjectRouteMutation(
  event: Parameters<RequestHandler>[0],
  kind: ProjectMutationKind,
  status: number,
) {
  const session = await resolveReferenceSession(event);
  const body = (await readJsonBody(event.request)) as Record<string, unknown>;
  const projectId = readIdentifier(body.projectId ?? "project_demo");
  const requestId = readIdentifier(body.requestId ?? `ref_${Date.now()}`);
  const result = await recordProjectMutation({
    kind,
    session,
    projectId,
    name: typeof body.name === "string" ? body.name : undefined,
    status: body.status === "archived" ? "archived" : "active",
    requestId,
    source: "sveltekit_server_route",
  });
  return json(result, { status });
}

/**
 * Parses JSON while allowing empty request bodies so handlers can provide safe
 * reference defaults.
 */
async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/**
 * Accepts compact demo identifiers before they become resource ids or
 * idempotency-key material.
 */
function readIdentifier(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("identifier must be a string");
  }
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(trimmed)) {
    throw new TypeError("identifier must be 1-80 URL-safe characters");
  }
  return trimmed;
}

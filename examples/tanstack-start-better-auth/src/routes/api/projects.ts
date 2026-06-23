import { createFileRoute } from "@tanstack/react-router";
import {
  recordProjectMutation,
  resolveReferenceSession,
  type ProjectMutationKind,
} from "../../server/veritio";

/**
 * Provides CRUD-style project endpoints for the governed reference flow. Each
 * handler resolves tenant and actor identity on the server before recording
 * Veritio evidence.
 */
export const Route = createFileRoute("/api/projects")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => recordProjectRouteMutation(request, "create", 201),
      PUT: async ({ request }: { request: Request }) => recordProjectRouteMutation(request, "update", 200),
      DELETE: async ({ request }: { request: Request }) => recordProjectRouteMutation(request, "delete", 200),
    },
  },
});

/**
 * Parses the project mutation body, validates identifiers, and delegates actual
 * state/evidence writes to the server-owned Veritio helper.
 */
async function recordProjectRouteMutation(request: Request, kind: ProjectMutationKind, status: number) {
  const session = await resolveReferenceSession(request);
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  const projectId = readIdentifier(body.projectId ?? "project_demo");
  const requestId = readIdentifier(body.requestId ?? `ref_${Date.now()}`);
  const result = await recordProjectMutation({
    kind,
    session,
    projectId,
    name: typeof body.name === "string" ? body.name : undefined,
    status: body.status === "archived" ? "archived" : "active",
    requestId,
    source: "tanstack_start_route_handler",
  });
  return Response.json(result, { status });
}

/**
 * Parses JSON while allowing empty request bodies so handlers can provide safe
 * demo defaults.
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
 * idempotency key material.
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

import { NextResponse } from "next/server";
import {
  recordProjectMutation,
  resolveReferenceSession,
  type ProjectMutationKind,
} from "../../../src/veritio/server";

export const dynamic = "force-dynamic";

/**
 * Creates a demo project and records both a Veritio audit event and graph edge
 * from the Next route handler boundary.
 */
export async function POST(request: Request) {
  return recordProjectRouteMutation(request, "create", 201);
}

/**
 * Updates a demo project and appends a modified edge to the activity graph.
 */
export async function PUT(request: Request) {
  return recordProjectRouteMutation(request, "update", 200);
}

/**
 * Deletes a demo project and records the delete event and graph edge.
 */
export async function DELETE(request: Request) {
  return recordProjectRouteMutation(request, "delete", 200);
}

/**
 * Parses project mutation input, validates identifiers, and delegates all
 * evidence writes to the host-owned Veritio helper.
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
    source: "nextjs_route_handler",
  });
  return NextResponse.json(result, { status });
}

/**
 * Parses JSON while allowing empty request bodies so API calls can use safe
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

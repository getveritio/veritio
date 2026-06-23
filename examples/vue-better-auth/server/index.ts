import express from "express";
import type { Request } from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth";
import {
  auditRecorder,
  getReferenceEvidenceTrail,
  listAuditTrailForTenant,
  recordProjectMutation,
  resolveReferenceSession,
  runGovernedLifecycleScenario,
  type ProjectMutationKind,
} from "./veritio";

const app = express();

/**
 * Mounts Better Auth before JSON body parsing so auth requests keep their
 * native request shape; Veritio tenant scope is resolved in the auth boundary.
 */
app.all("/api/auth/*splat", toNodeHandler(auth));
app.use(express.json());

/**
 * Returns the reference tenant audit records for examples that only need the
 * event chain.
 */
app.get("/api/audit", async (request, response) => {
  const session = await resolveReferenceSession(request);

  response.json({
    records: await listAuditTrailForTenant({ tenantId: session.tenantId, limit: 100 }),
  });
});

/**
 * Returns audit records, graph edges, verification results, and project state
 * for the server-resolved reference tenant.
 */
app.get("/api/evidence", async (request, response) => {
  const session = await resolveReferenceSession(request);
  response.json(await getReferenceEvidenceTrail({ tenantId: session.tenantId, limit: 100 }));
});

/**
 * Creates a demo project through the server-owned Veritio evidence boundary.
 */
app.post("/api/projects", async (request, response) => {
  response.status(201).json(await recordProjectRouteMutation(request, "create"));
});

/**
 * Updates a demo project and records the activity graph edge for the mutation.
 */
app.put("/api/projects", async (request, response) => {
  response.json(await recordProjectRouteMutation(request, "update"));
});

/**
 * Deletes a demo project in memory and records the delete event and graph edge.
 */
app.delete("/api/projects", async (request, response) => {
  response.json(await recordProjectRouteMutation(request, "delete"));
});

/**
 * Runs the larger helper-driven lifecycle scenario so readers can inspect auth,
 * organization, consent, subject-request, export, retention, and processor graph
 * evidence from one endpoint.
 */
app.post("/api/scenarios/governed-lifecycle", async (request, response) => {
  const session = await resolveReferenceSession(request);
  response.json(await runGovernedLifecycleScenario(session));
});

/**
 * Records the original profile-update event used by the first Better Auth
 * example iteration.
 */
app.post("/api/profile-updates", async (request, response) => {
  const session = await resolveReferenceSession(request);
  const { profileId, requestId } = request.body as Record<string, string>;
  const record = await auditRecorder.record(
    {
      actor: { type: "user", id: session.actorUserId },
      action: "profile.updated",
      target: { type: "profile", id: profileId },
      scope: { tenantId: session.tenantId, environment: "reference" },
      requestId,
      purpose: "account_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: {},
    },
    { idempotencyKey: `profile-updated:${session.tenantId}:${profileId}:${requestId ?? "manual"}` },
  );

  response.status(201).json({ record });
});

/**
 * Parses and validates the project API body before values enter resource ids or
 * idempotency keys.
 */
async function recordProjectRouteMutation(request: Request, kind: ProjectMutationKind) {
  const session = await resolveReferenceSession(request);
  const body = request.body as Record<string, string | undefined>;
  const projectId = readIdentifier(body.projectId ?? "project_demo");
  const requestId = readIdentifier(body.requestId ?? `ref_${Date.now()}`);
  return recordProjectMutation({
    kind,
    session,
    projectId,
    name: body.name,
    status: body.status === "archived" ? "archived" : "active",
    requestId,
    source: "vue_express_api",
  });
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

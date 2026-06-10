import express from "express";
import { auditRecorder, listAuditTrailForTenant, resolveReferenceSession } from "./veritio";

const app = express();
app.use(express.json());

app.get("/api/audit", async (request, response) => {
  const session = await resolveReferenceSession(request);

  response.json({
    records: await listAuditTrailForTenant({ tenantId: session.tenantId, limit: 100 }),
  });
});

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

app.listen(3001);

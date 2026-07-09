# TypeScript API Route Template

Use this pattern for a JSON API route in Next.js, TanStack Start, Express, Hono,
or any server-side TypeScript runtime.

```ts
import { createGovernedActionDraft, defineEntity } from "@veritio/core";

const ProjectEntry = defineEntity({
  authority: "app.example",
  type: "project_entry",
  schemaRef: "app.example/project-entry@1",
  fieldSetRef: "project-entry-governed-fields@1",
  identity: (row: { id: string }) => row.id,
  fields: { status: { capture: "full" }, updatedBy: { capture: "keyed_digest" } },
});

export async function PUT(request: Request, context: { params: { id: string } }) {
  const actor = await requireUser(request);
  const body = await request.json();
  const before = await db.projectEntry.findUniqueOrThrow({ id: context.params.id, tenantId: actor.orgId });
  const after = { ...before, status: body.status, updatedBy: actor.id, version: before.version + 1 };

  const draft = createGovernedActionDraft({
    scope: { tenantId: actor.orgId, environment: "production" },
    entity: ProjectEntry,
    before,
    after,
    actionType: "project_entry.updated",
    activityType: "project_entry.updated",
    initiatedBy: { authority: "app.example.auth", kind: "principal", type: "user", id: actor.id },
    performedBy: { authority: "app.example.auth", kind: "principal", type: "user", id: actor.id },
    producer: { authority: "app.example", kind: "principal", type: "service", id: "api" },
    idempotencyKey: request.headers.get("idempotency-key") ?? `project_entry:${after.id}:v${after.version}`,
    expectedParentRevisionRef: before.revisionRef,
    mutationBinding: "same_transaction",
    digestKeys: { keyedDigest: { keyVersion: "actor-v1", secret: actor.tenantDigestSecret } },
  });

  await db.transaction(async (tx) => {
    await tx.projectEntry.update(after);
    await tx.veritioOutbox.insert(draft.outboxEntry);
  });

  return Response.json({ changeId: draft.changeRef.id, revisionRef: draft.revision.ref });
}
```

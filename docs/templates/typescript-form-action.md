# TypeScript Form Action Template

Use this pattern for Next.js server actions, TanStack Start server functions,
or an Express route that receives form input. The browser form submits intent;
the server resolves tenant scope, actor identity, before/after rows, and storage.

```ts
import { createGovernedActionDraft, defineEntity } from "@veritio/core";

const ProjectEntry = defineEntity({
  authority: "app.example",
  type: "project_entry",
  schemaRef: "app.example/project-entry@1",
  fieldSetRef: "project-entry-governed-fields@1",
  identity: (row: { id: string }) => row.id,
  fields: {
    title: { capture: "full" },
    status: { capture: "full" },
    customerEmail: { capture: "keyed_digest" },
    privateNotes: { capture: "omit" },
  },
});

export async function updateProjectEntryAction(formData: FormData) {
  const actor = await requireUser();
  const before = await db.projectEntry.findUniqueOrThrow({ id: String(formData.get("id")) });
  const after = { ...before, status: String(formData.get("status")), version: before.version + 1 };

  const draft = createGovernedActionDraft({
    scope: { tenantId: actor.orgId, environment: "production" },
    entity: ProjectEntry,
    before,
    after,
    actionType: "project_entry.updated",
    activityType: "project_entry.updated",
    initiatedBy: { authority: "app.example.auth", kind: "principal", type: "user", id: actor.id },
    performedBy: { authority: "app.example.auth", kind: "principal", type: "user", id: actor.id },
    producer: { authority: "app.example", kind: "principal", type: "service", id: "web" },
    idempotencyKey: `project_entry:${after.id}:v${after.version}`,
    mutationBinding: "transactional_outbox",
    digestKeys: { keyedDigest: { keyVersion: "email-v1", secret: actor.tenantDigestSecret } },
  });

  await db.transaction(async (tx) => {
    await tx.projectEntry.update(after);
    await tx.veritioOutbox.insert(draft.outboxEntry);
  });

  return { changeId: draft.changeRef.id, revisionRef: draft.revision.ref };
}
```

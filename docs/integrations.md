# Governed Integration Guide

Veritio records evidence at the server-side business mutation boundary: after a
request is authorized and before the mutation/result is considered complete. Do
not record governed changes from browser form state. Browser frameworks can
collect intent, validation errors, and optimistic UI state, but the authoritative
tenant, actor, before row, after row, idempotency key, and storage transaction
belong on the server.

## Which Helper Should I Use?

Use this decision tree:

| Situation | Use |
| --- | --- |
| You only need a single audit fact such as `auth.login.succeeded` or `billing.invoice.sent`. | `createAuditEvent` / `create_audit_event` / `CreateAuditEvent` |
| A server action/API route creates, updates, deletes, or recalculates a governed entity row. | `createGovernedActionDraft` / `create_governed_action_draft` / `CreateGovernedActionDraft` |
| The app database mutation and evidence delivery must recover together. | The governed action helper plus a transactional outbox owned by the host app. |
| You want hosted Veritio Cloud to receive the same records. | Dispatch the outbox from the server with an injected hosted ingest target. Keep local evidence useful without a hosted account. |

The governed action helper is a DX layer over the existing governed-change
primitive. It does not add protocol semantics. It derives stable change/activity
ids, tenant-scoped idempotency hashes, and changed paths, then delegates to the
lower-level governed-change builder that emits `change.declared`,
`activity.recorded`, `entity.revision.created`, and evidence graph edges.

## TypeScript Server Action

```ts
import { createGovernedActionDraft, defineEntity } from "@veritio/core";

const ProjectEntry = defineEntity({
  authority: "app.example",
  type: "project_entry",
  schemaRef: "app.example/project-entry@1",
  fieldSetRef: "project-entry-governed-fields@1",
  identity: (row: ProjectEntryRow) => row.id,
  fields: {
    title: { capture: "full" },
    status: { capture: "full" },
    customerEmail: { capture: "keyed_digest" },
    internalNotes: { capture: "omit" },
  },
});

export async function updateProjectEntry(formData: FormData) {
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
    expectedParentRevisionRef: before.revisionRef,
    mutationBinding: "same_transaction",
    digestKeys: { keyedDigest: { keyVersion: "tenant-email-v1", secret: actor.tenantDigestSecret } },
    metadata: { requestId: actor.requestId },
  });

  await db.transaction(async (tx) => {
    await tx.projectEntry.update(after);
    await tx.veritioOutbox.insert(draft.outboxEntry);
  });

  return { changeId: draft.changeRef.id, revisionRef: draft.revision.ref };
}
```

TanStack Form, React Hook Form, Vue forms, and Svelte form actions should submit
normal application input to this server boundary. The form library does not own
Veritio storage, tenant scope, idempotency, or protocol semantics.

## Python FastAPI Route

```python
from fastapi import APIRouter, Depends
from veritio import create_governed_action_draft, define_entity

router = APIRouter()

project_entity = define_entity(
    authority="app.example",
    entity_type="project_entry",
    schema_ref="app.example/project-entry@1",
    field_set_ref="project-entry-governed-fields@1",
    identity=lambda row: row["id"],
    fields={"title": {"capture": "full"}, "status": {"capture": "full"}},
)


@router.put("/project-entries/{entry_id}")
async def update_project_entry(entry_id: str, body: dict, actor=Depends(require_user)):
    before = await db.project_entries.get_for_update(entry_id, tenant_id=actor.org_id)
    after = {**before, "status": body["status"], "version": before["version"] + 1}

    draft = create_governed_action_draft(
        {
            "scope": {"tenantId": actor.org_id, "environment": "production"},
            "entity": project_entity,
            "before": before,
            "after": after,
            "actionType": "project_entry.updated",
            "activityType": "project_entry.updated",
            "initiatedBy": {"authority": "app.example.auth", "kind": "principal", "type": "user", "id": actor.id},
            "performedBy": {"authority": "app.example.auth", "kind": "principal", "type": "user", "id": actor.id},
            "producer": {"authority": "app.example", "kind": "principal", "type": "service", "id": "api"},
            "idempotencyKey": f"project_entry:{entry_id}:v{after['version']}",
            "expectedParentRevisionRef": before.get("revisionRef"),
            "mutationBinding": "same_transaction",
        }
    )

    async with db.transaction() as tx:
        await tx.project_entries.update(after)
        await tx.veritio_outbox.insert(draft["outboxEntry"])

    return {"changeId": draft["changeRef"]["id"], "revisionRef": draft["revision"]["ref"]}
```

## Go Gin Route

```go
func updateProjectEntry(c *gin.Context) {
    actor := requireUser(c)
    before := loadEntryForUpdate(actor.OrgID, c.Param("id"))
    after := before
    after.Status = c.PostForm("status")
    after.Version++

    projectEntity, err := veritio.DefineEntity(veritio.GovernedEntityDefinition{
        Authority: "app.example",
        Type: "project_entry",
        SchemaRef: "app.example/project-entry@1",
        FieldSetRef: "project-entry-governed-fields@1",
        Identity: func(row map[string]any) string { return row["id"].(string) },
        Fields: map[string]veritio.EntityFieldPolicy{
            "title": {Capture: "full"},
            "status": {Capture: "full"},
        },
    })
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "evidence policy unavailable"})
        return
    }

    draft, err := veritio.CreateGovernedActionDraft(veritio.GovernedActionDraftInput{
        Scope: veritio.EvidenceScope{TenantID: actor.OrgID, Environment: "production"},
        Entity: projectEntity,
        Before: projectEntryRow(before),
        After: projectEntryRow(after),
        ActionType: "project_entry.updated",
        ActivityType: "project_entry.updated",
        InitiatedBy: veritio.EvidenceRef{Authority: "app.example.auth", Kind: "principal", Type: "user", ID: actor.ID},
        PerformedBy: veritio.EvidenceRef{Authority: "app.example.auth", Kind: "principal", Type: "user", ID: actor.ID},
        Producer: veritio.EvidenceRef{Authority: "app.example", Kind: "principal", Type: "service", ID: "api"},
        IdempotencyKey: fmt.Sprintf("project_entry:%s:v%d", after.ID, after.Version),
        MutationBinding: "same_transaction",
    })
    if err != nil {
        c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
        return
    }

    withTransaction(func(tx Tx) error {
        tx.UpdateProjectEntry(after)
        tx.InsertVeritioOutbox(draft.OutboxEntry)
        return nil
    })
    c.JSON(http.StatusOK, gin.H{"changeId": draft.ChangeRef.ID, "revisionRef": draft.Revision.Ref})
}
```

## Framework Notes

- **Next.js / TanStack Start / SvelteKit:** call the helper in server actions,
  server functions, route handlers, or hooks after resolving auth and tenant
  scope. Client components submit intent only.
- **React / Vue / Svelte SPAs:** post to an application API route. The browser
  package can help describe intent, but the server records evidence.
- **FastAPI / Gin:** call the helper inside the route or service method that
  already owns authorization, the database transaction, and the before/after
  rows.
- **Better Auth:** lifecycle adapters can produce normal audit events. Governed
  CRUD actions still belong in the host application's mutation path.

## Failure Rules

The helper fails closed when required scope, actors, producer, idempotency key,
or governed fields are missing. Update no-ops are rejected unless callers pass
explicit `changedPaths`, because unchanged governed fields should not create a
new entity revision.

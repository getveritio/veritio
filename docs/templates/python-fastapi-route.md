# Python FastAPI Route Template

FastAPI validates transport input. Veritio should record evidence after the app
has resolved authorization, tenant scope, actor identity, and before/after rows.

```python
from fastapi import APIRouter, Depends, HTTPException
from veritio import create_governed_action_draft, define_entity

router = APIRouter()

project_entity = define_entity(
    authority="app.example",
    entity_type="project_entry",
    schema_ref="app.example/project-entry@1",
    field_set_ref="project-entry-governed-fields@1",
    identity=lambda row: row["id"],
    fields={"status": {"capture": "full"}, "updatedBy": {"capture": "keyed_digest"}},
)


@router.put("/project-entries/{entry_id}")
async def update_project_entry(entry_id: str, body: dict, actor=Depends(require_user)):
    before = await db.project_entries.get_for_update(entry_id, tenant_id=actor.org_id)
    if before is None:
        raise HTTPException(status_code=404)
    after = {**before, "status": body["status"], "updatedBy": actor.id, "version": before["version"] + 1}

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
            "digestKeys": {"keyedDigest": {"keyVersion": "actor-v1", "secret": actor.tenant_digest_secret}},
        }
    )

    async with db.transaction() as tx:
        await tx.project_entries.update(after)
        await tx.veritio_outbox.insert(draft["outboxEntry"])

    return {"changeId": draft["changeRef"]["id"], "revisionRef": draft["revision"]["ref"]}
```

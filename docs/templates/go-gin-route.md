# Go Gin Route Template

Gin owns HTTP routing. The host application still owns tenant scope, actor
resolution, before/after rows, idempotency, and storage.

```go
func updateProjectEntry(c *gin.Context) {
    actor := requireUser(c)
    before, err := db.LoadProjectEntryForUpdate(actor.OrgID, c.Param("id"))
    if err != nil {
        c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
        return
    }
    after := before
    after.Status = c.PostForm("status")
    after.Version++

    draft, err := veritio.CreateGovernedActionDraft(veritio.GovernedActionDraftInput{
        Scope: veritio.EvidenceScope{TenantID: actor.OrgID, Environment: "production"},
        Entity: veritio.DefineEntity(veritio.GovernedEntityDefinition{
            Authority: "app.example",
            Type: "project_entry",
            SchemaRef: "app.example/project-entry@1",
            FieldSetRef: "project-entry-governed-fields@1",
            Identity: func(row map[string]any) string { return row["id"].(string) },
            Fields: map[string]veritio.FieldCapturePolicy{
                "status": {Capture: "full"},
                "updatedBy": {Capture: "keyed_digest"},
            },
        }),
        Before: projectEntryRow(before),
        After: projectEntryRow(after),
        ActionType: "project_entry.updated",
        ActivityType: "project_entry.updated",
        InitiatedBy: veritio.EvidenceRef{Authority: "app.example.auth", Kind: "principal", Type: "user", ID: actor.ID},
        PerformedBy: veritio.EvidenceRef{Authority: "app.example.auth", Kind: "principal", Type: "user", ID: actor.ID},
        Producer: veritio.EvidenceRef{Authority: "app.example", Kind: "principal", Type: "service", ID: "api"},
        IdempotencyKey: fmt.Sprintf("project_entry:%s:v%d", after.ID, after.Version),
        MutationBinding: "transactional_outbox",
        DigestKeys: veritio.DigestKeys{KeyedDigest: &veritio.KeyedDigestInput{KeyVersion: "actor-v1", Secret: actor.TenantDigestSecret}},
    })
    if err != nil {
        c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
        return
    }

    err = db.Transaction(func(tx Tx) error {
        if err := tx.UpdateProjectEntry(after); err != nil {
            return err
        }
        return tx.InsertVeritioOutbox(draft.OutboxEntry)
    })
    if err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "mutation failed"})
        return
    }

    c.JSON(http.StatusOK, gin.H{"changeId": draft.ChangeRef.ID, "revisionRef": draft.Revision.Ref})
}
```

package veritio

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestRefKeyFormatsAuthorityQualifiedRefs(t *testing.T) {
	actual, err := RefKey(EvidenceRef{Authority: "acme.billing", Kind: "entity", Type: "project_entry", ID: "42"})
	if err != nil {
		t.Fatalf("RefKey returned error: %v", err)
	}
	expected := "acme.billing:entity:project_entry:42"
	if actual != expected {
		t.Fatalf("expected %s, got %s", expected, actual)
	}
}

func TestMergeVeritioMetadataRejectsReservedShadowing(t *testing.T) {
	_, err := MergeVeritioMetadata(map[string]any{"changeId": "caller_supplied"}, map[string]any{"changeId": "chg_01"})
	if err == nil {
		t.Fatal("expected reserved key error")
	}
	if err.Error() != "metadata.changeId is reserved by Veritio" {
		t.Fatalf("unexpected error: %v", err)
	}

	actual, err := MergeVeritioMetadata(
		map[string]any{"safe": true},
		map[string]any{
			"authSessionId":     "ses_123",
			"authContextId":     "authctx_123_v4",
			"activityEpisodeId": "episode_20260623_1000_usr_admin",
			"traceId":           "trc_01jz_estimate",
			"correlationId":     "workflow_project_estimate",
			"causationEventId":  "evt_previous_trigger",
			"changeId":          "chg_project_estimate_91",
			"capturePolicyId":   "cap_project_changes",
			"collectionSource":  "governed-change-test",
		},
	)
	if err != nil {
		t.Fatalf("MergeVeritioMetadata returned error: %v", err)
	}
	if actual["changeId"] != "chg_project_estimate_91" || actual["safe"] != true || actual["traceId"] != "trc_01jz_estimate" {
		t.Fatalf("unexpected merged metadata: %#v", actual)
	}
}

func TestCreateGovernedChangeDraftDerivesMinimizedRevisionEvidence(t *testing.T) {
	projectEntry, err := DefineEntity(GovernedEntityDefinition{
		Authority:   "acme.billing",
		Type:        "project_entry",
		SchemaRef:   "acme.billing/project_entry@3",
		FieldSetRef: "project-entry-governed-fields@2",
		Identity: func(row map[string]any) string {
			return row["id"].(string)
		},
		Fields: map[string]EntityFieldPolicy{
			"quantity":       {Capture: "full"},
			"monthlyPrice":   {Capture: "full"},
			"updatedAt":      {Capture: "full"},
			"customerEmail":  {Capture: "keyed_digest"},
			"temporaryCache": {Capture: "omit"},
		},
	})
	if err != nil {
		t.Fatalf("DefineEntity returned error: %v", err)
	}

	draft, err := CreateGovernedChangeDraft(GovernedChangeDraftInput{
		Scope:  EvidenceScope{TenantID: "org_acme_123", WorkspaceID: "wks_security_456", Environment: "test"},
		Entity: projectEntry,
		Before: map[string]any{
			"id":             "42",
			"quantity":       10,
			"monthlyPrice":   142800,
			"updatedAt":      time.Date(2026, 6, 23, 10, 17, 0, 0, time.UTC),
			"customerEmail":  "buyer@example.com",
			"temporaryCache": "hot",
		},
		After: map[string]any{
			"id":             "42",
			"quantity":       11,
			"monthlyPrice":   148220,
			"updatedAt":      time.Date(2026, 6, 23, 10, 18, 0, 0, time.UTC),
			"customerEmail":  "buyer@example.com",
			"temporaryCache": "warm",
		},
		ChangedPaths: []string{"/quantity", "/monthlyPrice"},
		Change: GovernedChangeDeclaration{
			ID:          "chg_project_estimate_91",
			Type:        "project.estimate.recalculation",
			InitiatedBy: EvidenceRef{Authority: "auth.acme.internal", Kind: "principal", Type: "user", ID: "usr_123"},
		},
		Activity: GovernedActivityDeclaration{
			ID:          "act_calculation_91",
			Type:        "computation.project_cost_estimate",
			PerformedBy: EvidenceRef{Authority: "acme.ai", Kind: "principal", Type: "ai_agent", ID: "cost_agent_7"},
		},
		Producer:           EvidenceRef{Authority: "acme.billing", Kind: "principal", Type: "service", ID: "billing-api"},
		OccurredAt:         "2026-06-23T10:18:00.000Z",
		IdempotencyKeyHash: "sha256:governed-change-test",
		Context:            map[string]any{"changeId": "chg_project_estimate_91", "traceId": "trc_01jz_estimate", "collectionSource": "test"},
		CapturePolicyRef:   &CapturePolicyRef{ID: "cap_project_changes", Version: "3"},
		DigestKeys:         DigestKeys{KeyedDigest: &KeyedDigestKey{KeyVersion: "tenant-key-7", Secret: "test-hmac-secret"}},
	})
	if err != nil {
		t.Fatalf("CreateGovernedChangeDraft returned error: %v", err)
	}

	if draft.OutboxEntry.MutationBinding != "not_transaction_bound" {
		t.Fatalf("unexpected mutation binding: %s", draft.OutboxEntry.MutationBinding)
	}
	// An update with no caller-supplied parent leaves lineage open — no synthetic parent.
	if draft.OutboxEntry.ExpectedParentRevisionRef != nil {
		t.Fatalf("expected no synthetic parent, got: %#v", draft.OutboxEntry.ExpectedParentRevisionRef)
	}
	if len(draft.Revision.Parents) != 0 {
		t.Fatalf("expected no parents, got: %#v", draft.Revision.Parents)
	}
	captureAssurance := draft.Events[0].Metadata["captureAssurance"].(map[string]any)
	if captureAssurance["captureMethod"] != "transactional_outbox" || captureAssurance["mutationBinding"] != "not_transaction_bound" {
		t.Fatalf("unexpected capture assurance: %#v", captureAssurance)
	}
	actions := []string{draft.OutboxEntry.Records[0].Action, draft.OutboxEntry.Records[1].Action, draft.OutboxEntry.Records[2].Action}
	expectedActions := []string{"change.declared", "activity.recorded", "entity.revision.created"}
	for index := range expectedActions {
		if actions[index] != expectedActions[index] {
			t.Fatalf("expected actions %#v, got %#v", expectedActions, actions)
		}
	}
	fields := draft.Revision.StateCommitment.Fields
	if fields["quantity"] != 11 || fields["monthlyPrice"] != 148220 {
		t.Fatalf("unexpected fields: %#v", fields)
	}
	if fields["updatedAt"] != "2026-06-23T10:18:00.000Z" {
		t.Fatalf("expected normalized updatedAt, got %#v", fields["updatedAt"])
	}
	customerEmail := fields["customerEmail"].(map[string]any)
	if customerEmail["algorithm"] != "hmac-sha256" || customerEmail["keyVersion"] != "tenant-key-7" {
		t.Fatalf("unexpected keyed digest metadata: %#v", customerEmail)
	}
	encoded, err := json.Marshal(fields)
	if err != nil {
		t.Fatalf("json marshal failed: %v", err)
	}
	if strings.Contains(string(encoded), "buyer@example.com") || strings.Contains(string(encoded), "test-hmac-secret") || strings.Contains(string(encoded), "temporaryCache") {
		t.Fatalf("fields leaked raw data: %s", string(encoded))
	}
	revisionEvent, err := CreateAuditEvent(draft.Events[2])
	if err != nil {
		t.Fatalf("CreateAuditEvent returned error: %v", err)
	}
	veritioMetadata := revisionEvent.Metadata["veritio"].(map[string]any)
	revisionMetadata := veritioMetadata["revision"].(map[string]any)
	stateCommitment := revisionMetadata["stateCommitment"].(map[string]any)
	storedFields := stateCommitment["fields"].(map[string]any)
	storedCustomerEmail := storedFields["customerEmail"].(map[string]any)
	if storedCustomerEmail["digest"] != customerEmail["digest"] {
		t.Fatalf("digest envelope was not preserved after redaction: %#v", storedCustomerEmail)
	}
	outboxJSON, err := json.Marshal(draft.OutboxEntry)
	if err != nil {
		t.Fatalf("outbox marshal failed: %v", err)
	}
	outboxText := string(outboxJSON)
	if !strings.Contains(outboxText, `"occurredAt"`) || strings.Contains(outboxText, `"OccurredAt"`) || strings.Contains(outboxText, `"requestId":""`) {
		t.Fatalf("outbox JSON shape is not lower-camel with omitted optionals: %s", outboxText)
	}
	relations := []string{}
	for _, edge := range draft.Edges {
		relations = append(relations, edge.Relation)
	}
	expectedRelations := []string{"has_activity", "has_output", "performed_by", "generated"}
	if len(relations) != len(expectedRelations) {
		t.Fatalf("expected %d relations, got %#v", len(expectedRelations), relations)
	}
	for index := range expectedRelations {
		if relations[index] != expectedRelations[index] {
			t.Fatalf("expected relations %#v, got %#v", expectedRelations, relations)
		}
	}
}

func minimalEntityDefinition(t *testing.T) GovernedEntityDefinition {
	t.Helper()
	entity, err := DefineEntity(GovernedEntityDefinition{
		Authority:   "acme.billing",
		Type:        "project_entry",
		SchemaRef:   "acme.billing/project_entry@3",
		FieldSetRef: "project-entry-governed-fields@2",
		Identity:    func(row map[string]any) string { return row["id"].(string) },
		Fields:      map[string]EntityFieldPolicy{"quantity": {Capture: "full"}},
	})
	if err != nil {
		t.Fatalf("DefineEntity returned error: %v", err)
	}
	return entity
}

func TestCreateGovernedChangeDraftLinksParentOnlyWhenSupplied(t *testing.T) {
	expectedParent := EvidenceRef{Authority: "veritio", Kind: "revision", Type: "project_entry", ID: "rev_project_entry_42_0a1b2c3d4e5f"}
	draft, err := CreateGovernedChangeDraft(GovernedChangeDraftInput{
		Scope:                     EvidenceScope{TenantID: "org_acme_123"},
		Entity:                    minimalEntityDefinition(t),
		Before:                    map[string]any{"id": "42", "quantity": 10},
		After:                     map[string]any{"id": "42", "quantity": 11},
		ChangedPaths:              []string{"/quantity"},
		Change:                    GovernedChangeDeclaration{ID: "chg_supplied", Type: "project.estimate.recalculation", InitiatedBy: EvidenceRef{Authority: "auth.acme.internal", Kind: "principal", Type: "user", ID: "usr_123"}},
		Activity:                  GovernedActivityDeclaration{ID: "act_supplied", Type: "computation.project_cost_estimate", PerformedBy: EvidenceRef{Authority: "acme.billing", Kind: "principal", Type: "service", ID: "billing-api"}},
		Producer:                  EvidenceRef{Authority: "acme.billing", Kind: "principal", Type: "service", ID: "billing-api"},
		OccurredAt:                "2026-06-23T10:18:00.000Z",
		IdempotencyKeyHash:        "sha256:supplied-parent",
		ExpectedParentRevisionRef: &expectedParent,
	})
	if err != nil {
		t.Fatalf("CreateGovernedChangeDraft returned error: %v", err)
	}
	if len(draft.Revision.Parents) != 1 || draft.Revision.Parents[0] != expectedParent {
		t.Fatalf("expected parents [%#v], got %#v", expectedParent, draft.Revision.Parents)
	}
	if draft.OutboxEntry.ExpectedParentRevisionRef == nil || *draft.OutboxEntry.ExpectedParentRevisionRef != expectedParent {
		t.Fatalf("expected outbox parent %#v, got %#v", expectedParent, draft.OutboxEntry.ExpectedParentRevisionRef)
	}
	found := false
	for _, edge := range draft.Edges {
		if edge.Relation == "derived_from" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected a derived_from edge when a parent revision is supplied")
	}
}

func TestCreateGovernedChangeDraftCreateHasNoParent(t *testing.T) {
	draft, err := CreateGovernedChangeDraft(GovernedChangeDraftInput{
		Scope:              EvidenceScope{TenantID: "org_acme_123"},
		Entity:             minimalEntityDefinition(t),
		After:              map[string]any{"id": "42", "quantity": 11},
		ChangedPaths:       []string{"/quantity"},
		Change:             GovernedChangeDeclaration{ID: "chg_create", Type: "project.estimate.created", InitiatedBy: EvidenceRef{Authority: "auth.acme.internal", Kind: "principal", Type: "user", ID: "usr_123"}},
		Activity:           GovernedActivityDeclaration{ID: "act_create", Type: "computation.project_cost_estimate", PerformedBy: EvidenceRef{Authority: "acme.billing", Kind: "principal", Type: "service", ID: "billing-api"}},
		Producer:           EvidenceRef{Authority: "acme.billing", Kind: "principal", Type: "service", ID: "billing-api"},
		OccurredAt:         "2026-06-23T10:18:00.000Z",
		IdempotencyKeyHash: "sha256:create",
	})
	if err != nil {
		t.Fatalf("CreateGovernedChangeDraft returned error: %v", err)
	}
	if len(draft.Revision.Parents) != 0 {
		t.Fatalf("expected no parents, got %#v", draft.Revision.Parents)
	}
	if draft.OutboxEntry.ExpectedParentRevisionRef != nil {
		t.Fatalf("expected no outbox parent, got %#v", draft.OutboxEntry.ExpectedParentRevisionRef)
	}
	for _, edge := range draft.Edges {
		if edge.Relation == "derived_from" {
			t.Fatal("expected no derived_from edge for a create")
		}
	}
}

func TestCreateGovernedChangeDraftRejectsInvalidTimestamp(t *testing.T) {
	input := validGovernedChangeInput(t)
	input.OccurredAt = "not-a-date"

	_, err := CreateGovernedChangeDraft(input)
	if err == nil || err.Error() != "occurredAt must be a valid date" {
		t.Fatalf("expected invalid date error, got %v", err)
	}
}

func TestCreateGovernedChangeDraftRequiresPrincipalRefsForActors(t *testing.T) {
	input := validGovernedChangeInput(t)
	input.Change.InitiatedBy = EvidenceRef{Authority: "acme.billing", Kind: "entity", Type: "project_entry", ID: "42"}

	_, err := CreateGovernedChangeDraft(input)
	if err == nil || err.Error() != "principal ref is required" {
		t.Fatalf("expected principal ref error, got %v", err)
	}
}

func TestCreateGovernedChangeDraftFailsClosedForUnsupportedCaptureMode(t *testing.T) {
	input := validGovernedChangeInput(t)
	input.Entity.Fields = map[string]EntityFieldPolicy{"sensitiveRef": {Capture: "reference"}}
	input.After["sensitiveRef"] = "external-secret-ref"
	input.ChangedPaths = []string{"/sensitiveRef"}

	_, err := CreateGovernedChangeDraft(input)
	if err == nil || !strings.Contains(err.Error(), "capture mode reference is not supported") {
		t.Fatalf("expected unsupported capture mode error, got %v", err)
	}
}

func validGovernedChangeInput(t *testing.T) GovernedChangeDraftInput {
	t.Helper()
	projectEntry, err := DefineEntity(GovernedEntityDefinition{
		Authority:   "acme.billing",
		Type:        "project_entry",
		SchemaRef:   "acme.billing/project_entry@3",
		FieldSetRef: "project-entry-governed-fields@2",
		Identity: func(row map[string]any) string {
			return row["id"].(string)
		},
		Fields: map[string]EntityFieldPolicy{
			"quantity":      {Capture: "full"},
			"customerEmail": {Capture: "keyed_digest"},
		},
	})
	if err != nil {
		t.Fatalf("DefineEntity returned error: %v", err)
	}
	return GovernedChangeDraftInput{
		Scope:  EvidenceScope{TenantID: "org_acme_123", WorkspaceID: "wks_security_456", Environment: "test"},
		Entity: projectEntry,
		After: map[string]any{
			"id":            "42",
			"quantity":      11,
			"customerEmail": "buyer@example.com",
		},
		ChangedPaths: []string{"/quantity"},
		Change: GovernedChangeDeclaration{
			ID:          "chg_project_estimate_91",
			Type:        "project.estimate.recalculation",
			InitiatedBy: EvidenceRef{Authority: "auth.acme.internal", Kind: "principal", Type: "user", ID: "usr_123"},
		},
		Activity: GovernedActivityDeclaration{
			ID:          "act_calculation_91",
			Type:        "computation.project_cost_estimate",
			PerformedBy: EvidenceRef{Authority: "acme.ai", Kind: "principal", Type: "ai_agent", ID: "cost_agent_7"},
		},
		Producer:           EvidenceRef{Authority: "acme.billing", Kind: "principal", Type: "service", ID: "billing-api"},
		OccurredAt:         "2026-06-23T10:18:00.000Z",
		IdempotencyKeyHash: "sha256:governed-change-test",
		DigestKeys:         DigestKeys{KeyedDigest: &KeyedDigestKey{KeyVersion: "tenant-key-7", Secret: "test-hmac-secret"}},
	}
}

func TestGovernedRevisionIDMatchesConformanceFixture(t *testing.T) {
	fixture := loadFixture(t, "governed-revision-id.json")
	cases, ok := fixture["cases"].([]any)
	if !ok || len(cases) == 0 {
		t.Fatal("governed-revision-id.json has no cases")
	}
	for _, rawCase := range cases {
		fixtureCase := rawCase.(map[string]any)
		got := GovernedRevisionID(
			fixtureCase["entityType"].(string),
			fixtureCase["entityId"].(string),
			fixtureCase["stateDigest"].(string),
			fixtureCase["changeId"].(string),
		)
		if got != fixtureCase["expected"].(string) {
			t.Fatalf("%s: expected %s, got %s", fixtureCase["name"], fixtureCase["expected"], got)
		}
	}
}

func TestRollbackToIdenticalStateYieldsDistinctRevisionID(t *testing.T) {
	draftFor := func(changeID string) GovernedChangeDraft {
		draft, err := CreateGovernedChangeDraft(GovernedChangeDraftInput{
			Scope:              EvidenceScope{TenantID: "org_acme_123"},
			Entity:             minimalEntityDefinition(t),
			Before:             map[string]any{"id": "42", "quantity": 10},
			After:              map[string]any{"id": "42", "quantity": 11},
			ChangedPaths:       []string{"/quantity"},
			Change:             GovernedChangeDeclaration{ID: changeID, Type: "project.estimate.recalculation", InitiatedBy: EvidenceRef{Authority: "auth.acme.internal", Kind: "principal", Type: "user", ID: "usr_123"}},
			Activity:           GovernedActivityDeclaration{ID: "act_roll", Type: "computation.project_cost_estimate", PerformedBy: EvidenceRef{Authority: "acme.billing", Kind: "principal", Type: "service", ID: "billing-api"}},
			Producer:           EvidenceRef{Authority: "acme.billing", Kind: "principal", Type: "service", ID: "billing-api"},
			OccurredAt:         "2026-06-23T10:18:00.000Z",
			IdempotencyKeyHash: "sha256:rollback-test",
		})
		if err != nil {
			t.Fatalf("CreateGovernedChangeDraft returned error: %v", err)
		}
		return draft
	}

	first := draftFor("chg_a")
	rollback := draftFor("chg_b")
	replay := draftFor("chg_a")

	// Identical governed state (same commitment digest) ...
	if rollback.Revision.StateCommitment.Digest != first.Revision.StateCommitment.Digest {
		t.Fatal("expected identical state commitments for the rollback scenario")
	}
	// ... but a DIFFERENT change must never merge into the same revision node.
	if rollback.Revision.Ref.ID == first.Revision.Ref.ID {
		t.Fatal("rollback to an identical state must yield a distinct revision id")
	}
	// Replaying the same change stays idempotent.
	if replay.Revision.Ref.ID != first.Revision.Ref.ID {
		t.Fatal("replaying the same change must yield the same revision id")
	}
}

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	veritio "github.com/getveritio/veritio/sdks/go"
)

// recordProjectMutation appends protocol audit and graph records plus one
// EvidenceCommit in one locked state transition so the demo's chains and commit
// stream stay in request order.
func (state *demoState) recordProjectMutation(value project, action string, relation string) error {
	event, err := veritio.CreateAuditEvent(veritio.AuditEventInput{
		ID:         fmt.Sprintf("evt_%s_%s", value.ID, relation),
		OccurredAt: occurredAtForSequence(len(state.auditRecords) + 1),
		Actor:      demoActor(),
		Action:     action,
		Target: veritio.Resource{
			Type: "project",
			ID:   value.ID,
		},
		Scope:          demoScope(),
		Purpose:        "governed CRUD example",
		LawfulBasis:    "contract",
		DataCategories: []string{"project_record"},
		Retention:      "demo-retention",
		Metadata: map[string]any{
			"logSurface":      "api",
			"projectNameHash": stableHash(value.Name),
			"status":          value.Status,
		},
	})
	if err != nil {
		return err
	}
	auditRecord, err := state.appendAuditRecord(event, relation)
	if err != nil {
		return err
	}

	edge, err := veritio.CreateEvidenceEdge(veritio.EvidenceEdgeInput{
		ID:         fmt.Sprintf("edge_%s_%s", value.ID, relation),
		OccurredAt: occurredAtForSequence(len(state.edgeRecords) + 1),
		Scope:      demoScope(),
		From: veritio.EvidenceEntity{
			Type:      "actor",
			ID:        demoUserID,
			ActorType: "user",
		},
		Relation: relation,
		To: veritio.EvidenceEntity{
			Type:         "resource",
			ID:           value.ID,
			ResourceType: "project",
		},
		Metadata: map[string]any{
			"auditEventId": event.ID,
			"logSurface":   "api",
		},
	})
	if err != nil {
		return err
	}
	edgeRecord, err := state.appendEdgeRecord(edge, relation)
	if err != nil {
		return err
	}
	_, err = state.appendCommit(
		fmt.Sprintf("cmt_%s_%s", value.ID, relation),
		"str_"+demoTenantID+"_project_mutations",
		[]veritio.AuditRecord{auditRecord},
		[]veritio.EvidenceEdgeRecord{edgeRecord},
	)
	return err
}

// recordGovernedLifecycleScenario records a realistic multi-step governed
// workflow using SDK template helpers plus a richer evidence activity graph.
func (state *demoState) recordGovernedLifecycleScenario() (map[string]any, error) {
	scope := demoScope()
	actor := demoActor()
	service := veritio.Principal{Type: "system", ID: "system_exports"}
	plan := map[string]any{
		"scenario":  "governed_lifecycle",
		"tenantId":  demoTenantID,
		"subjectId": "subject_demo",
		"country":   "US",
		"region":    "CA",
		"steps": []string{
			"auth_session",
			"organization_bootstrap",
			"membership",
			"consent",
			"subject_request",
			"export",
			"retention",
			"processor_transfer",
		},
	}
	planJSON, err := veritio.CanonicalJSON(plan)
	if err != nil {
		return nil, err
	}
	canonicalPlanHash := stableHash(planJSON)
	externalAPI := veritio.AuditLogClassificationMetadata(veritio.AuditLogClassificationInput{
		Visibility: "external",
		Surface:    "api",
	})
	internalApp := veritio.AuditLogClassificationMetadata(veritio.AuditLogClassificationInput{
		Visibility: "internal",
		Surface:    "app",
	})
	systemWorker := veritio.AuditLogClassificationMetadata(veritio.AuditLogClassificationInput{
		Visibility: "system",
		Surface:    "worker",
	})
	events := []veritio.AuditEventInput{}
	authMetadata, err := veritio.WithRiskSignals(
		mergeMaps(externalAPI, map[string]any{"canonicalPlanHash": canonicalPlanHash}),
		veritio.RiskSignals{
			OperationType:  "create",
			Reversibility:  "recoverable",
			EnvCriticality: "production",
		},
	)
	if err != nil {
		return nil, err
	}
	authEvent, err := veritio.AuthSessionCreatedTemplate(veritio.SessionAuditTemplateInput{
		AuditTemplateCommonInput: veritio.AuditTemplateCommonInput{
			Scope:     scope,
			RequestID: "scenario:auth-session",
			Metadata:  authMetadata,
		},
		UserID:    demoUserID,
		SessionID: "session_demo_us_ca",
		SecurityContext: &veritio.SessionSecurityContext{
			IPAddressHash: stableHash("203.0.113.42"),
			UserAgentHash: stableHash("demo-browser"),
			Location: &veritio.SessionSecurityLocation{
				Country: "US",
				Region:  "CA",
			},
			Method:   "password",
			Provider: "better-auth",
		},
	})
	if err != nil {
		return nil, err
	}
	events = append(events, authEvent)

	orgEvent, err := veritio.OrganizationCreatedTemplate(veritio.OrganizationAuditTemplateInput{
		AuditTemplateCommonInput: veritio.AuditTemplateCommonInput{Scope: scope, RequestID: "scenario:org-created", Metadata: externalAPI},
		OrganizationID:           demoTenantID,
		OrganizationDisplay:      "Demo Tenant",
		Actor:                    actor,
	})
	if err != nil {
		return nil, err
	}
	events = append(events, orgEvent)

	invitedEvent, err := veritio.OrganizationMemberInvitedTemplate(veritio.OrganizationInvitationAuditTemplateInput{
		AuditTemplateCommonInput: veritio.AuditTemplateCommonInput{Scope: scope, RequestID: "scenario:member-invited", Metadata: internalApp},
		OrganizationID:           demoTenantID,
		InvitationID:             "invite_ops_reviewer",
		Inviter:                  actor,
		Role:                     []string{"admin", "privacy_reviewer"},
	})
	if err != nil {
		return nil, err
	}
	events = append(events, invitedEvent)

	joinedEvent, err := veritio.OrganizationMemberJoinedTemplate(veritio.OrganizationMemberAuditTemplateInput{
		AuditTemplateCommonInput: veritio.AuditTemplateCommonInput{Scope: scope, RequestID: "scenario:member-joined", Metadata: internalApp},
		OrganizationID:           demoTenantID,
		MemberID:                 "member_ops_reviewer",
		Actor:                    actor,
		Role:                     []string{"admin", "privacy_reviewer"},
	})
	if err != nil {
		return nil, err
	}
	events = append(events, joinedEvent)

	consentEvent, err := veritio.ConsentGrantedTemplate(veritio.ConsentAuditTemplateInput{
		AuditTemplateCommonInput: veritio.AuditTemplateCommonInput{
			Scope:          scope,
			RequestID:      "scenario:consent-granted",
			DataCategories: []string{"account", "preferences", "usage"},
			Metadata:       externalAPI,
		},
		Actor:     actor,
		ConsentID: "consent_marketing_demo",
		SubjectID: "subject_demo",
		PurposeID: "purpose_product_updates",
	})
	if err != nil {
		return nil, err
	}
	events = append(events, consentEvent)

	subjectRequestEvent, err := veritio.DataSubjectRequestCreatedTemplate(veritio.SubjectRequestAuditTemplateInput{
		AuditTemplateCommonInput: veritio.AuditTemplateCommonInput{Scope: scope, RequestID: "scenario:subject-request", Metadata: externalAPI},
		Actor:                    actor,
		SubjectRequestID:         "dsr_export_demo",
		RequestType:              "access_export",
		SubjectID:                "subject_demo",
	})
	if err != nil {
		return nil, err
	}
	events = append(events, subjectRequestEvent)

	exportEvent, err := veritio.ExportBundleCreatedTemplate(veritio.ExportBundleAuditTemplateInput{
		AuditTemplateCommonInput: veritio.AuditTemplateCommonInput{
			Scope:     scope,
			RequestID: "scenario:export-created",
			Metadata:  mergeMaps(externalAPI, map[string]any{"canonicalPlanHash": canonicalPlanHash}),
		},
		Actor:          service,
		ExportBundleID: "export_bundle_demo",
		Format:         "jsonl",
	})
	if err != nil {
		return nil, err
	}
	events = append(events, exportEvent)

	retentionEvent, err := veritio.RetentionPolicyAppliedTemplate(veritio.RetentionPolicyAuditTemplateInput{
		AuditTemplateCommonInput: veritio.AuditTemplateCommonInput{Scope: scope, RequestID: "scenario:retention-applied", Metadata: systemWorker},
		Actor:                    service,
		PolicyID:                 "policy_security_1y",
		ResourceID:               "project_demo",
	})
	if err != nil {
		return nil, err
	}
	events = append(events, retentionEvent)

	firstEventSequence := len(state.auditRecords)
	eventRecords := []veritio.AuditRecord{}
	for _, eventInput := range events {
		record, err := state.recordTemplateEvent(eventInput)
		if err != nil {
			return nil, err
		}
		eventRecords = append(eventRecords, record)
	}

	edges := []veritio.EvidenceEdgeInput{
		scenarioEdge("actor", demoUserID, "created", "resource", demoTenantID, "organization", canonicalPlanHash),
		scenarioEdge("actor", demoUserID, "created", "consent", "consent_marketing_demo", "", canonicalPlanHash),
		scenarioEdge("consent", "consent_marketing_demo", "subject_of", "data_subject", "subject_demo", "", canonicalPlanHash),
		scenarioEdge("data_subject", "subject_demo", "processed_for", "purpose", "purpose_product_updates", "", canonicalPlanHash),
		scenarioEdge("resource", "project_demo", "retained_under", "policy", "policy_security_1y", "", canonicalPlanHash),
		scenarioEdge("subject_request", "dsr_export_demo", "subject_of", "data_subject", "subject_demo", "", canonicalPlanHash),
		scenarioEdge("export_bundle", "export_bundle_demo", "exports", "subject_request", "dsr_export_demo", "", canonicalPlanHash),
		scenarioEdge("export_bundle", "export_bundle_demo", "sent_to", "processor", "processor_secure_mail", "", canonicalPlanHash),
		scenarioEdge("system", "system_exports", "attests_to", "export_bundle", "export_bundle_demo", "", canonicalPlanHash),
		scenarioEdge("resource", "project_demo", "part_of", "resource", demoTenantID, "organization", canonicalPlanHash),
	}
	edgeRecords := []veritio.EvidenceEdgeRecord{}
	for _, edgeInput := range edges {
		record, err := state.recordScenarioEdge(edgeInput)
		if err != nil {
			return nil, err
		}
		edgeRecords = append(edgeRecords, record)
	}

	commit, err := state.appendCommit("cmt_governed_lifecycle_demo", "str_"+demoTenantID+"_governed_lifecycle", eventRecords, edgeRecords)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"scenario":           "governed_lifecycle",
		"canonicalPlanHash":  canonicalPlanHash,
		"eventCount":         len(state.auditRecords) - firstEventSequence,
		"edgeCount":          len(edges),
		"commitId":           commit.CommitID,
		"commitRecordCount":  commit.RecordCount,
		"auditVerification":  verifyAuditRecords(state.auditRecords),
		"edgeVerification":   verifyEdgeRecords(state.edgeRecords),
		"commitVerification": veritio.VerifyEvidenceCommits(state.commitRecords),
	}, nil
}

// recordTemplateEvent appends a helper-built audit input using the example's
// existing hash-chain envelope path.
func (state *demoState) recordTemplateEvent(input veritio.AuditEventInput) (veritio.AuditRecord, error) {
	event, err := veritio.CreateAuditEvent(input)
	if err != nil {
		return veritio.AuditRecord{}, err
	}
	return state.appendAuditRecord(event, "scenario:"+event.Action+":"+event.Target.ID)
}

// recordScenarioEdge appends one helper scenario edge after SDK validation.
func (state *demoState) recordScenarioEdge(input veritio.EvidenceEdgeInput) (veritio.EvidenceEdgeRecord, error) {
	edge, err := veritio.CreateEvidenceEdge(input)
	if err != nil {
		return veritio.EvidenceEdgeRecord{}, err
	}
	return state.appendEdgeRecord(edge, "scenario:"+edge.Relation+":"+edge.To.ID)
}

// scenarioEdge builds one graph edge input using stable scenario metadata while
// preserving the SDK's language-neutral entity and relation vocabulary.
func scenarioEdge(
	fromType string,
	fromID string,
	relation string,
	toType string,
	toID string,
	resourceType string,
	canonicalPlanHash string,
) veritio.EvidenceEdgeInput {
	to := veritio.EvidenceEntity{Type: toType, ID: toID}
	if resourceType != "" {
		to.ResourceType = resourceType
	}
	return veritio.EvidenceEdgeInput{
		Scope:    demoScope(),
		From:     veritio.EvidenceEntity{Type: fromType, ID: fromID},
		Relation: relation,
		To:       to,
		Metadata: map[string]any{
			"source":            "gin-governed-lifecycle",
			"canonicalPlanHash": canonicalPlanHash,
		},
	}
}

// mergeMaps returns a fresh metadata map so template helpers can add scenario
// ids without mutating shared classifier metadata maps.
func mergeMaps(left map[string]any, right map[string]any) map[string]any {
	output := map[string]any{}
	for key, value := range left {
		output[key] = value
	}
	for key, value := range right {
		output[key] = value
	}
	return output
}

// appendAuditRecord creates a tamper-evident audit record envelope with the
// prior hash carried forward for tenant-scoped chain verification.
func (state *demoState) appendAuditRecord(event veritio.AuditEvent, idempotencySuffix string) (veritio.AuditRecord, error) {
	sequence := len(state.auditRecords) + 1
	previousHash := previousAuditHash(state.auditRecords)
	idempotencyKeyHash, err := veritio.HashIdempotencyKey(demoTenantID, "audit:"+event.ID+":"+idempotencySuffix)
	if err != nil {
		return veritio.AuditRecord{}, err
	}
	record := veritio.AuditRecord{
		Event:              event,
		Sequence:           sequence,
		PreviousHash:       previousHash,
		HashAlgorithm:      veritio.HashAlgorithm,
		Canonicalization:   veritio.Canonicalization,
		AppendedAt:         occurredAtForSequence(sequence),
		IdempotencyKeyHash: idempotencyKeyHash,
	}
	hash, err := veritio.HashAuditRecord(record)
	if err != nil {
		return veritio.AuditRecord{}, err
	}
	record.Hash = hash
	state.auditRecords = append(state.auditRecords, record)
	return record, nil
}

// appendEdgeRecord creates a tamper-evident graph edge envelope using the same
// tenant-bound idempotency convention as audit records.
func (state *demoState) appendEdgeRecord(edge veritio.EvidenceEdge, idempotencySuffix string) (veritio.EvidenceEdgeRecord, error) {
	sequence := len(state.edgeRecords) + 1
	previousHash := previousEdgeHash(state.edgeRecords)
	idempotencyKeyHash, err := veritio.HashIdempotencyKey(demoTenantID, "edge:"+edge.ID+":"+idempotencySuffix)
	if err != nil {
		return veritio.EvidenceEdgeRecord{}, err
	}
	record := veritio.EvidenceEdgeRecord{
		Edge:               edge,
		Sequence:           sequence,
		PreviousHash:       previousHash,
		HashAlgorithm:      veritio.HashAlgorithm,
		Canonicalization:   veritio.Canonicalization,
		AppendedAt:         occurredAtForSequence(sequence),
		IdempotencyKeyHash: idempotencyKeyHash,
	}
	hash, err := veritio.HashEvidenceEdgeRecord(record)
	if err != nil {
		return veritio.EvidenceEdgeRecord{}, err
	}
	record.Hash = hash
	state.edgeRecords = append(state.edgeRecords, record)
	return record, nil
}

// appendCommit creates an EvidenceCommit over local record envelopes while
// keeping ordered membership separate from any host transaction-binding claim.
func (state *demoState) appendCommit(
	commitID string,
	streamID string,
	auditRecords []veritio.AuditRecord,
	edgeRecords []veritio.EvidenceEdgeRecord,
) (veritio.EvidenceCommit, error) {
	members := []veritio.EvidenceCommitMember{}
	for index, record := range auditRecords {
		members = append(members, veritio.EvidenceCommitMember{
			Index:      index,
			RecordType: "audit.record",
			RecordID:   record.Event.ID,
			RecordHash: "sha256:" + record.Hash,
		})
	}
	for index, record := range edgeRecords {
		members = append(members, veritio.EvidenceCommitMember{
			Index:      len(auditRecords) + index,
			RecordType: "evidence.edge.record",
			RecordID:   record.Edge.ID,
			RecordHash: "sha256:" + record.Hash,
		})
	}

	previousCommit := previousCommitForStream(state.commitRecords, streamID)
	sequence := 1
	var previousHash *string
	if previousCommit != nil {
		sequence = previousCommit.Sequence + 1
		previousHash = stringPointer(previousCommit.Hash)
	}
	commit, err := veritio.CreateEvidenceCommit(veritio.EvidenceCommitInput{
		CommitID:           commitID,
		StreamID:           streamID,
		Sequence:           sequence,
		PreviousCommitHash: previousHash,
		Members:            members,
	})
	if err != nil {
		return veritio.EvidenceCommit{}, err
	}
	state.commitRecords = append(state.commitRecords, commit)
	return commit, nil
}

// verifyAuditRecords recomputes the audit record chain and fails closed when
// sequence numbers, previous hashes, or envelope hashes diverge.
func verifyAuditRecords(records []veritio.AuditRecord) verificationResult {
	var failures []string
	var previousHash *string
	for index, record := range records {
		if record.Sequence != index+1 {
			failures = append(failures, fmt.Sprintf("audit record %d has sequence %d", index, record.Sequence))
		}
		if !sameOptionalString(record.PreviousHash, previousHash) {
			failures = append(failures, fmt.Sprintf("audit record %d has invalid previous hash", index))
		}
		expectedHash, err := veritio.HashAuditRecord(recordWithoutAuditHash(record))
		if err != nil {
			failures = append(failures, fmt.Sprintf("audit record %d could not be hashed", index))
		} else if record.Hash != expectedHash {
			failures = append(failures, fmt.Sprintf("audit record %d has invalid hash", index))
		}
		previousHash = stringPointer(record.Hash)
	}
	return verificationResult{OK: len(failures) == 0, Errors: failures}
}

// verifyEdgeRecords recomputes the evidence-edge chain and reports explicit
// chain failures rather than silently treating missing integrity as success.
func verifyEdgeRecords(records []veritio.EvidenceEdgeRecord) verificationResult {
	var failures []string
	var previousHash *string
	for index, record := range records {
		if record.Sequence != index+1 {
			failures = append(failures, fmt.Sprintf("edge record %d has sequence %d", index, record.Sequence))
		}
		if !sameOptionalString(record.PreviousHash, previousHash) {
			failures = append(failures, fmt.Sprintf("edge record %d has invalid previous hash", index))
		}
		expectedHash, err := veritio.HashEvidenceEdgeRecord(recordWithoutEdgeHash(record))
		if err != nil {
			failures = append(failures, fmt.Sprintf("edge record %d could not be hashed", index))
		} else if record.Hash != expectedHash {
			failures = append(failures, fmt.Sprintf("edge record %d has invalid hash", index))
		}
		previousHash = stringPointer(record.Hash)
	}
	return verificationResult{OK: len(failures) == 0, Errors: failures}
}

// recordWithoutAuditHash clears the stored hash before recomputing the audit
// envelope hash, matching the SDK's record-hashing contract.
func recordWithoutAuditHash(record veritio.AuditRecord) veritio.AuditRecord {
	record.Hash = ""
	return record
}

// recordWithoutEdgeHash clears the stored hash before recomputing the edge
// envelope hash, matching the SDK's record-hashing contract.
func recordWithoutEdgeHash(record veritio.EvidenceEdgeRecord) veritio.EvidenceEdgeRecord {
	record.Hash = ""
	return record
}

// previousAuditHash copies the last audit hash so later slice changes cannot
// mutate the pointer stored on the next record.
func previousAuditHash(records []veritio.AuditRecord) *string {
	if len(records) == 0 {
		return nil
	}
	return stringPointer(records[len(records)-1].Hash)
}

// previousEdgeHash copies the last edge hash so later slice changes cannot
// mutate the pointer stored on the next record.
func previousEdgeHash(records []veritio.EvidenceEdgeRecord) *string {
	if len(records) == 0 {
		return nil
	}
	return stringPointer(records[len(records)-1].Hash)
}

// previousCommitForStream returns the last commit in a logical stream so the
// example can maintain per-stream commit sequence and previous-hash linkage.
func previousCommitForStream(records []veritio.EvidenceCommit, streamID string) *veritio.EvidenceCommit {
	for index := len(records) - 1; index >= 0; index-- {
		if records[index].StreamID == streamID {
			return &records[index]
		}
	}
	return nil
}

// sameOptionalString compares nullable hashes without treating nil and empty
// strings as interchangeable integrity values.
func sameOptionalString(left *string, right *string) bool {
	if left == nil || right == nil {
		return left == right
	}
	return *left == *right
}

// stableHash keeps display text out of evidence metadata while preserving a
// deterministic join key for local demos and hosted projections.
func stableHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// stringPointer returns a pointer to a copy so previous-hash references remain
// stable after the source variable goes out of scope.
func stringPointer(value string) *string {
	return &value
}

// demoActor centralizes the server-owned user principal and prevents clients
// from spoofing the actor through CRUD request bodies.
func demoActor() veritio.Principal {
	return veritio.Principal{Type: "user", ID: demoUserID}
}

// demoScope centralizes the tenant scope required for idempotency and evidence
// records while keeping hosted project IDs out of the OSS example.
func demoScope() *veritio.EvidenceScope {
	return &veritio.EvidenceScope{TenantID: demoTenantID, Environment: "reference"}
}

// occurredAtForSequence gives the example deterministic timestamps so hashes
// remain reproducible across repeated local test runs.
func occurredAtForSequence(sequence int) string {
	return time.Date(2026, 6, 23, 12, 0, sequence, 0, time.UTC).Format("2006-01-02T15:04:05.000Z")
}

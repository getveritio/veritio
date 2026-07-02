package veritio

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestCanonicalJSONMatchesConformanceFixtures(t *testing.T) {
	for _, conformanceCase := range fixtureCases(t, "canonical-json.json") {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			actual, err := CanonicalJSON(conformanceCase["input"])
			if err != nil {
				t.Fatalf("CanonicalJSON returned error: %v", err)
			}

			expected := stringValue(t, conformanceCase["expected"])
			if actual != expected {
				t.Fatalf("expected %s, got %s", expected, actual)
			}
		})
	}
}

func TestCreateAuditEventMatchesConformanceFixtures(t *testing.T) {
	for _, conformanceCase := range fixtureCases(t, "event-creation.json") {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			event, err := CreateAuditEvent(decodeValue[AuditEventInput](t, conformanceCase["input"]))
			if err != nil {
				t.Fatalf("CreateAuditEvent returned error: %v", err)
			}

			actual := toJSONMap(t, event)
			expected := mapValue(t, conformanceCase["expected"])
			if !reflect.DeepEqual(actual, expected) {
				t.Fatalf("expected %#v, got %#v", expected, actual)
			}
		})
	}
}

func TestRedactionMatchesConformanceFixtures(t *testing.T) {
	for _, conformanceCase := range fixtureCases(t, "redaction.json") {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			event, err := CreateAuditEvent(AuditEventInput{
				ID:         "evt_redaction_fixture",
				OccurredAt: "2026-06-10T00:00:00.000Z",
				Actor:      Principal{Type: "user", ID: "usr_fixture_123"},
				Action:     "org.member.invited",
				Target:     Resource{Type: "organization", ID: "org_fixture_123"},
				Metadata:   mapValue(t, conformanceCase["metadata"]),
			})
			if err != nil {
				t.Fatalf("CreateAuditEvent returned error: %v", err)
			}

			expected := mapValue(t, conformanceCase["expectedMetadata"])
			if !reflect.DeepEqual(event.Metadata, expected) {
				t.Fatalf("expected %#v, got %#v", expected, event.Metadata)
			}
			edge, err := CreateEvidenceEdge(EvidenceEdgeInput{
				ID:         "edge_redaction_fixture",
				OccurredAt: "2026-06-23T10:18:04.000Z",
				From:       EvidenceEntity{Type: "change", ID: "chg_redaction_fixture"},
				Relation:   "has_output",
				To:         EvidenceEntity{Type: "revision", ID: "rev_redaction_fixture"},
				Metadata:   mapValue(t, conformanceCase["metadata"]),
			})
			if err != nil {
				t.Fatalf("CreateEvidenceEdge returned error: %v", err)
			}
			if !reflect.DeepEqual(edge.Metadata, expected) {
				t.Fatalf("expected edge metadata %#v, got %#v", expected, edge.Metadata)
			}
		})
	}
}

func TestCreateAuditEventRejectsInvalidAction(t *testing.T) {
	_, err := CreateAuditEvent(AuditEventInput{
		ID:         "evt_01",
		OccurredAt: "2026-06-10T00:00:00.000Z",
		Actor:      Principal{Type: "user", ID: "usr_123"},
		Action:     "OrgMemberInvited",
		Target:     Resource{Type: "organization", ID: "org_123"},
		Metadata:   map[string]any{},
	})
	if err == nil {
		t.Fatal("expected invalid action error")
	}
	if err.Error() != "action must use dotted lowercase protocol form" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestHashAuditEventMatchesConformanceFixtures(t *testing.T) {
	for _, conformanceCase := range fixtureCases(t, "event-hashing.json") {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			event := decodeValue[AuditEvent](t, conformanceCase["event"])
			actual, err := HashAuditEvent(event, optionalStringPointer(t, conformanceCase["previousHash"]))
			if err != nil {
				t.Fatalf("HashAuditEvent returned error: %v", err)
			}

			expected := stringValue(t, conformanceCase["expectedHash"])
			if actual != expected {
				t.Fatalf("expected %s, got %s", expected, actual)
			}
		})
	}
}

func TestAuditRecordHashingMatchesConformanceFixtures(t *testing.T) {
	for _, conformanceCase := range fixtureCases(t, "audit-record-hashing.json") {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			idempotencyKeyHash, err := HashIdempotencyKey(
				stringValue(t, conformanceCase["tenantId"]),
				stringValue(t, conformanceCase["idempotencyKey"]),
			)
			if err != nil {
				t.Fatalf("HashIdempotencyKey returned error: %v", err)
			}

			expectedIdempotencyKeyHash := stringValue(t, conformanceCase["expectedIdempotencyKeyHash"])
			if idempotencyKeyHash != expectedIdempotencyKeyHash {
				t.Fatalf("expected %s, got %s", expectedIdempotencyKeyHash, idempotencyKeyHash)
			}

			actual, err := HashAuditRecord(decodeValue[AuditRecord](t, conformanceCase["recordWithoutHash"]))
			if err != nil {
				t.Fatalf("HashAuditRecord returned error: %v", err)
			}

			expected := stringValue(t, conformanceCase["expectedHash"])
			if actual != expected {
				t.Fatalf("expected %s, got %s", expected, actual)
			}
		})
	}
}

func TestCreateEvidenceEdgeMatchesConformanceFixtures(t *testing.T) {
	for _, conformanceCase := range fixtureCases(t, "edge-creation.json") {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			edge, err := CreateEvidenceEdge(decodeValue[EvidenceEdgeInput](t, conformanceCase["input"]))
			if err != nil {
				t.Fatalf("CreateEvidenceEdge returned error: %v", err)
			}

			actual := toJSONMap(t, edge)
			expected := mapValue(t, conformanceCase["expected"])
			if !reflect.DeepEqual(actual, expected) {
				t.Fatalf("expected %#v, got %#v", expected, actual)
			}
		})
	}
}

func TestCreateEvidenceEdgeRejectsInvalidRelation(t *testing.T) {
	_, err := CreateEvidenceEdge(EvidenceEdgeInput{
		ID:         "edge_invalid_relation",
		OccurredAt: "2026-06-13T00:00:00.000Z",
		From:       EvidenceEntity{Type: "agent_session", ID: "agt_sess_123"},
		Relation:   "linked_to",
		To:         EvidenceEntity{Type: "file", ID: "file_123"},
		Metadata:   map[string]any{},
	})
	if err == nil {
		t.Fatal("expected invalid relation error")
	}
	if err.Error() != "relation must be a supported evidence graph relation" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestCreateEvidenceEdgeRequiresEntityReferences(t *testing.T) {
	_, err := CreateEvidenceEdge(EvidenceEdgeInput{
		ID:         "edge_missing_entity_id",
		OccurredAt: "2026-06-13T00:00:00.000Z",
		From:       EvidenceEntity{Type: "agent_session", ID: ""},
		Relation:   "created",
		To:         EvidenceEntity{Type: "file", ID: "file_123"},
		Metadata:   map[string]any{},
	})
	if err == nil {
		t.Fatal("expected missing entity id error")
	}
	if err.Error() != "from.id is required" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestHashEvidenceEdgeMatchesConformanceFixtures(t *testing.T) {
	for _, conformanceCase := range fixtureCases(t, "edge-hashing.json") {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			edge := decodeValue[EvidenceEdge](t, conformanceCase["edge"])
			actual, err := HashEvidenceEdge(edge, optionalStringPointer(t, conformanceCase["previousHash"]))
			if err != nil {
				t.Fatalf("HashEvidenceEdge returned error: %v", err)
			}

			expected := stringValue(t, conformanceCase["expectedHash"])
			if actual != expected {
				t.Fatalf("expected %s, got %s", expected, actual)
			}
		})
	}
}

func TestEdgeRecordHashingMatchesConformanceFixtures(t *testing.T) {
	for _, conformanceCase := range fixtureCases(t, "edge-record-hashing.json") {
		conformanceCase := conformanceCase
		t.Run(caseName(t, conformanceCase), func(t *testing.T) {
			idempotencyKeyHash, err := HashIdempotencyKey(
				stringValue(t, conformanceCase["tenantId"]),
				stringValue(t, conformanceCase["idempotencyKey"]),
			)
			if err != nil {
				t.Fatalf("HashIdempotencyKey returned error: %v", err)
			}

			expectedIdempotencyKeyHash := stringValue(t, conformanceCase["expectedIdempotencyKeyHash"])
			if idempotencyKeyHash != expectedIdempotencyKeyHash {
				t.Fatalf("expected %s, got %s", expectedIdempotencyKeyHash, idempotencyKeyHash)
			}

			actual, err := HashEvidenceEdgeRecord(decodeValue[EvidenceEdgeRecord](t, conformanceCase["recordWithoutHash"]))
			if err != nil {
				t.Fatalf("HashEvidenceEdgeRecord returned error: %v", err)
			}

			expected := stringValue(t, conformanceCase["expectedHash"])
			if actual != expected {
				t.Fatalf("expected %s, got %s", expected, actual)
			}
		})
	}
}

func TestEvidenceCommitMatchesConformanceFixtures(t *testing.T) {
	cases := fixtureCases(t, "evidence-commit.json")
	orderedCase := cases[0]
	oddCase := cases[1]

	commit, err := CreateEvidenceCommit(decodeValue[EvidenceCommitInput](t, orderedCase["input"]))
	if err != nil {
		t.Fatalf("CreateEvidenceCommit returned error: %v", err)
	}
	actual := toJSONMap(t, commit)
	expected := mapValue(t, orderedCase["expected"])
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("expected %#v, got %#v", expected, actual)
	}
	hash, err := HashEvidenceCommit(commit)
	if err != nil {
		t.Fatalf("HashEvidenceCommit returned error: %v", err)
	}
	if hash != commit.Hash {
		t.Fatalf("expected hash %s, got %s", commit.Hash, hash)
	}
	result := VerifyEvidenceCommits([]EvidenceCommit{commit})
	if result.OK || result.Index != 0 || result.Reason != "previous_hash_mismatch" {
		t.Fatalf("unexpected verification result: %#v", result)
	}

	oddCommit, err := CreateEvidenceCommit(decodeValue[EvidenceCommitInput](t, oddCase["input"]))
	if err != nil {
		t.Fatalf("CreateEvidenceCommit returned error: %v", err)
	}
	if oddCommit.RecordsRoot != stringValue(t, oddCase["expectedRecordsRoot"]) {
		t.Fatalf("expected odd root %s, got %s", stringValue(t, oddCase["expectedRecordsRoot"]), oddCommit.RecordsRoot)
	}
}

func TestEvidenceCommitRejectsEmptyAndDuplicateMembers(t *testing.T) {
	baseInput := EvidenceCommitInput{
		CommitID:           "cmt_empty",
		StreamID:           "str_fixture",
		Sequence:           1,
		PreviousCommitHash: nil,
		CommittedAt:        "2026-06-23T10:15:31.000Z",
		Members:            []EvidenceCommitMember{},
	}

	_, err := CreateEvidenceCommit(baseInput)
	if err == nil || err.Error() != "members must not be empty" {
		t.Fatalf("expected empty commit error, got %v", err)
	}
	_, err = CreateEvidenceCommit(EvidenceCommitInput{
		CommitID:           "cmt_duplicate",
		StreamID:           "str_fixture",
		Sequence:           1,
		PreviousCommitHash: nil,
		CommittedAt:        "2026-06-23T10:15:31.000Z",
		Members: []EvidenceCommitMember{
			{
				Index:      0,
				RecordType: "audit.record",
				RecordID:   "evt_01",
				RecordHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			},
			{
				Index:      1,
				RecordType: "audit.record",
				RecordID:   "evt_01",
				RecordHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			},
		},
	})
	if err == nil || err.Error() != "duplicate commit member" {
		t.Fatalf("expected duplicate member error, got %v", err)
	}
	_, err = CreateEvidenceCommit(EvidenceCommitInput{
		CommitID:           "cmt_bad_time",
		StreamID:           "str_fixture",
		Sequence:           1,
		PreviousCommitHash: nil,
		CommittedAt:        "not-a-date",
		Members: []EvidenceCommitMember{
			{
				Index:      0,
				RecordType: "audit.record",
				RecordID:   "evt_01",
				RecordHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			},
		},
	})
	if err == nil || err.Error() != "committedAt must be a valid date" {
		t.Fatalf("expected invalid committedAt error, got %v", err)
	}
}

func TestEvidenceCommitVerifierDetectsChainAndHashTampering(t *testing.T) {
	first, err := CreateEvidenceCommit(EvidenceCommitInput{
		CommitID:           "cmt_01",
		StreamID:           "str_fixture",
		Sequence:           1,
		PreviousCommitHash: nil,
		CommittedAt:        "2026-06-23T10:15:31.000Z",
		Members: []EvidenceCommitMember{
			{
				Index:      0,
				RecordType: "audit.record",
				RecordID:   "evt_01",
				RecordHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateEvidenceCommit returned error: %v", err)
	}
	second, err := CreateEvidenceCommit(EvidenceCommitInput{
		CommitID:           "cmt_02",
		StreamID:           "str_fixture",
		Sequence:           2,
		PreviousCommitHash: &first.Hash,
		CommittedAt:        "2026-06-23T10:16:31.000Z",
		Members: []EvidenceCommitMember{
			{
				Index:      0,
				RecordType: "evidence.edge.record",
				RecordID:   "edge_01",
				RecordHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateEvidenceCommit returned error: %v", err)
	}

	result := VerifyEvidenceCommits([]EvidenceCommit{first, second})
	if !result.OK {
		t.Fatalf("expected ok verification, got %#v", result)
	}
	encodedOK, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal ok verifier result: %v", err)
	}
	if string(encodedOK) != `{"ok":true}` {
		t.Fatalf("expected ok verifier JSON to match TS/Python shape, got %s", encodedOK)
	}
	tamperedPrevious := second
	tamperedPrevious.PreviousCommitHash = nil
	result = VerifyEvidenceCommits([]EvidenceCommit{tamperedPrevious})
	if result.OK || result.Index != 0 || result.Reason != "sequence_mismatch" {
		t.Fatalf("unexpected previous hash result: %#v", result)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal verifier result: %v", err)
	}
	if !strings.Contains(string(encoded), `"index":0`) {
		t.Fatalf("expected failed verifier JSON to include index 0, got %s", encoded)
	}
	tamperedCount := second
	tamperedCount.RecordCount = 2
	result = VerifyEvidenceCommits([]EvidenceCommit{first, tamperedCount})
	if result.OK || result.Index != 1 || result.Reason != "record_count_mismatch" {
		t.Fatalf("unexpected tamper result: %#v", result)
	}
}

func TestAuditTemplateSetsExposeCommonActions(t *testing.T) {
	assertContainsString(t, AuditTemplateSets["auth"], "auth.session.created")
	assertContainsString(t, AuditTemplateSets["organization"], "org.created")
	assertContainsString(t, AuditTemplateSets["agent"], "agent.session.started")
	assertContainsString(t, AuditTemplateSets["code"], "review.waiver.recorded")
}

func TestAuditLogClassifierHelpersAndDetectors(t *testing.T) {
	expectedVisibilities := []string{"internal", "external", "partner", "system"}
	expectedSurfaces := []string{"api", "app", "worker", "cli", "webhook"}
	if !reflect.DeepEqual(AuditLogVisibilityValues, expectedVisibilities) {
		t.Fatalf("expected %#v, got %#v", expectedVisibilities, AuditLogVisibilityValues)
	}
	if !reflect.DeepEqual(AuditLogSurfaceValues, expectedSurfaces) {
		t.Fatalf("expected %#v, got %#v", expectedSurfaces, AuditLogSurfaceValues)
	}

	metadata := AuditLogClassificationMetadata(AuditLogClassificationInput{
		Visibility: "public",
		Surface:    "REST",
	})
	expectedMetadata := map[string]any{"logVisibility": "external", "logSurface": "api"}
	if !reflect.DeepEqual(metadata, expectedMetadata) {
		t.Fatalf("expected %#v, got %#v", expectedMetadata, metadata)
	}

	internalMetadata := AuditLogClassificationMetadata(AuditLogClassificationInput{
		Visibility: "staff",
		Surface:    "dashboard",
	})
	expectedInternalMetadata := map[string]any{"logVisibility": "internal", "logSurface": "app"}
	if !reflect.DeepEqual(internalMetadata, expectedInternalMetadata) {
		t.Fatalf("expected %#v, got %#v", expectedInternalMetadata, internalMetadata)
	}

	classifiers := DetectAuditLogClassifiers(map[string]any{
		"auditLog": map[string]any{"visibility": "partner", "surface": "webhook"},
	})
	if classifiers.Visibility != "partner" || classifiers.Surface != "webhook" {
		t.Fatalf("unexpected classifiers: %#v", classifiers)
	}

	classifiers = DetectAuditLogClassifiers(map[string]any{
		"visibility": "customer",
		"client":     map[string]any{"type": "browser"},
	})
	if classifiers.Visibility != "external" || classifiers.Surface != "app" {
		t.Fatalf("unexpected classifiers: %#v", classifiers)
	}
}

func TestAuthSessionTemplateKeepsHashedSecurityContext(t *testing.T) {
	template, err := AuthSessionCreatedTemplate(SessionAuditTemplateInput{
		AuditTemplateCommonInput: AuditTemplateCommonInput{
			ID:         "evt_signin",
			OccurredAt: "2026-06-20T00:00:00.000Z",
			Scope:      &EvidenceScope{TenantID: "org_123", Environment: "test"},
			Metadata: mergeTemplateMetadata(
				map[string]any{"authorization": "Bearer secret"},
				AuditLogClassificationMetadata(AuditLogClassificationInput{Visibility: "customer", Surface: "api"}),
			),
		},
		UserID:    "usr_123",
		SessionID: "sess_123",
		SecurityContext: &SessionSecurityContext{
			IPAddressHash: "sha256:client-ip",
			UserAgentHash: "sha256:user-agent",
			Location:      &SessionSecurityLocation{Country: "US", Region: "CA"},
		},
	})
	if err != nil {
		t.Fatalf("AuthSessionCreatedTemplate returned error: %v", err)
	}

	event, err := CreateAuditEvent(template)
	if err != nil {
		t.Fatalf("CreateAuditEvent returned error: %v", err)
	}

	expected := map[string]any{
		"authorization": "[redacted]",
		"logSurface":    "api",
		"logVisibility": "external",
		"securityContext": map[string]any{
			"ipAddressHash": "sha256:client-ip",
			"location":      map[string]any{"country": "US", "region": "CA"},
			"userAgentHash": "sha256:user-agent",
		},
	}
	if !reflect.DeepEqual(event.Metadata, expected) {
		t.Fatalf("expected %#v, got %#v", expected, event.Metadata)
	}
}

func TestOrganizationTemplateDefaultsTenantScope(t *testing.T) {
	template, err := OrganizationCreatedTemplate(OrganizationAuditTemplateInput{
		AuditTemplateCommonInput: AuditTemplateCommonInput{
			ID:         "evt_org_created",
			OccurredAt: "2026-06-20T00:01:00.000Z",
		},
		OrganizationID: "org_123",
		Actor:          Principal{Type: "user", ID: "usr_123"},
	})
	if err != nil {
		t.Fatalf("OrganizationCreatedTemplate returned error: %v", err)
	}

	event, err := CreateAuditEvent(template)
	if err != nil {
		t.Fatalf("CreateAuditEvent returned error: %v", err)
	}
	if event.Action != "org.created" {
		t.Fatalf("expected org.created, got %s", event.Action)
	}
	if event.Scope == nil || event.Scope.TenantID != "org_123" {
		t.Fatalf("expected tenant scope org_123, got %#v", event.Scope)
	}
}

func TestAgentTemplatePreservesReservedSessionID(t *testing.T) {
	template, err := AgentSessionStartedTemplate(AgentSessionAuditTemplateInput{
		AuditTemplateCommonInput: AuditTemplateCommonInput{
			ID:         "evt_agent_started",
			OccurredAt: "2026-06-20T00:02:00.000Z",
			Scope:      &EvidenceScope{TenantID: "org_123"},
			Metadata:   map[string]any{"sessionId": "caller_shadow", "reason": "code_review"},
		},
		SessionID:  "agt_sess_123",
		AgentActor: Principal{Type: "ai_agent", ID: "agent_codex"},
	})
	if err != nil {
		t.Fatalf("AgentSessionStartedTemplate returned error: %v", err)
	}

	event, err := CreateAuditEvent(template)
	if err != nil {
		t.Fatalf("CreateAuditEvent returned error: %v", err)
	}
	expected := map[string]any{"reason": "code_review", "sessionId": "agt_sess_123"}
	if !reflect.DeepEqual(event.Metadata, expected) {
		t.Fatalf("expected %#v, got %#v", expected, event.Metadata)
	}
}

func TestCodeTemplatesIncludeSessionGrouping(t *testing.T) {
	fileCount := 2
	filesTemplate, err := FilesChangedTemplate(FilesChangedAuditTemplateInput{
		AuditTemplateCommonInput: AuditTemplateCommonInput{
			ID:         "evt_files_changed",
			OccurredAt: "2026-06-20T00:03:00.000Z",
			Scope:      &EvidenceScope{TenantID: "org_123"},
		},
		SourceTreeID:   "tree_123",
		Actor:          Principal{Type: "ai_agent", ID: "agent_codex"},
		SessionID:      "agt_sess_123",
		FileCount:      &fileCount,
		FilePathHashes: []string{"hash_b", "hash_a"},
	})
	if err != nil {
		t.Fatalf("FilesChangedTemplate returned error: %v", err)
	}
	filesEvent, err := CreateAuditEvent(filesTemplate)
	if err != nil {
		t.Fatalf("CreateAuditEvent returned error: %v", err)
	}

	waiverCount := 1
	waiverTemplate, err := ReviewWaiverRecordedTemplate(ReviewAuditTemplateInput{
		AuditTemplateCommonInput: AuditTemplateCommonInput{
			ID:         "evt_review_waiver",
			OccurredAt: "2026-06-20T00:04:00.000Z",
			Scope:      &EvidenceScope{TenantID: "org_123"},
			Metadata:   map[string]any{"sessionId": "caller_shadow"},
		},
		PullRequestID: "pr_123",
		Reviewer:      Principal{Type: "user", ID: "usr_reviewer"},
		SessionID:     "agt_sess_123",
		ProposalID:    "proposal_123",
		WaiverCount:   &waiverCount,
	})
	if err != nil {
		t.Fatalf("ReviewWaiverRecordedTemplate returned error: %v", err)
	}
	waiverEvent, err := CreateAuditEvent(waiverTemplate)
	if err != nil {
		t.Fatalf("CreateAuditEvent returned error: %v", err)
	}

	expectedHashes := []any{"hash_b", "hash_a"}
	if !reflect.DeepEqual(filesEvent.Metadata["filePathHashes"], expectedHashes) {
		t.Fatalf("expected %#v, got %#v", expectedHashes, filesEvent.Metadata["filePathHashes"])
	}
	if waiverEvent.Action != "review.waiver.recorded" {
		t.Fatalf("expected review.waiver.recorded, got %s", waiverEvent.Action)
	}
	if waiverEvent.Metadata["sessionId"] != "agt_sess_123" {
		t.Fatalf("expected session id agt_sess_123, got %#v", waiverEvent.Metadata["sessionId"])
	}
}

func TestAgentAndCodeTemplatesRejectRawContentMetadata(t *testing.T) {
	agentActor := Principal{Type: "ai_agent", ID: "agent_codex"}
	scope := &EvidenceScope{TenantID: "org_123"}
	unsafeCases := []struct {
		name string
		run  func() error
	}{
		{
			name: "raw prompt",
			run: func() error {
				_, err := AgentPromptRecordedTemplate(AgentPromptAuditTemplateInput{
					AuditTemplateCommonInput: AuditTemplateCommonInput{
						Scope:    scope,
						Metadata: map[string]any{"prompt": "create a secret-bearing patch"},
					},
					SessionID:  "agt_sess_123",
					PromptHash: "sha256:prompt",
					AgentActor: agentActor,
				})
				return err
			},
		},
		{
			name: "raw diff",
			run: func() error {
				_, err := FilesChangedTemplate(FilesChangedAuditTemplateInput{
					AuditTemplateCommonInput: AuditTemplateCommonInput{
						Scope:    scope,
						Metadata: map[string]any{"diff": "diff --git a/a.go b/a.go"},
					},
					SourceTreeID: "tree_123",
					Actor:        agentActor,
				})
				return err
			},
		},
		{
			name: "raw hunk",
			run: func() error {
				_, err := FilesChangedTemplate(FilesChangedAuditTemplateInput{
					AuditTemplateCommonInput: AuditTemplateCommonInput{
						Scope:    scope,
						Metadata: map[string]any{"hunk": "@@ -1 +1 @@"},
					},
					SourceTreeID: "tree_123",
					Actor:        agentActor,
				})
				return err
			},
		},
		{
			name: "raw file path",
			run: func() error {
				_, err := FilesChangedTemplate(FilesChangedAuditTemplateInput{
					AuditTemplateCommonInput: AuditTemplateCommonInput{
						Scope:    scope,
						Metadata: map[string]any{"filePath": "src/secrets.go"},
					},
					SourceTreeID: "tree_123",
					Actor:        agentActor,
				})
				return err
			},
		},
		{
			name: "stdout",
			run: func() error {
				_, err := AgentToolCalledTemplate(AgentToolAuditTemplateInput{
					AuditTemplateCommonInput: AuditTemplateCommonInput{
						Scope:    scope,
						Metadata: map[string]any{"stdout": "raw command output"},
					},
					SessionID:  "agt_sess_123",
					ToolCallID: "tool_123",
					Tool:       "shell",
					Status:     "ok",
					AgentActor: agentActor,
				})
				return err
			},
		},
		{
			name: "stderr",
			run: func() error {
				_, err := AgentToolCalledTemplate(AgentToolAuditTemplateInput{
					AuditTemplateCommonInput: AuditTemplateCommonInput{
						Scope:    scope,
						Metadata: map[string]any{"stderr": "raw error output"},
					},
					SessionID:  "agt_sess_123",
					ToolCallID: "tool_123",
					Tool:       "shell",
					Status:     "failed",
					AgentActor: agentActor,
				})
				return err
			},
		},
		{
			name: "tool args",
			run: func() error {
				_, err := AgentToolCalledTemplate(AgentToolAuditTemplateInput{
					AuditTemplateCommonInput: AuditTemplateCommonInput{
						Scope:    scope,
						Metadata: map[string]any{"toolArgs": map[string]any{"command": "cat .env"}},
					},
					SessionID:  "agt_sess_123",
					ToolCallID: "tool_123",
					Tool:       "shell",
					Status:     "ok",
					AgentActor: agentActor,
				})
				return err
			},
		},
		{
			name: "token-like value",
			run: func() error {
				_, err := ChangeProposalCreatedTemplate(ChangeProposalAuditTemplateInput{
					AuditTemplateCommonInput: AuditTemplateCommonInput{
						Scope:    scope,
						Metadata: map[string]any{"note": "Bearer abc.def"},
					},
					ProposalID: "proposal_123",
					Actor:      agentActor,
				})
				return err
			},
		},
	}

	for _, unsafeCase := range unsafeCases {
		unsafeCase := unsafeCase
		t.Run(unsafeCase.name, func(t *testing.T) {
			err := unsafeCase.run()
			if err == nil {
				t.Fatal("expected raw content metadata error")
			}
			if !strings.Contains(err.Error(), "not allowed") && !strings.Contains(err.Error(), "looks like raw content") {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func fixtureCases(t *testing.T, fileName string) []map[string]any {
	t.Helper()
	fixture := loadFixture(t, fileName)
	rawCases, ok := fixture["cases"].([]any)
	if !ok {
		t.Fatalf("%s cases must be an array", fileName)
	}

	cases := make([]map[string]any, 0, len(rawCases))
	for _, rawCase := range rawCases {
		cases = append(cases, mapValue(t, rawCase))
	}
	return cases
}

func assertContainsString(t *testing.T, values []string, expected string) {
	t.Helper()
	for _, value := range values {
		if value == expected {
			return
		}
	}
	t.Fatalf("expected %#v to contain %s", values, expected)
}

func loadFixture(t *testing.T, fileName string) map[string]any {
	t.Helper()
	bytes, err := os.ReadFile(filepath.Join(findConformanceDir(t), fileName))
	if err != nil {
		t.Fatalf("failed to read fixture %s: %v", fileName, err)
	}

	var fixture map[string]any
	if err := json.Unmarshal(bytes, &fixture); err != nil {
		t.Fatalf("failed to parse fixture %s: %v", fileName, err)
	}
	return fixture
}

func findConformanceDir(t *testing.T) string {
	t.Helper()
	current, err := os.Getwd()
	if err != nil {
		t.Fatalf("failed to read current directory: %v", err)
	}

	for {
		candidate := filepath.Join(current, "spec", "conformance")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	t.Fatal("failed to locate spec/conformance")
	return ""
}

func decodeValue[T any](t *testing.T, value any) T {
	t.Helper()
	bytes, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("failed to encode fixture value: %v", err)
	}

	var decoded T
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("failed to decode fixture value: %v", err)
	}
	return decoded
}

func toJSONMap(t *testing.T, value any) map[string]any {
	t.Helper()
	bytes, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("failed to encode value: %v", err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("failed to decode value: %v", err)
	}
	return decoded
}

func caseName(t *testing.T, conformanceCase map[string]any) string {
	t.Helper()
	return stringValue(t, conformanceCase["name"])
}

func mapValue(t *testing.T, value any) map[string]any {
	t.Helper()
	typed, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("expected object, got %#v", value)
	}
	return typed
}

func stringValue(t *testing.T, value any) string {
	t.Helper()
	typed, ok := value.(string)
	if !ok {
		t.Fatalf("expected string, got %#v", value)
	}
	return typed
}

func optionalStringPointer(t *testing.T, value any) *string {
	t.Helper()
	if value == nil {
		return nil
	}
	typed := stringValue(t, value)
	return &typed
}

func TestTemplatesStampRiskSignalsAndEpisodeUnshadowably(t *testing.T) {
	template, err := ChangeProposalCreatedTemplate(ChangeProposalAuditTemplateInput{
		AuditTemplateCommonInput: AuditTemplateCommonInput{
			ID:         "evt_change_proposal_risk",
			OccurredAt: "2026-06-23T10:00:00.000Z",
			Scope:      &EvidenceScope{TenantID: "org_123"},
			Metadata: map[string]any{
				"activityEpisodeId": "caller_shadow",
				"riskSignals":       map[string]any{"operationType": "read"},
			},
			ActivityEpisodeID: "episode_real_01",
			RiskSignals:       &RiskSignals{OperationType: "delete", EnvCriticality: "production"},
		},
		ProposalID:   "proposal_123",
		Actor:        Principal{Type: "ai_agent", ID: "agent_codex"},
		SessionID:    "agt_sess_123",
		RepositoryID: "repo_123",
		Branch:       "main",
	})
	if err != nil {
		t.Fatalf("ChangeProposalCreatedTemplate error: %v", err)
	}
	event, err := CreateAuditEvent(template)
	if err != nil {
		t.Fatalf("CreateAuditEvent error: %v", err)
	}
	if event.Metadata["activityEpisodeId"] != "episode_real_01" {
		t.Fatalf("episode id=%#v", event.Metadata["activityEpisodeId"])
	}
	expectedSignals := map[string]any{
		"operationType":  "delete",
		"reversibility":  "recoverable",
		"envCriticality": "production",
		"dataVolume":     float64(0),
		"fanOut":         float64(0),
		"referenceCount": float64(0),
	}
	if !reflect.DeepEqual(event.Metadata["riskSignals"], expectedSignals) {
		t.Fatalf("riskSignals=%#v, want %#v", event.Metadata["riskSignals"], expectedSignals)
	}
}

func TestEpisodeStartedTemplateStampsEpisodeTargetAndMetadata(t *testing.T) {
	template, err := EpisodeStartedTemplate(EpisodeStartedAuditTemplateInput{
		AuditTemplateCommonInput: AuditTemplateCommonInput{
			ID:         "evt_episode_started",
			OccurredAt: "2026-06-23T10:00:00.000Z",
			Scope:      &EvidenceScope{TenantID: "org_123"},
		},
		ActivityEpisodeID: "episode_real_01",
		Actor:             Principal{Type: "ai_agent", ID: "agent_codex"},
		AuthSessionID:     "ses_123",
		Domain:            "billing",
		StartReason:       "code_review",
	})
	if err != nil {
		t.Fatalf("EpisodeStartedTemplate error: %v", err)
	}
	event, err := CreateAuditEvent(template)
	if err != nil {
		t.Fatalf("CreateAuditEvent error: %v", err)
	}
	if event.Action != "activity.episode.started" {
		t.Fatalf("action=%s", event.Action)
	}
	if event.Target.Type != "activity_episode" || event.Target.ID != "episode_real_01" {
		t.Fatalf("target=%#v", event.Target)
	}
	expected := map[string]any{
		"activityEpisodeId": "episode_real_01",
		"authSessionId":     "ses_123",
		"domain":            "billing",
		"startReason":       "code_review",
	}
	if !reflect.DeepEqual(event.Metadata, expected) {
		t.Fatalf("metadata=%#v, want %#v", event.Metadata, expected)
	}
}

func TestEvidenceEdgeAcceptsActivityEpisodeEntity(t *testing.T) {
	edge, err := CreateEvidenceEdge(EvidenceEdgeInput{
		ID:         "edge_episode_part_of",
		OccurredAt: "2026-06-23T10:00:00.000Z",
		From:       EvidenceEntity{Type: "change", ID: "chg_01"},
		Relation:   "part_of",
		To:         EvidenceEntity{Type: "activity_episode", ID: "episode_real_01"},
		Metadata:   map[string]any{},
	})
	if err != nil {
		t.Fatalf("CreateEvidenceEdge error: %v", err)
	}
	if edge.To.Type != "activity_episode" {
		t.Fatalf("to.type=%s", edge.To.Type)
	}
}

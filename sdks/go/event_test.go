package veritio

import "testing"

func TestCanonicalJSONSortsKeysRecursively(t *testing.T) {
	actual, err := CanonicalJSON(map[string]any{
		"z": 1,
		"a": map[string]any{
			"c": 3,
			"b": []any{2, map[string]any{"y": "yes", "x": "first"}},
		},
	})
	if err != nil {
		t.Fatalf("CanonicalJSON returned error: %v", err)
	}

	expected := `{"a":{"b":[2,{"x":"first","y":"yes"}],"c":3},"z":1}`
	if actual != expected {
		t.Fatalf("expected %s, got %s", expected, actual)
	}
}

func TestCanonicalJSONPreservesNullAndDoesNotHTMLEscapeStrings(t *testing.T) {
	lineSeparator := string(rune(0x2028))
	actual, err := CanonicalJSON(map[string]any{
		"note": "<&" + lineSeparator,
		"a":    nil,
	})
	if err != nil {
		t.Fatalf("CanonicalJSON returned error: %v", err)
	}

	expected := `{"a":null,"note":"<&` + lineSeparator + `"}`
	if actual != expected {
		t.Fatalf("expected %s, got %s", expected, actual)
	}
}

func TestCreateAuditEventRedactsSensitiveMetadata(t *testing.T) {
	event, err := CreateAuditEvent(AuditEventInput{
		ID:         "evt_01",
		OccurredAt: "2026-06-10T00:00:00.000Z",
		Actor:      Principal{Type: "user", ID: "usr_123"},
		Action:     "org.member.invited",
		Target:     Resource{Type: "organization", ID: "org_123"},
		Metadata: map[string]any{
			"invitedEmail": "member@example.com",
			"role":         "viewer",
		},
	})
	if err != nil {
		t.Fatalf("CreateAuditEvent returned error: %v", err)
	}

	if event.SchemaVersion != "2026-06-10" {
		t.Fatalf("unexpected schema version: %s", event.SchemaVersion)
	}
	if event.Metadata["invitedEmail"] != "[redacted]" {
		t.Fatalf("expected invitedEmail to be redacted, got %#v", event.Metadata["invitedEmail"])
	}
	if event.Metadata["role"] != "viewer" {
		t.Fatalf("expected role to remain safe, got %#v", event.Metadata["role"])
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

func TestHashIdempotencyKeyMatchesProtocolVector(t *testing.T) {
	actual, err := HashIdempotencyKey("org_123", "evt_01")
	if err != nil {
		t.Fatalf("HashIdempotencyKey returned error: %v", err)
	}

	expected := "e18c21b684554d90c197722b0b121e63bd5eadf5bf2f844c70f31be0825016f8"
	if actual != expected {
		t.Fatalf("expected %s, got %s", expected, actual)
	}
}

func TestHashAuditRecordMatchesProtocolVector(t *testing.T) {
	lineSeparator := string(rune(0x2028))
	idempotencyKeyHash, err := HashIdempotencyKey("org_123", "evt_01")
	if err != nil {
		t.Fatalf("HashIdempotencyKey returned error: %v", err)
	}

	actual, err := HashAuditRecord(AuditRecord{
		Event: AuditEvent{
			ID:            "evt_01",
			SchemaVersion: SchemaVersion,
			OccurredAt:    "2026-06-10T00:00:00.000Z",
			Actor:         Principal{Type: "user", ID: "usr_123"},
			Action:        "org.member.invited",
			Target:        Resource{Type: "organization", ID: "org_123"},
			Scope:         &EvidenceScope{TenantID: "org_123", Environment: "test"},
			Metadata: map[string]any{
				"note":     "<&" + lineSeparator,
				"optional": nil,
				"role":     "viewer",
			},
		},
		Sequence:           1,
		PreviousHash:       nil,
		HashAlgorithm:      HashAlgorithm,
		Canonicalization:   Canonicalization,
		AppendedAt:         "2026-06-10T00:00:01.000Z",
		IdempotencyKeyHash: idempotencyKeyHash,
	})
	if err != nil {
		t.Fatalf("HashAuditRecord returned error: %v", err)
	}

	expected := "14396c51f0304f26c9be4ac918daf9d50109c0d9fd238ccb1c87c15632427edf"
	if actual != expected {
		t.Fatalf("expected %s, got %s", expected, actual)
	}
}

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

func TestCreateAuditEventRedactsSensitiveMetadata(t *testing.T) {
	event, err := CreateAuditEvent(AuditEventInput{
		ID:         "evt_01",
		OccurredAt: "2026-06-10T00:00:00.000Z",
		Actor:     Principal{Type: "user", ID: "usr_123"},
		Action:    "org.member.invited",
		Target:    Resource{Type: "organization", ID: "org_123"},
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

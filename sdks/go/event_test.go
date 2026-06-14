package veritio

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
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

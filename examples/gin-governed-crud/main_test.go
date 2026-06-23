package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProjectCRUDRecordsAuditEventsAndGraphEdges(t *testing.T) {
	router := setupRouter(newDemoState())

	created := requestJSON(t, router, http.MethodPost, "/projects", `{"name":"Retention inbox"}`, http.StatusCreated)
	projectID := created["id"].(string)

	updated := requestJSON(t, router, http.MethodPut, "/projects/"+projectID, `{"status":"reviewing"}`, http.StatusOK)
	if updated["status"] != "reviewing" {
		t.Fatalf("expected updated status, got %#v", updated["status"])
	}

	deleted := requestJSON(t, router, http.MethodDelete, "/projects/"+projectID, ``, http.StatusOK)
	if deleted["deleted"] != true {
		t.Fatalf("expected deleted marker, got %#v", deleted["deleted"])
	}

	evidence := requestJSON(t, router, http.MethodGet, "/evidence", ``, http.StatusOK)
	auditRecords := evidence["auditRecords"].([]any)
	edgeRecords := evidence["edgeRecords"].([]any)

	assertAuditActions(t, auditRecords, []string{"project.created", "project.updated", "project.deleted"})
	assertEdgeRelations(t, edgeRecords, []string{"created", "modified", "deleted"})
	assertVerificationOK(t, evidence["auditVerification"])
	assertVerificationOK(t, evidence["edgeVerification"])
}

func TestGovernedLifecycleScenarioRecordsBroadHelperDrivenGraph(t *testing.T) {
	router := setupRouter(newDemoState())

	scenario := requestJSON(t, router, http.MethodPost, "/scenarios/governed-lifecycle", ``, http.StatusOK)
	if scenario["eventCount"].(float64) < 8 {
		t.Fatalf("expected at least 8 scenario events, got %#v", scenario["eventCount"])
	}
	if scenario["edgeCount"].(float64) < 10 {
		t.Fatalf("expected at least 10 scenario edges, got %#v", scenario["edgeCount"])
	}
	if hash, ok := scenario["canonicalPlanHash"].(string); !ok || len(hash) < len("sha256:") || hash[:7] != "sha256:" {
		t.Fatalf("expected canonical plan hash, got %#v", scenario["canonicalPlanHash"])
	}

	evidence := requestJSON(t, router, http.MethodGet, "/evidence", ``, http.StatusOK)
	auditRecords := evidence["auditRecords"].([]any)
	edgeRecords := evidence["edgeRecords"].([]any)

	assertContainsAuditActions(t, auditRecords, []string{
		"auth.session.created",
		"org.created",
		"consent.granted",
		"data.subject.request.created",
		"export.bundle.created",
		"retention.policy.applied",
	})
	assertAuthLocation(t, auditRecords, map[string]any{"country": "US", "region": "CA"})
	assertContainsEdgeRelations(t, edgeRecords, []string{
		"subject_of",
		"processed_for",
		"retained_under",
		"exports",
		"sent_to",
		"attests_to",
	})
	assertVerificationOK(t, evidence["auditVerification"])
	assertVerificationOK(t, evidence["edgeVerification"])
}

func requestJSON(t *testing.T, handler http.Handler, method string, path string, body string, expectedStatus int) map[string]any {
	t.Helper()

	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if body != "" {
		request.Header.Set("content-type", "application/json")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != expectedStatus {
		t.Fatalf("expected status %d, got %d with body %s", expectedStatus, recorder.Code, recorder.Body.String())
	}

	var decoded map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return decoded
}

func assertAuditActions(t *testing.T, records []any, expected []string) {
	t.Helper()
	if len(records) != len(expected) {
		t.Fatalf("expected %d audit records, got %d", len(expected), len(records))
	}
	for index, expectedAction := range expected {
		record := records[index].(map[string]any)
		event := record["event"].(map[string]any)
		if event["action"] != expectedAction {
			t.Fatalf("record %d expected action %s, got %#v", index, expectedAction, event["action"])
		}
	}
}

func assertEdgeRelations(t *testing.T, records []any, expected []string) {
	t.Helper()
	if len(records) != len(expected) {
		t.Fatalf("expected %d edge records, got %d", len(expected), len(records))
	}
	for index, expectedRelation := range expected {
		record := records[index].(map[string]any)
		edge := record["edge"].(map[string]any)
		if edge["relation"] != expectedRelation {
			t.Fatalf("edge %d expected relation %s, got %#v", index, expectedRelation, edge["relation"])
		}
	}
}

func assertContainsAuditActions(t *testing.T, records []any, expected []string) {
	t.Helper()
	seen := map[string]bool{}
	for _, item := range records {
		record := item.(map[string]any)
		event := record["event"].(map[string]any)
		seen[event["action"].(string)] = true
	}
	for _, action := range expected {
		if !seen[action] {
			t.Fatalf("expected audit action %s in %#v", action, seen)
		}
	}
}

func assertContainsEdgeRelations(t *testing.T, records []any, expected []string) {
	t.Helper()
	seen := map[string]bool{}
	for _, item := range records {
		record := item.(map[string]any)
		edge := record["edge"].(map[string]any)
		seen[edge["relation"].(string)] = true
	}
	for _, relation := range expected {
		if !seen[relation] {
			t.Fatalf("expected edge relation %s in %#v", relation, seen)
		}
	}
}

func assertAuthLocation(t *testing.T, records []any, expected map[string]any) {
	t.Helper()
	for _, item := range records {
		record := item.(map[string]any)
		event := record["event"].(map[string]any)
		if event["action"] != "auth.session.created" {
			continue
		}
		metadata := event["metadata"].(map[string]any)
		securityContext := metadata["securityContext"].(map[string]any)
		location := securityContext["location"].(map[string]any)
		if location["country"] != expected["country"] || location["region"] != expected["region"] {
			t.Fatalf("expected auth location %#v, got %#v", expected, location)
		}
		return
	}
	t.Fatalf("auth.session.created record not found")
}

func assertVerificationOK(t *testing.T, value any) {
	t.Helper()
	verification := value.(map[string]any)
	if verification["ok"] != true {
		t.Fatalf("expected ok verification, got %#v", verification)
	}
}

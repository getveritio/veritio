package veritio

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"time"
)

const SchemaVersion = "2026-06-10"

var sensitiveKeyPattern = regexp.MustCompile(`(?i)(password|secret|token|api[_-]?key|authorization|email|phone|ssn)`)

type Principal struct {
	Type    string `json:"type"`
	ID      string `json:"id"`
	Display string `json:"display,omitempty"`
}

type Resource struct {
	Type    string `json:"type"`
	ID      string `json:"id"`
	Display string `json:"display,omitempty"`
}

type EvidenceScope struct {
	TenantID    string `json:"tenantId,omitempty"`
	WorkspaceID string `json:"workspaceId,omitempty"`
	Environment string `json:"environment,omitempty"`
}

type AuditEventInput struct {
	ID             string
	OccurredAt     string
	Actor          Principal
	Action         string
	Target         Resource
	Scope          *EvidenceScope
	RequestID      string
	Purpose        string
	LawfulBasis    string
	DataCategories []string
	Retention      string
	Metadata       map[string]any
}

type AuditEvent struct {
	ID             string         `json:"id"`
	SchemaVersion  string         `json:"schemaVersion"`
	OccurredAt     string         `json:"occurredAt"`
	Actor          Principal      `json:"actor"`
	Action         string         `json:"action"`
	Target         Resource       `json:"target"`
	Scope          *EvidenceScope `json:"scope,omitempty"`
	RequestID      string         `json:"requestId,omitempty"`
	Purpose        string         `json:"purpose,omitempty"`
	LawfulBasis    string         `json:"lawfulBasis,omitempty"`
	DataCategories []string       `json:"dataCategories,omitempty"`
	Retention      string         `json:"retention,omitempty"`
	Metadata       map[string]any `json:"metadata"`
}

func CanonicalJSON(value any) (string, error) {
	normalized, err := normalizeJSON(value)
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func CreateAuditEvent(input AuditEventInput) (AuditEvent, error) {
	if input.Actor.ID == "" {
		return AuditEvent{}, errors.New("actor.id is required")
	}
	if input.Actor.Type == "" {
		return AuditEvent{}, errors.New("actor.type is required")
	}
	if input.Action == "" {
		return AuditEvent{}, errors.New("action is required")
	}
	if input.Target.ID == "" {
		return AuditEvent{}, errors.New("target.id is required")
	}
	if input.Target.Type == "" {
		return AuditEvent{}, errors.New("target.type is required")
	}

	id := input.ID
	if id == "" {
		id = "evt_" + randomHex(16)
	}

	occurredAt := input.OccurredAt
	if occurredAt == "" {
		occurredAt = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	} else if parsed, err := time.Parse(time.RFC3339Nano, occurredAt); err == nil {
		occurredAt = parsed.UTC().Format("2006-01-02T15:04:05.000Z")
	}

	dataCategories := uniqueSorted(input.DataCategories)
	event := AuditEvent{
		ID:             id,
		SchemaVersion:  SchemaVersion,
		OccurredAt:     occurredAt,
		Actor:          input.Actor,
		Action:         input.Action,
		Target:         input.Target,
		Scope:          input.Scope,
		RequestID:      input.RequestID,
		Purpose:        input.Purpose,
		LawfulBasis:    input.LawfulBasis,
		DataCategories: dataCategories,
		Retention:      input.Retention,
		Metadata:       redactMetadata(input.Metadata),
	}
	return event, nil
}

func HashAuditEvent(event AuditEvent, previousHash *string) (string, error) {
	payload := map[string]any{
		"event":        event,
		"previousHash": previousHash,
	}
	canonical, err := CanonicalJSON(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:]), nil
}

func redactMetadata(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	redacted, ok := redactAny(value, "").(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return redacted
}

func redactAny(value any, key string) any {
	if sensitiveKeyPattern.MatchString(key) {
		return "[redacted]"
	}
	switch typed := value.(type) {
	case nil, string, bool, int, int64, float64, float32:
		return typed
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = redactAny(item, key)
		}
		return out
	case map[string]any:
		out := map[string]any{}
		keys := make([]string, 0, len(typed))
		for nestedKey := range typed {
			keys = append(keys, nestedKey)
		}
		sort.Strings(keys)
		for _, nestedKey := range keys {
			out[nestedKey] = redactAny(typed[nestedKey], nestedKey)
		}
		return out
	case time.Time:
		return typed.UTC().Format("2006-01-02T15:04:05.000Z")
	default:
		return fmt.Sprint(value)
	}
}

func normalizeJSON(value any) (any, error) {
	switch typed := value.(type) {
	case nil, string, bool, int, int64, float64, float32:
		return typed, nil
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			normalized, err := normalizeJSON(item)
			if err != nil {
				return nil, err
			}
			out[i] = normalized
		}
		return out, nil
	case map[string]any:
		out := map[string]any{}
		for key, nestedValue := range typed {
			normalized, err := normalizeJSON(nestedValue)
			if err != nil {
				return nil, err
			}
			out[key] = normalized
		}
		return out, nil
	case time.Time:
		return typed.UTC().Format("2006-01-02T15:04:05.000Z"), nil
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		var decoded any
		if err := json.Unmarshal(encoded, &decoded); err != nil {
			return nil, err
		}
		return decoded, nil
	}
}

func uniqueSorted(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	for _, value := range values {
		seen[value] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for value := range seen {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func randomHex(byteCount int) string {
	bytes := make([]byte, byteCount)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(bytes)
}

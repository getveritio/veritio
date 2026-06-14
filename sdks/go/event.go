package veritio

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

const SchemaVersion = "2026-06-10"
const EdgeSchemaVersion = "2026-06-13"
const HashAlgorithm = "sha256"
const Canonicalization = "veritio-json-v1"

var sensitiveKeyPattern = regexp.MustCompile(`(?i)(password|secret|token|api[_-]?key|authorization|email|phone|ssn)`)
var actionPattern = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$`)
var evidenceEntityTypes = map[string]struct{}{
	"tenant":          {},
	"actor":           {},
	"data_subject":    {},
	"resource":        {},
	"data_category":   {},
	"purpose":         {},
	"policy":          {},
	"consent":         {},
	"processor":       {},
	"system":          {},
	"repository":      {},
	"branch":          {},
	"commit":          {},
	"pull_request":    {},
	"file":            {},
	"diff_hunk":       {},
	"agent_session":   {},
	"tool_call":       {},
	"ci_run":          {},
	"artifact":        {},
	"deployment":      {},
	"runtime_event":   {},
	"subject_request": {},
	"export_bundle":   {},
}
var evidenceEdgeRelations = map[string]struct{}{
	"caused_by":        {},
	"part_of":          {},
	"read":             {},
	"modified":         {},
	"created":          {},
	"deleted":          {},
	"derived_from":     {},
	"reviewed_by":      {},
	"approved_by":      {},
	"waived_by":        {},
	"built_by":         {},
	"deployed_as":      {},
	"observed_in":      {},
	"attests_to":       {},
	"exports":          {},
	"satisfies_policy": {},
	"violates_policy":  {},
	"subject_of":       {},
	"processed_for":    {},
	"retained_under":   {},
	"sent_to":          {},
}

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

type EvidenceEntity struct {
	Type         string `json:"type"`
	ID           string `json:"id"`
	ActorType    string `json:"actorType,omitempty"`
	ResourceType string `json:"resourceType,omitempty"`
	Version      string `json:"version,omitempty"`
	PathHash     string `json:"pathHash,omitempty"`
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

type EvidenceEdgeInput struct {
	ID         string
	OccurredAt string
	Scope      *EvidenceScope
	From       EvidenceEntity
	Relation   string
	To         EvidenceEntity
	Metadata   map[string]any
}

type EvidenceEdge struct {
	ID            string         `json:"id"`
	SchemaVersion string         `json:"schemaVersion"`
	OccurredAt    string         `json:"occurredAt"`
	Scope         *EvidenceScope `json:"scope,omitempty"`
	From          EvidenceEntity `json:"from"`
	Relation      string         `json:"relation"`
	To            EvidenceEntity `json:"to"`
	Metadata      map[string]any `json:"metadata"`
}

type AuditRecord struct {
	Event              AuditEvent `json:"event"`
	Sequence           int        `json:"sequence"`
	PreviousHash       *string    `json:"previousHash"`
	Hash               string     `json:"hash"`
	HashAlgorithm      string     `json:"hashAlgorithm"`
	Canonicalization   string     `json:"canonicalization"`
	AppendedAt         string     `json:"appendedAt"`
	IdempotencyKeyHash string     `json:"idempotencyKeyHash"`
}

type EvidenceEdgeRecord struct {
	Edge               EvidenceEdge `json:"edge"`
	Sequence           int          `json:"sequence"`
	PreviousHash       *string      `json:"previousHash"`
	Hash               string       `json:"hash"`
	HashAlgorithm      string       `json:"hashAlgorithm"`
	Canonicalization   string       `json:"canonicalization"`
	AppendedAt         string       `json:"appendedAt"`
	IdempotencyKeyHash string       `json:"idempotencyKeyHash"`
}

func CanonicalJSON(value any) (string, error) {
	normalized, err := normalizeJSON(value)
	if err != nil {
		return "", err
	}
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(normalized); err != nil {
		return "", err
	}
	return unescapeJSONLineTerminators(strings.TrimSuffix(encoded.String(), "\n")), nil
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
	if !actionPattern.MatchString(input.Action) {
		return AuditEvent{}, errors.New("action must use dotted lowercase protocol form")
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

func CreateEvidenceEdge(input EvidenceEdgeInput) (EvidenceEdge, error) {
	from, err := cleanEvidenceEntity(input.From, "from")
	if err != nil {
		return EvidenceEdge{}, err
	}
	to, err := cleanEvidenceEntity(input.To, "to")
	if err != nil {
		return EvidenceEdge{}, err
	}
	if _, ok := evidenceEdgeRelations[input.Relation]; !ok {
		return EvidenceEdge{}, errors.New("relation must be a supported evidence graph relation")
	}

	id := input.ID
	if id == "" {
		id = "edge_" + randomHex(16)
	}

	occurredAt := input.OccurredAt
	if occurredAt == "" {
		occurredAt = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	} else if parsed, err := time.Parse(time.RFC3339Nano, occurredAt); err == nil {
		occurredAt = parsed.UTC().Format("2006-01-02T15:04:05.000Z")
	}

	edge := EvidenceEdge{
		ID:            id,
		SchemaVersion: EdgeSchemaVersion,
		OccurredAt:    occurredAt,
		Scope:         input.Scope,
		From:          from,
		Relation:      input.Relation,
		To:            to,
		Metadata:      redactMetadata(input.Metadata),
	}
	return edge, nil
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

func HashEvidenceEdge(edge EvidenceEdge, previousHash *string) (string, error) {
	payload := map[string]any{
		"edge":         edge,
		"previousHash": previousHash,
	}
	canonical, err := CanonicalJSON(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:]), nil
}

func HashAuditRecord(record AuditRecord) (string, error) {
	payload := map[string]any{
		"event":              record.Event,
		"sequence":           record.Sequence,
		"previousHash":       record.PreviousHash,
		"hashAlgorithm":      record.HashAlgorithm,
		"canonicalization":   record.Canonicalization,
		"appendedAt":         record.AppendedAt,
		"idempotencyKeyHash": record.IdempotencyKeyHash,
	}
	canonical, err := CanonicalJSON(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:]), nil
}

func HashEvidenceEdgeRecord(record EvidenceEdgeRecord) (string, error) {
	payload := map[string]any{
		"edge":               record.Edge,
		"sequence":           record.Sequence,
		"previousHash":       record.PreviousHash,
		"hashAlgorithm":      record.HashAlgorithm,
		"canonicalization":   record.Canonicalization,
		"appendedAt":         record.AppendedAt,
		"idempotencyKeyHash": record.IdempotencyKeyHash,
	}
	canonical, err := CanonicalJSON(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:]), nil
}

func HashIdempotencyKey(tenantID string, idempotencyKey string) (string, error) {
	if strings.TrimSpace(tenantID) == "" {
		return "", errors.New("tenantId is required")
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return "", errors.New("idempotencyKey is required")
	}
	sum := sha256.Sum256([]byte(tenantID + "\x00" + idempotencyKey))
	return hex.EncodeToString(sum[:]), nil
}

func cleanEvidenceEntity(value EvidenceEntity, field string) (EvidenceEntity, error) {
	if value.Type == "" {
		return EvidenceEntity{}, fmt.Errorf("%s.type is required", field)
	}
	if value.ID == "" {
		return EvidenceEntity{}, fmt.Errorf("%s.id is required", field)
	}
	if _, ok := evidenceEntityTypes[value.Type]; !ok {
		return EvidenceEntity{}, fmt.Errorf("%s.type must be a supported evidence graph entity type", field)
	}
	return value, nil
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

func unescapeJSONLineTerminators(value string) string {
	var builder strings.Builder
	for index := 0; index < len(value); {
		if strings.HasPrefix(value[index:], `\u2028`) && isUnescapedJSONBackslash(value, index) {
			builder.WriteRune(rune(0x2028))
			index += len(`\u2028`)
			continue
		}
		if strings.HasPrefix(value[index:], `\u2029`) && isUnescapedJSONBackslash(value, index) {
			builder.WriteRune(rune(0x2029))
			index += len(`\u2029`)
			continue
		}
		builder.WriteByte(value[index])
		index++
	}
	return builder.String()
}

func isUnescapedJSONBackslash(value string, index int) bool {
	count := 0
	for cursor := index - 1; cursor >= 0 && value[cursor] == '\\'; cursor-- {
		count++
	}
	return count%2 == 0
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

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
const EvidenceCommitSchemaVersion = "2026-06-23"
const HashAlgorithm = "sha256"
const Canonicalization = "veritio-json-v1"
const EvidenceCommitTreeAlgorithm = "veritio-merkle-v1"

var sensitiveKeyPattern = regexp.MustCompile(`(?i)(password|secret|token|api[_-]?key|authorization|email|phone|ssn)`)
var digestEnvelopePattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
var actionPattern = regexp.MustCompile(`^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$`)
var evidenceCommitDigestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
var evidenceEntityTypes = map[string]struct{}{
	"tenant":           {},
	"principal":        {},
	"actor":            {},
	"activity":         {},
	"activity_episode": {},
	"change":           {},
	"revision":         {},
	"assertion":        {},
	"record":           {},
	"evidence_commit":  {},
	"data_subject":     {},
	"resource":         {},
	"data_category":    {},
	"purpose":          {},
	"policy":           {},
	"consent":          {},
	"processor":        {},
	"system":           {},
	"repository":       {},
	"branch":           {},
	"commit":           {},
	"pull_request":     {},
	"file":             {},
	"diff_hunk":        {},
	"agent_session":    {},
	"tool_call":        {},
	"ci_run":           {},
	"artifact":         {},
	"deployment":       {},
	"runtime_event":    {},
	"subject_request":  {},
	"export_bundle":    {},
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
	"has_activity":     {},
	"has_input":        {},
	"has_output":       {},
	"has_assertion":    {},
	"resulted_in":      {},
	"performed_by":     {},
	"used":             {},
	"generated":        {},
	"based_on":         {},
	"asserts_about":    {},
	"retracts":         {},
	"corrects":         {},
	"supersedes":       {},
	"disputes":         {},
	"confirms":         {},
	"compensates":      {},
}
var evidenceCommitMemberRecordTypes = map[string]struct{}{
	"audit.record":           {},
	"evidence.edge.record":   {},
	"entity.revision.record": {},
	"activity.record":        {},
	"assertion.record":       {},
	"change.record":          {},
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
	ID             string         `json:"id,omitempty"`
	OccurredAt     string         `json:"occurredAt,omitempty"`
	Actor          Principal      `json:"actor,omitempty"`
	Action         string         `json:"action,omitempty"`
	Target         Resource       `json:"target,omitempty"`
	Scope          *EvidenceScope `json:"scope,omitempty"`
	RequestID      string         `json:"requestId,omitempty"`
	Purpose        string         `json:"purpose,omitempty"`
	LawfulBasis    string         `json:"lawfulBasis,omitempty"`
	DataCategories []string       `json:"dataCategories,omitempty"`
	Retention      string         `json:"retention,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
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
	ID         string         `json:"id,omitempty"`
	OccurredAt string         `json:"occurredAt,omitempty"`
	Scope      *EvidenceScope `json:"scope,omitempty"`
	From       EvidenceEntity `json:"from,omitempty"`
	Relation   string         `json:"relation,omitempty"`
	To         EvidenceEntity `json:"to,omitempty"`
	Metadata   map[string]any `json:"metadata,omitempty"`
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

type EvidenceCommitMember struct {
	Index      int    `json:"index"`
	RecordType string `json:"recordType"`
	RecordID   string `json:"recordId"`
	RecordHash string `json:"recordHash"`
}

type EvidenceCommitInput struct {
	CommitID           string                 `json:"commitId"`
	StreamID           string                 `json:"streamId"`
	Sequence           int                    `json:"sequence"`
	PreviousCommitHash *string                `json:"previousCommitHash"`
	Members            []EvidenceCommitMember `json:"members"`
	CommittedAt        string                 `json:"committedAt,omitempty"`
}

type EvidenceCommit struct {
	RecordType         string                 `json:"recordType"`
	SchemaVersion      string                 `json:"schemaVersion"`
	CommitID           string                 `json:"commitId"`
	StreamID           string                 `json:"streamId"`
	Sequence           int                    `json:"sequence"`
	PreviousCommitHash *string                `json:"previousCommitHash"`
	Members            []EvidenceCommitMember `json:"members"`
	RecordCount        int                    `json:"recordCount"`
	RecordsRoot        string                 `json:"recordsRoot"`
	Canonicalization   string                 `json:"canonicalization"`
	HashAlgorithm      string                 `json:"hashAlgorithm"`
	TreeAlgorithm      string                 `json:"treeAlgorithm"`
	CommittedAt        string                 `json:"committedAt"`
	Hash               string                 `json:"hash"`
}

type EvidenceCommitVerificationResult struct {
	OK     bool   `json:"ok"`
	Index  int    `json:"index"`
	Reason string `json:"reason,omitempty"`
}

/*
MarshalJSON keeps successful EvidenceCommit verification output aligned with
the TypeScript and Python SDKs while preserving index 0 on failed results.
*/
func (result EvidenceCommitVerificationResult) MarshalJSON() ([]byte, error) {
	if result.OK {
		return json.Marshal(struct {
			OK bool `json:"ok"`
		}{OK: true})
	}
	return json.Marshal(struct {
		OK     bool   `json:"ok"`
		Index  int    `json:"index"`
		Reason string `json:"reason,omitempty"`
	}{OK: false, Index: result.Index, Reason: result.Reason})
}

/*
CanonicalJSON returns the Veritio canonical JSON string used by hashes and
cross-language fixtures.
*/
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

/*
CreateAuditEvent normalizes host input into the language-neutral audit event
schema while enforcing required fields, action format, sorted data categories,
and deterministic metadata redaction.
*/
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

/*
CreateEvidenceEdge validates evidence graph endpoints and relation vocabulary
without adding framework-specific semantics to audit events.
*/
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

/*
HashAuditEvent hashes an audit event with the previous tenant-chain hash.
*/
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

/*
HashEvidenceEdge hashes an evidence edge with the previous edge-chain hash.
*/
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

/*
HashAuditRecord recomputes an audit record envelope hash while excluding the
stored hash field.
*/
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

/*
HashEvidenceEdgeRecord recomputes an evidence-edge record envelope hash while
excluding the stored hash field.
*/
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

/*
CreateEvidenceCommit creates a domain-separated EvidenceCommit over an ordered
manifest of already-persisted evidence records without rewriting v1 record
hashes.
*/
func CreateEvidenceCommit(input EvidenceCommitInput) (EvidenceCommit, error) {
	if strings.TrimSpace(input.CommitID) == "" {
		return EvidenceCommit{}, errors.New("commitId is required")
	}
	if strings.TrimSpace(input.StreamID) == "" {
		return EvidenceCommit{}, errors.New("streamId is required")
	}
	if input.Sequence < 1 {
		return EvidenceCommit{}, errors.New("sequence must be a positive integer")
	}
	if input.PreviousCommitHash != nil && !evidenceCommitDigestPattern.MatchString(*input.PreviousCommitHash) {
		return EvidenceCommit{}, errors.New("previousCommitHash must be null or sha256 digest")
	}

	members, err := normalizeCommitMembers(input.Members)
	if err != nil {
		return EvidenceCommit{}, err
	}
	recordsRoot, err := computeRecordsRoot(members)
	if err != nil {
		return EvidenceCommit{}, err
	}
	committedAt := input.CommittedAt
	if committedAt == "" {
		committedAt = time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	} else if parsed, err := time.Parse(time.RFC3339Nano, committedAt); err == nil {
		committedAt = parsed.UTC().Format("2006-01-02T15:04:05.000Z")
	} else {
		return EvidenceCommit{}, errors.New("committedAt must be a valid date")
	}
	commit := EvidenceCommit{
		RecordType:         "evidence.commit",
		SchemaVersion:      EvidenceCommitSchemaVersion,
		CommitID:           input.CommitID,
		StreamID:           input.StreamID,
		Sequence:           input.Sequence,
		PreviousCommitHash: input.PreviousCommitHash,
		Members:            members,
		RecordCount:        len(members),
		RecordsRoot:        recordsRoot,
		Canonicalization:   Canonicalization,
		HashAlgorithm:      HashAlgorithm,
		TreeAlgorithm:      EvidenceCommitTreeAlgorithm,
		CommittedAt:        committedAt,
	}
	hash, err := HashEvidenceCommit(commit)
	if err != nil {
		return EvidenceCommit{}, err
	}
	commit.Hash = hash
	return commit, nil
}

/*
HashEvidenceCommit hashes canonical commit fields excluding the stored hash and
uses a commit-specific domain marker.
*/
func HashEvidenceCommit(commit EvidenceCommit) (string, error) {
	payload := map[string]any{
		"domain": "veritio-commit-v1",
		"commit": map[string]any{
			"recordType":         commit.RecordType,
			"schemaVersion":      commit.SchemaVersion,
			"commitId":           commit.CommitID,
			"streamId":           commit.StreamID,
			"sequence":           commit.Sequence,
			"previousCommitHash": commit.PreviousCommitHash,
			"members":            commit.Members,
			"recordCount":        commit.RecordCount,
			"recordsRoot":        commit.RecordsRoot,
			"canonicalization":   commit.Canonicalization,
			"hashAlgorithm":      commit.HashAlgorithm,
			"treeAlgorithm":      commit.TreeAlgorithm,
			"committedAt":        commit.CommittedAt,
		},
	}
	canonical, err := CanonicalJSON(payload)
	if err != nil {
		return "", err
	}
	return prefixedCommitSHA256(canonical), nil
}

/*
VerifyEvidenceCommits verifies commit sequence and previous-hash linkage per
stream, plus member manifest, Merkle root, and commit hash integrity.
*/
func VerifyEvidenceCommits(commits []EvidenceCommit) EvidenceCommitVerificationResult {
	streamState := map[string]struct {
		PreviousHash *string
		Sequence     int
	}{}
	for index, commit := range commits {
		if commit.HashAlgorithm != HashAlgorithm {
			return EvidenceCommitVerificationResult{OK: false, Index: index, Reason: "unsupported_hash_algorithm"}
		}
		if commit.Canonicalization != Canonicalization {
			return EvidenceCommitVerificationResult{OK: false, Index: index, Reason: "unsupported_canonicalization"}
		}
		if commit.TreeAlgorithm != EvidenceCommitTreeAlgorithm {
			return EvidenceCommitVerificationResult{OK: false, Index: index, Reason: "unsupported_tree_algorithm"}
		}
		state := streamState[commit.StreamID]
		if !sameOptionalString(commit.PreviousCommitHash, state.PreviousHash) {
			return EvidenceCommitVerificationResult{OK: false, Index: index, Reason: "previous_hash_mismatch"}
		}
		if commit.Sequence != state.Sequence+1 {
			return EvidenceCommitVerificationResult{OK: false, Index: index, Reason: "sequence_mismatch"}
		}
		members, err := normalizeCommitMembers(commit.Members)
		if err != nil {
			return EvidenceCommitVerificationResult{OK: false, Index: index, Reason: "invalid_member_manifest"}
		}
		if commit.RecordCount != len(members) {
			return EvidenceCommitVerificationResult{OK: false, Index: index, Reason: "record_count_mismatch"}
		}
		recordsRoot, err := computeRecordsRoot(members)
		if err != nil {
			return EvidenceCommitVerificationResult{OK: false, Index: index, Reason: "records_root_mismatch"}
		}
		if commit.RecordsRoot != recordsRoot {
			return EvidenceCommitVerificationResult{OK: false, Index: index, Reason: "records_root_mismatch"}
		}
		hash, err := HashEvidenceCommit(commit)
		if err != nil || commit.Hash != hash {
			return EvidenceCommitVerificationResult{OK: false, Index: index, Reason: "hash_mismatch"}
		}
		hashCopy := commit.Hash
		streamState[commit.StreamID] = struct {
			PreviousHash *string
			Sequence     int
		}{PreviousHash: &hashCopy, Sequence: commit.Sequence}
	}
	return EvidenceCommitVerificationResult{OK: true}
}

/*
HashIdempotencyKey binds idempotency keys to tenant scope so identical host keys
cannot collide across tenant chains.
*/
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

/*
normalizeCommitMembers validates that commit members are ordered by contiguous
indices and identify unique physical records.
*/
func normalizeCommitMembers(members []EvidenceCommitMember) ([]EvidenceCommitMember, error) {
	if len(members) == 0 {
		return nil, errors.New("members must not be empty")
	}
	cleaned := make([]EvidenceCommitMember, len(members))
	for index, member := range members {
		cleanMember, err := cleanCommitMember(member)
		if err != nil {
			return nil, err
		}
		cleaned[index] = cleanMember
	}
	sort.Slice(cleaned, func(i int, j int) bool {
		return cleaned[i].Index < cleaned[j].Index
	})
	identities := map[string]struct{}{}
	for expectedIndex, member := range cleaned {
		if member.Index != expectedIndex {
			return nil, errors.New("member indices must be contiguous from zero")
		}
		identity := member.RecordType + "\x00" + member.RecordID
		if _, exists := identities[identity]; exists {
			return nil, errors.New("duplicate commit member")
		}
		identities[identity] = struct{}{}
	}
	return cleaned, nil
}

/*
cleanCommitMember validates one EvidenceCommit member and strips unknown fields
through struct reconstruction.
*/
func cleanCommitMember(member EvidenceCommitMember) (EvidenceCommitMember, error) {
	if member.Index < 0 {
		return EvidenceCommitMember{}, errors.New("member index must be a non-negative integer")
	}
	if _, ok := evidenceCommitMemberRecordTypes[member.RecordType]; !ok {
		return EvidenceCommitMember{}, errors.New("recordType must be a supported commit member record type")
	}
	if strings.TrimSpace(member.RecordID) == "" {
		return EvidenceCommitMember{}, errors.New("recordId is required")
	}
	if !evidenceCommitDigestPattern.MatchString(member.RecordHash) {
		return EvidenceCommitMember{}, errors.New("recordHash must be a sha256 digest")
	}
	return EvidenceCommitMember{
		Index:      member.Index,
		RecordType: member.RecordType,
		RecordID:   member.RecordID,
		RecordHash: member.RecordHash,
	}, nil
}

/*
computeRecordsRoot computes a veritio-merkle-v1 root and duplicates the final
hash at each odd level.
*/
func computeRecordsRoot(members []EvidenceCommitMember) (string, error) {
	level := make([]string, len(members))
	for index, member := range members {
		leaf, err := commitLeafHash(member)
		if err != nil {
			return "", err
		}
		level[index] = leaf
	}
	for len(level) > 1 {
		nextLevel := []string{}
		for index := 0; index < len(level); index += 2 {
			left := level[index]
			right := left
			if index+1 < len(level) {
				right = level[index+1]
			}
			canonical, err := CanonicalJSON(map[string]any{
				"domain": "veritio-merkle-node-v1",
				"left":   left,
				"right":  right,
			})
			if err != nil {
				return "", err
			}
			nextLevel = append(nextLevel, prefixedCommitSHA256(canonical))
		}
		level = nextLevel
	}
	return level[0], nil
}

/*
commitLeafHash hashes one ordered commit member with a leaf-specific domain.
*/
func commitLeafHash(member EvidenceCommitMember) (string, error) {
	canonical, err := CanonicalJSON(map[string]any{
		"domain":     "veritio-record-leaf-v1",
		"index":      member.Index,
		"recordType": member.RecordType,
		"recordId":   member.RecordID,
		"recordHash": member.RecordHash,
	})
	if err != nil {
		return "", err
	}
	return prefixedCommitSHA256(canonical), nil
}

/*
sameOptionalString compares nullable commit hashes without dereferencing nils.
*/
func sameOptionalString(left *string, right *string) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

/*
prefixedSHA256 returns an algorithm-qualified digest for EvidenceCommit fields.
*/
func prefixedCommitSHA256(value string) string {
	sum := sha256.Sum256([]byte(value))
	return "sha256:" + hex.EncodeToString(sum[:])
}

/*
cleanEvidenceEntity validates graph entities against the public evidence
vocabulary before edges are hashed or exported.
*/
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

/*
redactMetadata applies deterministic sensitive-key redaction before metadata is
included in canonical JSON or hashes.
*/
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

/*
redactAny recursively converts metadata to JSON-compatible values while
replacing sensitive-key values with the stable redaction marker.
*/
func redactAny(value any, key string) any {
	if sensitiveKeyPattern.MatchString(key) {
		if digestEnvelope, ok := sanitizeDigestEnvelope(value); ok {
			return digestEnvelope
		}
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
		if digestEnvelope, ok := sanitizeDigestEnvelope(typed); ok {
			return digestEnvelope
		}
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

/*
sanitizeDigestEnvelope preserves only minimized digest metadata even when the
governed field name contains a sensitive word such as email.
*/
func sanitizeDigestEnvelope(value any) (map[string]any, bool) {
	typed, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	digest, digestOK := typed["digest"].(string)
	if !digestOK || !digestEnvelopePattern.MatchString(digest) {
		return nil, false
	}
	if _, ok := typed["canonicalization"]; ok {
		return nil, false
	}
	if _, ok := typed["schemaRef"]; ok {
		return nil, false
	}
	if _, ok := typed["fieldSetRef"]; ok {
		return nil, false
	}
	if _, ok := typed["fields"]; ok {
		return nil, false
	}
	if typed["algorithm"] == "hmac-sha256" {
		keyVersion, ok := typed["keyVersion"].(string)
		if !ok || strings.TrimSpace(keyVersion) == "" {
			return nil, false
		}
		return map[string]any{"algorithm": "hmac-sha256", "digest": digest, "keyVersion": keyVersion}, true
	}
	if typed["algorithm"] == "sha256" {
		return map[string]any{"algorithm": "sha256", "digest": digest}, true
	}
	if captureMode, ok := typed["captureMode"].(string); ok {
		switch captureMode {
		case "content_digest", "randomized_digest", "reference", "redact", "encrypt":
			return map[string]any{"captureMode": captureMode, "digest": digest}, true
		}
	}
	return nil, false
}

/*
normalizeJSON converts Go values into the canonical JSON value domain shared
with the TypeScript and Python SDKs.
*/
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

/*
unescapeJSONLineTerminators keeps U+2028 and U+2029 aligned with JavaScript JSON
stringification for cross-language canonical JSON fixtures.
*/
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

/*
isUnescapedJSONBackslash detects whether a JSON escape sequence is active or
itself escaped.
*/
func isUnescapedJSONBackslash(value string, index int) bool {
	count := 0
	for cursor := index - 1; cursor >= 0 && value[cursor] == '\\'; cursor-- {
		count++
	}
	return count%2 == 0
}

/*
uniqueSorted returns sorted unique values for deterministic dataCategories.
*/
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

/*
randomHex creates protocol ids without adding a process-wide dependency on host
configuration.
*/
func randomHex(byteCount int) string {
	bytes := make([]byte, byteCount)
	if _, err := rand.Read(bytes); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(bytes)
}

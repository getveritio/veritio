package veritio

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"time"
)

var reservedContextKeys = []string{
	"authSessionId",
	"authContextId",
	"activityEpisodeId",
	"traceId",
	"correlationId",
	"causationEventId",
	"changeId",
	"capturePolicyId",
	"collectionSource",
}

type EvidenceRef struct {
	Authority string `json:"authority"`
	Kind      string `json:"kind"`
	Type      string `json:"type"`
	ID        string `json:"id"`
}

type CapturePolicyRef struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}

type EntityFieldPolicy struct {
	Capture string
}

type GovernedEntityDefinition struct {
	Authority     string
	Type          string
	SchemaRef     string
	FieldSetRef   string
	Identity      func(map[string]any) string
	Fields        map[string]EntityFieldPolicy
	LineagePolicy string
}

type StateCommitment struct {
	Algorithm        string         `json:"algorithm"`
	Canonicalization string         `json:"canonicalization"`
	SchemaRef        string         `json:"schemaRef"`
	FieldSetRef      string         `json:"fieldSetRef"`
	Fields           map[string]any `json:"fields"`
	Digest           string         `json:"digest"`
}

type RevisionDraft struct {
	Ref              EvidenceRef       `json:"ref"`
	Entity           EvidenceRef       `json:"entity"`
	Parents          []EvidenceRef     `json:"parents"`
	StateCommitment  StateCommitment   `json:"stateCommitment"`
	ChangedPaths     []string          `json:"changedPaths"`
	GeneratedBy      EvidenceRef       `json:"generatedBy"`
	CapturePolicyRef *CapturePolicyRef `json:"capturePolicyRef,omitempty"`
}

type GovernedChangeDraftInput struct {
	Scope                     EvidenceScope
	Entity                    GovernedEntityDefinition
	Before                    map[string]any
	After                     map[string]any
	ChangedPaths              []string
	Change                    GovernedChangeDeclaration
	Activity                  GovernedActivityDeclaration
	Producer                  EvidenceRef
	OccurredAt                string
	IdempotencyKeyHash        string
	Context                   map[string]any
	Metadata                  map[string]any
	CapturePolicyRef          *CapturePolicyRef
	ExpectedParentRevisionRef *EvidenceRef
	MutationBinding           string
	DigestKeys                DigestKeys
}

type GovernedChangeDeclaration struct {
	ID                        string
	Type                      string
	InitiatedBy               EvidenceRef
	AuthorizationAssertionRef *EvidenceRef
	DelegationAssertionRef    *EvidenceRef
}

type GovernedActivityDeclaration struct {
	ID          string
	Type        string
	PerformedBy EvidenceRef
}

type DigestKeys struct {
	KeyedDigest *KeyedDigestKey
}

type KeyedDigestKey struct {
	KeyVersion string
	Secret     string
}

type GovernedChangeOutboxEntry struct {
	SchemaVersion             string              `json:"schemaVersion"`
	MutationBinding           string              `json:"mutationBinding"`
	ExpectedParentRevisionRef *EvidenceRef        `json:"expectedParentRevisionRef,omitempty"`
	Records                   []AuditEventInput   `json:"records"`
	Edges                     []EvidenceEdgeInput `json:"edges"`
}

type GovernedChangeDraft struct {
	ChangeRef   EvidenceRef               `json:"changeRef"`
	ActivityRef EvidenceRef               `json:"activityRef"`
	EntityRef   EvidenceRef               `json:"entityRef"`
	Revision    RevisionDraft             `json:"revision"`
	Events      []AuditEventInput         `json:"events"`
	Edges       []EvidenceEdgeInput       `json:"edges"`
	OutboxEntry GovernedChangeOutboxEntry `json:"outboxEntry"`
}

/*
RefKey formats an authority-qualified evidence reference for deterministic joins.
*/
func RefKey(ref EvidenceRef) (string, error) {
	if err := assertEvidenceRef(ref); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s:%s:%s:%s", ref.Authority, ref.Kind, ref.Type, ref.ID), nil
}

/*
MergeVeritioMetadata merges caller metadata with SDK-owned context keys while
rejecting caller attempts to shadow reserved provenance identifiers.
*/
func MergeVeritioMetadata(callerMetadata map[string]any, context map[string]any) (map[string]any, error) {
	for _, key := range reservedContextKeys {
		if _, ok := callerMetadata[key]; ok {
			return nil, fmt.Errorf("metadata.%s is reserved by Veritio", key)
		}
	}
	merged := map[string]any{}
	callerKeys := make([]string, 0, len(callerMetadata))
	for key := range callerMetadata {
		callerKeys = append(callerKeys, key)
	}
	sort.Strings(callerKeys)
	for _, key := range callerKeys {
		if callerMetadata[key] != nil {
			merged[key] = callerMetadata[key]
		}
	}
	for _, key := range reservedContextKeys {
		if context != nil && context[key] != nil {
			merged[key] = context[key]
		}
	}
	return merged, nil
}

/*
DefineEntity validates a governed entity declaration that later draft builders use
to derive authority-qualified references and minimized revision commitments.
*/
func DefineEntity(definition GovernedEntityDefinition) (GovernedEntityDefinition, error) {
	if definition.Authority == "" {
		return GovernedEntityDefinition{}, errors.New("authority is required")
	}
	if definition.Type == "" {
		return GovernedEntityDefinition{}, errors.New("type is required")
	}
	if definition.SchemaRef == "" {
		return GovernedEntityDefinition{}, errors.New("schemaRef is required")
	}
	if definition.FieldSetRef == "" {
		return GovernedEntityDefinition{}, errors.New("fieldSetRef is required")
	}
	if definition.Identity == nil {
		return GovernedEntityDefinition{}, errors.New("identity is required")
	}
	return definition, nil
}

/*
CreateGovernedChangeDraft creates v1-compatible audit event and edge inputs for a
governed change without claiming EvidenceCommit atomicity.
*/
func CreateGovernedChangeDraft(input GovernedChangeDraftInput) (GovernedChangeDraft, error) {
	if input.Scope.TenantID == "" {
		return GovernedChangeDraft{}, errors.New("scope.tenantId is required")
	}
	if err := assertEvidenceRef(input.Change.InitiatedBy); err != nil {
		return GovernedChangeDraft{}, err
	}
	if err := assertEvidenceRef(input.Activity.PerformedBy); err != nil {
		return GovernedChangeDraft{}, err
	}
	if err := assertEvidenceRef(input.Producer); err != nil {
		return GovernedChangeDraft{}, err
	}

	if input.OccurredAt == "" {
		return GovernedChangeDraft{}, errors.New("occurredAt is required")
	}
	parsedOccurredAt, err := time.Parse(time.RFC3339Nano, input.OccurredAt)
	if err != nil {
		// A timezone-naive timestamp is interpreted as UTC (never rejected and
		// never host-local) so the hashed occurredAt byte is deterministic and
		// identical to the TypeScript and Python SDKs for the same input.
		parsedOccurredAt, err = time.Parse("2006-01-02T15:04:05.999999999", input.OccurredAt)
		if err != nil {
			return GovernedChangeDraft{}, errors.New("occurredAt must be a valid date")
		}
	}
	occurredAt := parsedOccurredAt.UTC().Format("2006-01-02T15:04:05.000Z")
	entityRef, err := entityRefFromRow(input.Entity, input.After)
	if err != nil {
		return GovernedChangeDraft{}, err
	}
	changeRef := EvidenceRef{Authority: "veritio", Kind: "change", Type: input.Change.Type, ID: input.Change.ID}
	activityRef := EvidenceRef{Authority: "veritio", Kind: "activity", Type: input.Activity.Type, ID: input.Activity.ID}
	previousRevisionRef := EvidenceRef{
		Authority: "veritio",
		Kind:      "revision",
		Type:      input.Entity.Type,
		ID:        fmt.Sprintf("rev_%s_%s_previous", input.Entity.Type, entityRef.ID),
	}
	if input.ExpectedParentRevisionRef != nil {
		if err := assertEvidenceRef(*input.ExpectedParentRevisionRef); err != nil {
			return GovernedChangeDraft{}, err
		}
		previousRevisionRef = *input.ExpectedParentRevisionRef
	}
	stateCommitment, err := createStateCommitment(input.Entity, input.After, input.DigestKeys)
	if err != nil {
		return GovernedChangeDraft{}, err
	}
	revisionRef := EvidenceRef{
		Authority: "veritio",
		Kind:      "revision",
		Type:      input.Entity.Type,
		ID:        fmt.Sprintf("rev_%s_%s_%s", input.Entity.Type, entityRef.ID, stateCommitment.Digest[len("sha256:"):len("sha256:")+12]),
	}
	changedPaths := append([]string{}, input.ChangedPaths...)
	sort.Strings(changedPaths)
	revision := RevisionDraft{
		Ref:             revisionRef,
		Entity:          entityRef,
		Parents:         []EvidenceRef{},
		StateCommitment: stateCommitment,
		ChangedPaths:    changedPaths,
		GeneratedBy:     activityRef,
	}
	if input.Before != nil {
		revision.Parents = []EvidenceRef{previousRevisionRef}
	}
	if input.CapturePolicyRef != nil {
		revision.CapturePolicyRef = input.CapturePolicyRef
	}

	metadata, err := MergeVeritioMetadata(input.Metadata, input.Context)
	if err != nil {
		return GovernedChangeDraft{}, err
	}
	mutationBinding := input.MutationBinding
	if mutationBinding == "" {
		mutationBinding = "not_transaction_bound"
	}
	captureAssurance := map[string]any{"captureMethod": "transactional_outbox", "mutationBinding": mutationBinding}
	common := func() AuditEventInput {
		return AuditEventInput{
			OccurredAt:     occurredAt,
			Scope:          &input.Scope,
			Purpose:        "change_provenance",
			DataCategories: []string{"source_reference"},
			Retention:      "change_1y",
		}
	}

	changeMetadata := cloneMap(metadata)
	changeMetadata["recordType"] = "change.declared"
	changeMetadata["recordAuthority"] = changeRef.Authority
	changeMetadata["producer"] = evidenceRefMetadata(input.Producer)
	changeMetadata["initiatedBy"] = evidenceRefMetadata(input.Change.InitiatedBy)
	changeMetadata["changeType"] = input.Change.Type
	changeMetadata["idempotencyKeyHash"] = input.IdempotencyKeyHash
	changeMetadata["capturePolicyRef"] = capturePolicyRefMetadata(input.CapturePolicyRef)
	changeMetadata["authorizationAssertionRef"] = optionalEvidenceRefMetadata(input.Change.AuthorizationAssertionRef)
	changeMetadata["delegationAssertionRef"] = optionalEvidenceRefMetadata(input.Change.DelegationAssertionRef)
	changeMetadata["captureAssurance"] = captureAssurance

	activityMetadata := cloneMap(metadata)
	activityMetadata["recordType"] = "activity.recorded"
	activityMetadata["recordAuthority"] = activityRef.Authority
	activityMetadata["producer"] = evidenceRefMetadata(input.Producer)
	activityMetadata["performedBy"] = evidenceRefMetadata(input.Activity.PerformedBy)
	activityMetadata["activityType"] = input.Activity.Type
	activityMetadata["idempotencyKeyHash"] = input.IdempotencyKeyHash
	activityMetadata["captureAssurance"] = captureAssurance

	revisionMetadata := cloneMap(metadata)
	revisionMetadata["recordType"] = "entity.revision"
	revisionMetadata["recordAuthority"] = revisionRef.Authority
	revisionMetadata["producer"] = evidenceRefMetadata(input.Producer)
	revisionMetadata["idempotencyKeyHash"] = input.IdempotencyKeyHash
	revisionMetadata["veritio"] = map[string]any{"revision": revisionMetadataMap(revision)}
	revisionMetadata["captureAssurance"] = captureAssurance

	changeEvent := common()
	changeEvent.ID = "evt_change_declared_" + input.Change.ID
	changeActor, err := principalFromEvidenceRef(input.Change.InitiatedBy)
	if err != nil {
		return GovernedChangeDraft{}, err
	}
	changeEvent.Actor = changeActor
	changeEvent.Action = "change.declared"
	changeEvent.Target = Resource{Type: "change", ID: input.Change.ID}
	changeEvent.Metadata = compactMap(changeMetadata)

	activityEvent := common()
	activityEvent.ID = "evt_activity_recorded_" + input.Activity.ID
	activityActor, err := principalFromEvidenceRef(input.Activity.PerformedBy)
	if err != nil {
		return GovernedChangeDraft{}, err
	}
	activityEvent.Actor = activityActor
	activityEvent.Action = "activity.recorded"
	activityEvent.Target = Resource{Type: "activity", ID: input.Activity.ID}
	activityEvent.Metadata = compactMap(activityMetadata)

	revisionEvent := common()
	revisionEvent.ID = "evt_entity_revision_" + revisionRef.ID
	revisionActor, err := principalFromEvidenceRef(input.Producer)
	if err != nil {
		return GovernedChangeDraft{}, err
	}
	revisionEvent.Actor = revisionActor
	revisionEvent.Action = "entity.revision.created"
	revisionEvent.Target = Resource{Type: input.Entity.Type, ID: entityRef.ID}
	revisionEvent.Metadata = compactMap(revisionMetadata)

	edges := []EvidenceEdgeInput{
		draftEdge("has_activity", changeRef, activityRef, occurredAt, input.Scope),
		draftEdge("has_output", changeRef, revisionRef, occurredAt, input.Scope),
		draftEdge("performed_by", activityRef, input.Activity.PerformedBy, occurredAt, input.Scope),
		draftEdge("generated", activityRef, revisionRef, occurredAt, input.Scope),
	}
	if input.Before != nil {
		edges = append(edges, draftEdge("derived_from", revisionRef, previousRevisionRef, occurredAt, input.Scope))
	}
	events := []AuditEventInput{changeEvent, activityEvent, revisionEvent}
	var expectedParentRevisionRef *EvidenceRef
	if input.Before != nil {
		expectedParentRevisionRef = &previousRevisionRef
	}
	return GovernedChangeDraft{
		ChangeRef:   changeRef,
		ActivityRef: activityRef,
		EntityRef:   entityRef,
		Revision:    revision,
		Events:      events,
		Edges:       edges,
		OutboxEntry: GovernedChangeOutboxEntry{
			SchemaVersion:             "2026-06-23",
			MutationBinding:           mutationBinding,
			ExpectedParentRevisionRef: expectedParentRevisionRef,
			Records:                   events,
			Edges:                     edges,
		},
	}, nil
}

/*
createStateCommitment applies the entity capture policy before evidence leaves
the host mutation boundary.
*/
func createStateCommitment(entity GovernedEntityDefinition, row map[string]any, digestKeys DigestKeys) (StateCommitment, error) {
	fields := map[string]any{}
	keys := make([]string, 0, len(entity.Fields))
	for key := range entity.Fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		policy := entity.Fields[key]
		value, ok := row[key]
		if !ok || policy.Capture == "omit" {
			continue
		}
		if policy.Capture == "full" {
			normalized, err := normalizeJSON(value)
			if err != nil {
				return StateCommitment{}, err
			}
			fields[key] = normalized
		} else if policy.Capture == "keyed_digest" {
			if digestKeys.KeyedDigest == nil {
				return StateCommitment{}, errors.New("digestKeys.keyedDigest is required for keyed_digest fields")
			}
			if digestKeys.KeyedDigest.KeyVersion == "" {
				return StateCommitment{}, errors.New("digestKeys.keyedDigest.keyVersion is required")
			}
			if digestKeys.KeyedDigest.Secret == "" {
				return StateCommitment{}, errors.New("digestKeys.keyedDigest.secret is required")
			}
			canonical, err := CanonicalJSON(value)
			if err != nil {
				return StateCommitment{}, err
			}
			fields[key] = map[string]any{
				"algorithm":  "hmac-sha256",
				"keyVersion": digestKeys.KeyedDigest.KeyVersion,
				"digest":     prefixedHmacSHA256(canonical, digestKeys.KeyedDigest.Secret),
			}
		} else if policy.Capture == "content_digest" {
			canonical, err := CanonicalJSON(value)
			if err != nil {
				return StateCommitment{}, err
			}
			fields[key] = map[string]any{"captureMode": policy.Capture, "digest": prefixedSHA256(canonical)}
		} else {
			return StateCommitment{}, fmt.Errorf("capture mode %s is not supported by the current governed-change draft helper", policy.Capture)
		}
	}
	canonical, err := CanonicalJSON(fields)
	if err != nil {
		return StateCommitment{}, err
	}
	return StateCommitment{
		Algorithm:        "sha256",
		Canonicalization: Canonicalization,
		SchemaRef:        entity.SchemaRef,
		FieldSetRef:      entity.FieldSetRef,
		Fields:           fields,
		Digest:           prefixedSHA256(canonical),
	}, nil
}

/*
draftEdge creates an evidence graph edge input and preserves full refs in
metadata for v1 compatibility.
*/
func draftEdge(relation string, from EvidenceRef, to EvidenceRef, occurredAt string, scope EvidenceScope) EvidenceEdgeInput {
	fromKey, _ := RefKey(from)
	toKey, _ := RefKey(to)
	return EvidenceEdgeInput{
		ID:         fmt.Sprintf("edge_%s_%s_%s", relation, stableID(fromKey), stableID(toKey)),
		OccurredAt: occurredAt,
		Scope:      &scope,
		From:       entityFromEvidenceRef(from),
		Relation:   relation,
		To:         entityFromEvidenceRef(to),
		Metadata:   map[string]any{"fromRef": evidenceRefMetadata(from), "toRef": evidenceRefMetadata(to)},
	}
}

/*
entityRefFromRow resolves a host row into an authority-qualified entity ref.
*/
func entityRefFromRow(entity GovernedEntityDefinition, row map[string]any) (EvidenceRef, error) {
	id := entity.Identity(row)
	if id == "" {
		return EvidenceRef{}, errors.New("entity.id is required")
	}
	return EvidenceRef{Authority: entity.Authority, Kind: "entity", Type: entity.Type, ID: id}, nil
}

/*
entityFromEvidenceRef maps EvidenceRef into the current EvidenceEdge endpoint
shape while keeping the semantic type as ResourceType.
*/
func entityFromEvidenceRef(ref EvidenceRef) EvidenceEntity {
	entityType := ref.Kind
	if ref.Kind == "commit" {
		entityType = "evidence_commit"
	}
	entity := EvidenceEntity{Type: entityType, ID: ref.ID, ResourceType: ref.Type}
	if ref.Kind == "principal" && (ref.Type == "user" || ref.Type == "service" || ref.Type == "system" || ref.Type == "ai_agent") {
		entity.ActorType = ref.Type
	}
	return entity
}

/*
principalFromEvidenceRef converts a principal ref into the legacy audit actor
shape.
*/
func principalFromEvidenceRef(ref EvidenceRef) (Principal, error) {
	if ref.Kind != "principal" {
		return Principal{}, errors.New("principal ref is required")
	}
	return Principal{Type: ref.Type, ID: ref.Authority + ":" + ref.ID}, nil
}

/*
assertEvidenceRef validates authority-qualified references before hashing.
*/
func assertEvidenceRef(ref EvidenceRef) error {
	if ref.Authority == "" {
		return errors.New("ref.authority is required")
	}
	if ref.Kind == "" {
		return errors.New("ref.kind is required")
	}
	if ref.Type == "" {
		return errors.New("ref.type is required")
	}
	if ref.ID == "" {
		return errors.New("ref.id is required")
	}
	return nil
}

/*
evidenceRefMetadata converts typed refs into explicit JSON-domain maps before
metadata redaction, avoiding reflection fallback changes in Go hash inputs.
*/
func evidenceRefMetadata(ref EvidenceRef) map[string]any {
	return map[string]any{
		"authority": ref.Authority,
		"kind":      ref.Kind,
		"type":      ref.Type,
		"id":        ref.ID,
	}
}

/*
optionalEvidenceRefMetadata keeps absent assertion refs out of metadata while
using the same JSON-domain shape for present refs.
*/
func optionalEvidenceRefMetadata(ref *EvidenceRef) any {
	if ref == nil {
		return nil
	}
	return evidenceRefMetadata(*ref)
}

/*
capturePolicyRefMetadata converts optional capture policy refs without leaking
Go struct field names into outbox metadata.
*/
func capturePolicyRefMetadata(ref *CapturePolicyRef) any {
	if ref == nil {
		return nil
	}
	return map[string]any{"id": ref.ID, "version": ref.Version}
}

/*
revisionMetadataMap emits revision provenance as lower-camel JSON maps, matching
TypeScript and Python outboxes before audit-event redaction and hashing.
*/
func revisionMetadataMap(revision RevisionDraft) map[string]any {
	result := map[string]any{
		"ref":             evidenceRefMetadata(revision.Ref),
		"entity":          evidenceRefMetadata(revision.Entity),
		"parents":         evidenceRefListMetadata(revision.Parents),
		"stateCommitment": stateCommitmentMetadata(revision.StateCommitment),
		"changedPaths":    revision.ChangedPaths,
		"generatedBy":     evidenceRefMetadata(revision.GeneratedBy),
	}
	if revision.CapturePolicyRef != nil {
		result["capturePolicyRef"] = capturePolicyRefMetadata(revision.CapturePolicyRef)
	}
	return result
}

/*
evidenceRefListMetadata preserves ordered parent revision refs in JSON-domain
maps so revision lineage remains stable across SDKs.
*/
func evidenceRefListMetadata(refs []EvidenceRef) []any {
	out := make([]any, len(refs))
	for index, ref := range refs {
		out[index] = evidenceRefMetadata(ref)
	}
	return out
}

/*
stateCommitmentMetadata exposes only protocol field names from the typed
commitment before callers store or marshal governed-change outbox entries.
*/
func stateCommitmentMetadata(commitment StateCommitment) map[string]any {
	return map[string]any{
		"algorithm":        commitment.Algorithm,
		"canonicalization": commitment.Canonicalization,
		"schemaRef":        commitment.SchemaRef,
		"fieldSetRef":      commitment.FieldSetRef,
		"fields":           commitment.Fields,
		"digest":           commitment.Digest,
	}
}

/*
compactMap drops nil optional fields before event normalization.
*/
func compactMap(value map[string]any) map[string]any {
	result := map[string]any{}
	for key, item := range value {
		if item != nil {
			result[key] = item
		}
	}
	return result
}

/*
cloneMap copies caller metadata so draft construction never mutates input maps.
*/
func cloneMap(value map[string]any) map[string]any {
	result := map[string]any{}
	for key, item := range value {
		result[key] = item
	}
	return result
}

/*
stableID produces a short deterministic token for generated draft edge IDs.
*/
func stableID(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])[:16]
}

/*
prefixedSHA256 computes protocol digest strings for revision commitments.
*/
func prefixedSHA256(value string) string {
	sum := sha256.Sum256([]byte(value))
	return "sha256:" + hex.EncodeToString(sum[:])
}

/*
prefixedHmacSHA256 computes keyed digests without storing raw key or raw value.
*/
func prefixedHmacSHA256(value string, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(value))
	return "sha256:" + hex.EncodeToString(mac.Sum(nil))
}

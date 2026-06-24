import { createHash, createHmac } from "node:crypto";
import type {
  AuditEventInput,
  EvidenceEdgeInput,
  EvidenceEntity,
  EvidenceScope,
  JsonObject,
  JsonValue,
  Principal,
} from "./index";
import { canonicalJson } from "./index";

export type EvidenceRefKind = "principal" | "entity" | "activity" | "change" | "revision" | "assertion" | "record" | "commit";

export interface EvidenceRef {
  authority: string;
  kind: EvidenceRefKind;
  type: string;
  id: string;
}

export interface CapturePolicyRef {
  id: string;
  version: string;
}

export type CaptureMode =
  | "omit"
  | "content_digest"
  | "keyed_digest"
  | "randomized_digest"
  | "reference"
  | "redact"
  | "encrypt"
  | "full";

export interface EntityFieldPolicy {
  capture: CaptureMode;
}

export interface GovernedEntityDefinition<Row extends Record<string, unknown>> {
  authority: string;
  type: string;
  schemaRef: string;
  fieldSetRef: string;
  identity(row: Row): string;
  fields: Partial<Record<keyof Row & string, EntityFieldPolicy>>;
  lineagePolicy?: "linear" | "dag";
}

export interface GovernedEntity<Row extends Record<string, unknown>> extends GovernedEntityDefinition<Row> {
  ref(rowOrId: Row | string): EvidenceRef;
}

export interface VeritioContextMetadata {
  authSessionId?: string;
  authContextId?: string;
  activityEpisodeId?: string;
  traceId?: string;
  correlationId?: string;
  causationEventId?: string;
  changeId?: string;
  capturePolicyId?: string;
  collectionSource?: string;
}

export interface StateCommitment {
  algorithm: "sha256";
  canonicalization: "veritio-json-v1";
  schemaRef: string;
  fieldSetRef: string;
  fields: JsonObject;
  digest: string;
}

export interface RevisionDraft {
  ref: EvidenceRef;
  entity: EvidenceRef;
  parents: EvidenceRef[];
  stateCommitment: StateCommitment;
  changedPaths: string[];
  generatedBy: EvidenceRef;
  capturePolicyRef?: CapturePolicyRef;
}

export interface GovernedChangeDraftInput<Row extends Record<string, unknown>> {
  scope: EvidenceScope & { tenantId: string };
  entity: GovernedEntity<Row>;
  before?: Row;
  after: Row;
  changedPaths: string[];
  change: {
    id: string;
    type: string;
    initiatedBy: EvidenceRef;
    authorizationAssertionRef?: EvidenceRef;
    delegationAssertionRef?: EvidenceRef;
  };
  activity: {
    id: string;
    type: string;
    performedBy: EvidenceRef;
  };
  producer: EvidenceRef;
  occurredAt: string | Date;
  idempotencyKeyHash: string;
  context?: VeritioContextMetadata;
  metadata?: Record<string, unknown>;
  capturePolicyRef?: CapturePolicyRef;
  expectedParentRevisionRef?: EvidenceRef;
  mutationBinding?: "same_transaction" | "not_transaction_bound" | "best_effort";
  digestKeys?: {
    keyedDigest?: {
      keyVersion: string;
      secret: string;
    };
  };
}

export interface GovernedChangeDraft {
  changeRef: EvidenceRef;
  activityRef: EvidenceRef;
  entityRef: EvidenceRef;
  revision: RevisionDraft;
  events: AuditEventInput[];
  edges: EvidenceEdgeInput[];
  outboxEntry: {
    schemaVersion: "2026-06-23";
    mutationBinding: "same_transaction" | "not_transaction_bound" | "best_effort";
    expectedParentRevisionRef?: EvidenceRef;
    records: AuditEventInput[];
    edges: EvidenceEdgeInput[];
  };
}

const RESERVED_CONTEXT_KEYS = [
  "authSessionId",
  "authContextId",
  "activityEpisodeId",
  "traceId",
  "correlationId",
  "causationEventId",
  "changeId",
  "capturePolicyId",
  "collectionSource",
] as const;

/**
 * Formats an authority-qualified evidence reference for deterministic maps,
 * route keys, and logs without dropping the authority that makes the ID safe to
 * join across systems.
 */
export function refKey(ref: EvidenceRef): string {
  assertRef(ref);
  return `${ref.authority}:${ref.kind}:${ref.type}:${ref.id}`;
}

/**
 * Registers a governed entity type at the host boundary. The SDK stores only the
 * declaration needed to derive references and minimized revision commitments; it
 * does not read application databases or environment state.
 */
export function defineEntity<Row extends Record<string, unknown>>(
  definition: GovernedEntityDefinition<Row>,
): GovernedEntity<Row> {
  assertNonEmpty(definition.authority, "authority");
  assertNonEmpty(definition.type, "type");
  assertNonEmpty(definition.schemaRef, "schemaRef");
  assertNonEmpty(definition.fieldSetRef, "fieldSetRef");

  return {
    ...definition,
    /**
     * Builds the stable authority-qualified entity ref for a row or already
     * resolved host ID.
     */
    ref(rowOrId) {
      const id = typeof rowOrId === "string" ? rowOrId : definition.identity(rowOrId);
      assertNonEmpty(id, "entity.id");
      return {
        authority: definition.authority,
        kind: "entity",
        type: definition.type,
        id,
      };
    },
  };
}

/**
 * Merges caller metadata with SDK-owned context keys. Reserved context keys are
 * applied after caller metadata and callers cannot shadow them, preserving the
 * grouping semantics used by Change, Trace, and Explain projections.
 */
export function mergeVeritioMetadata(
  callerMetadata: Record<string, unknown> = {},
  context: VeritioContextMetadata = {},
): Record<string, unknown> {
  for (const key of RESERVED_CONTEXT_KEYS) {
    if (Object.hasOwn(callerMetadata, key)) {
      throw new TypeError(`metadata.${key} is reserved by Veritio`);
    }
  }

  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(callerMetadata).sort()) {
    if (value !== undefined && value !== null) {
      merged[key] = value;
    }
  }
  for (const key of RESERVED_CONTEXT_KEYS) {
    const value = context[key];
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Creates a current-protocol governed-change draft. The draft uses normal audit
 * events plus evidence edges so v1 stores can append it without claiming
 * EvidenceCommit atomicity before that protocol exists.
 */
export function createGovernedChangeDraft<Row extends Record<string, unknown>>(
  input: GovernedChangeDraftInput<Row>,
): GovernedChangeDraft {
  assertNonEmpty(input.scope.tenantId, "scope.tenantId");
  assertRef(input.change.initiatedBy);
  assertRef(input.activity.performedBy);
  assertRef(input.producer);

  const occurredAt = normalizeDate(input.occurredAt);
  const entityRef = input.entity.ref(input.after);
  const changeRef: EvidenceRef = {
    authority: "veritio",
    kind: "change",
    type: input.change.type,
    id: input.change.id,
  };
  const activityRef: EvidenceRef = {
    authority: "veritio",
    kind: "activity",
    type: input.activity.type,
    id: input.activity.id,
  };
  if (input.expectedParentRevisionRef) {
    assertRef(input.expectedParentRevisionRef);
  }
  const previousRevisionRef: EvidenceRef =
    input.expectedParentRevisionRef ?? {
      authority: "veritio",
      kind: "revision",
      type: input.entity.type,
      id: `rev_${input.entity.type}_${entityRef.id}_previous`,
    };
  const stateCommitment = createStateCommitment(input.entity, input.after, input.digestKeys);
  const revisionRef: EvidenceRef = {
    authority: "veritio",
    kind: "revision",
    type: input.entity.type,
    id: `rev_${input.entity.type}_${entityRef.id}_${stateCommitment.digest.slice("sha256:".length, "sha256:".length + 12)}`,
  };
  const revision: RevisionDraft = {
    ref: revisionRef,
    entity: entityRef,
    parents: input.before ? [previousRevisionRef] : [],
    stateCommitment,
    changedPaths: [...input.changedPaths].sort(),
    generatedBy: activityRef,
  };
  if (input.capturePolicyRef) {
    revision.capturePolicyRef = input.capturePolicyRef;
  }

  const metadata = mergeVeritioMetadata(input.metadata, input.context);
  const captureAssurance = {
    captureMethod: "transactional_outbox",
    mutationBinding: input.mutationBinding ?? "not_transaction_bound",
  };
  const common = {
    scope: input.scope,
    occurredAt,
    purpose: "change_provenance",
    dataCategories: ["source_reference"],
    retention: "change_1y",
  };
  const events: AuditEventInput[] = [
    {
      ...common,
      id: `evt_change_declared_${input.change.id}`,
      actor: principalFromRef(input.change.initiatedBy),
      action: "change.declared",
      target: { type: "change", id: input.change.id },
      metadata: compactMetadata({
        ...metadata,
        recordType: "change.declared",
        recordAuthority: changeRef.authority,
        producer: input.producer,
        initiatedBy: input.change.initiatedBy,
        changeType: input.change.type,
        idempotencyKeyHash: input.idempotencyKeyHash,
        capturePolicyRef: input.capturePolicyRef,
        authorizationAssertionRef: input.change.authorizationAssertionRef,
        delegationAssertionRef: input.change.delegationAssertionRef,
        captureAssurance,
      }),
    },
    {
      ...common,
      id: `evt_activity_recorded_${input.activity.id}`,
      actor: principalFromRef(input.activity.performedBy),
      action: "activity.recorded",
      target: { type: "activity", id: input.activity.id },
      metadata: compactMetadata({
        ...metadata,
        recordType: "activity.recorded",
        recordAuthority: activityRef.authority,
        producer: input.producer,
        performedBy: input.activity.performedBy,
        activityType: input.activity.type,
        idempotencyKeyHash: input.idempotencyKeyHash,
        captureAssurance,
      }),
    },
    {
      ...common,
      id: `evt_entity_revision_${revisionRef.id}`,
      actor: principalFromRef(input.producer),
      action: "entity.revision.created",
      target: { type: input.entity.type, id: entityRef.id },
      metadata: compactMetadata({
        ...metadata,
        recordType: "entity.revision",
        recordAuthority: revisionRef.authority,
        producer: input.producer,
        idempotencyKeyHash: input.idempotencyKeyHash,
        veritio: { revision },
        captureAssurance,
      }),
    },
  ];

  const edges: EvidenceEdgeInput[] = [
    draftEdge("has_activity", changeRef, activityRef, occurredAt, input.scope),
    draftEdge("has_output", changeRef, revisionRef, occurredAt, input.scope),
    draftEdge("performed_by", activityRef, input.activity.performedBy, occurredAt, input.scope),
    draftEdge("generated", activityRef, revisionRef, occurredAt, input.scope),
  ];
  if (input.before) {
    edges.push(draftEdge("derived_from", revisionRef, previousRevisionRef, occurredAt, input.scope));
  }

  const outboxEntry: GovernedChangeDraft["outboxEntry"] = {
    schemaVersion: "2026-06-23",
    mutationBinding: input.mutationBinding ?? "not_transaction_bound",
    records: events,
    edges,
  };
  if (input.before) {
    outboxEntry.expectedParentRevisionRef = previousRevisionRef;
  }

  return {
    changeRef,
    activityRef,
    entityRef,
    revision,
    events,
    edges,
    outboxEntry,
  };
}

/**
 * Builds the revision state commitment after applying the entity field policy.
 * Default handling intentionally stores no undeclared fields so the outbox cannot
 * become a raw copy of application rows.
 */
function createStateCommitment<Row extends Record<string, unknown>>(
  entity: GovernedEntity<Row>,
  row: Row,
  digestKeys: GovernedChangeDraftInput<Row>["digestKeys"] = {},
): StateCommitment {
  const fields: JsonObject = {};
  for (const key of Object.keys(entity.fields).sort()) {
    const policy = entity.fields[key];
    if (!policy || policy.capture === "omit") {
      continue;
    }
    const value = row[key];
    if (value === undefined) {
      continue;
    }
    if (policy.capture === "full") {
      fields[key] = toJsonValue(value);
    } else if (policy.capture === "keyed_digest") {
      const keyedDigest = digestKeys.keyedDigest;
      if (!keyedDigest) {
        throw new TypeError("digestKeys.keyedDigest is required for keyed_digest fields");
      }
      assertNonEmpty(keyedDigest.keyVersion, "digestKeys.keyedDigest.keyVersion");
      assertNonEmpty(keyedDigest.secret, "digestKeys.keyedDigest.secret");
      fields[key] = {
        algorithm: "hmac-sha256",
        keyVersion: keyedDigest.keyVersion,
        digest: prefixedHmacSha256(canonicalJson(toJsonValue(value)), keyedDigest.secret),
      };
    } else if (policy.capture === "content_digest") {
      fields[key] = {
        captureMode: policy.capture,
        digest: prefixedSha256(canonicalJson(toJsonValue(value))),
      };
    } else {
      throw new TypeError(`capture mode ${policy.capture} is not supported by the current governed-change draft helper`);
    }
  }

  return {
    algorithm: "sha256",
    canonicalization: "veritio-json-v1",
    schemaRef: entity.schemaRef,
    fieldSetRef: entity.fieldSetRef,
    fields,
    digest: prefixedSha256(canonicalJson(fields)),
  };
}

/**
 * Creates an edge input and carries the full structured refs in metadata so v1
 * graph records preserve authority even though endpoints use EvidenceEntity.
 */
function draftEdge(
  relation: EvidenceEdgeInput["relation"],
  from: EvidenceRef,
  to: EvidenceRef,
  occurredAt: string,
  scope: EvidenceScope,
): EvidenceEdgeInput {
  return {
    id: `edge_${relation}_${stableId(refKey(from))}_${stableId(refKey(to))}`,
    occurredAt,
    scope,
    from: entityFromRef(from),
    relation,
    to: entityFromRef(to),
    metadata: { fromRef: from, toRef: to },
  };
}

/**
 * Maps EvidenceRef into the current EvidenceEdge endpoint shape while preserving
 * the semantic type as resourceType for UI projections.
 */
function entityFromRef(ref: EvidenceRef): EvidenceEntity {
  assertRef(ref);
  const type = ref.kind === "commit" ? "evidence_commit" : ref.kind;
  const entity: EvidenceEntity = { type: type as EvidenceEntity["type"], id: ref.id, resourceType: ref.type };
  if (ref.kind === "principal" && isGraphActorType(ref.type)) {
    entity.actorType = ref.type;
  }
  return entity;
}

/**
 * Graph actor endpoints intentionally exclude anonymous actors because exported
 * principal refs must remain authority-qualified.
 */
function isGraphActorType(value: string): value is NonNullable<EvidenceEntity["actorType"]> {
  return value === "user" || value === "service" || value === "system" || value === "ai_agent";
}

/**
 * Converts an authority-qualified principal ref into the legacy audit actor
 * shape used by current AuditEvent payloads.
 */
function principalFromRef(ref: EvidenceRef): Principal {
  if (ref.kind !== "principal") {
    throw new TypeError("principal ref is required");
  }
  return { type: ref.type as Principal["type"], id: `${ref.authority}:${ref.id}` };
}

/**
 * Drops undefined metadata fields before audit-event redaction and hashing.
 */
function compactMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && item !== null) {
      out[key] = item;
    }
  }
  return out;
}

/**
 * Converts host row values into the JSON value domain accepted by canonicalJson.
 */
function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("field values must be finite JSON numbers");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object" && value !== undefined) {
    const out: JsonObject = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const nested = (value as Record<string, unknown>)[key];
      if (nested !== undefined) {
        out[key] = toJsonValue(nested);
      }
    }
    return out;
  }
  throw new TypeError(`unsupported field value type: ${typeof value}`);
}

/**
 * Normalizes dates to the millisecond ISO representation used by audit events.
 */
function normalizeDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("occurredAt must be a valid date");
  }
  return date.toISOString();
}

/**
 * Produces a short deterministic token for generated local draft IDs.
 */
function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Computes the public digest string used in revision commitments.
 */
function prefixedSha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/**
 * Computes tenant-keyed digests without persisting the raw key or raw value in
 * evidence. Hosts inject key material at the capture boundary.
 */
function prefixedHmacSha256(value: string, secret: string): string {
  return `sha256:${createHmac("sha256", secret).update(value).digest("hex")}`;
}

/**
 * Validates full structured references before they cross SDK boundaries.
 */
function assertRef(ref: EvidenceRef): void {
  assertNonEmpty(ref.authority, "ref.authority");
  assertNonEmpty(ref.kind, "ref.kind");
  assertNonEmpty(ref.type, "ref.type");
  assertNonEmpty(ref.id, "ref.id");
}

/**
 * Requires non-empty strings for public helper inputs.
 */
function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
}

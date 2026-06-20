import { createHash, randomUUID } from "node:crypto";

export const SCHEMA_VERSION = "2026-06-10";
export const EDGE_SCHEMA_VERSION = "2026-06-13";
export const HASH_ALGORITHM = "sha256";
const ACTION_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

export const EVIDENCE_ENTITY_TYPES = [
  "tenant",
  "actor",
  "data_subject",
  "resource",
  "data_category",
  "purpose",
  "policy",
  "consent",
  "processor",
  "system",
  "repository",
  "branch",
  "commit",
  "pull_request",
  "file",
  "diff_hunk",
  "agent_session",
  "tool_call",
  "ci_run",
  "artifact",
  "deployment",
  "runtime_event",
  "subject_request",
  "export_bundle",
] as const;

export const EVIDENCE_EDGE_RELATIONS = [
  "caused_by",
  "part_of",
  "read",
  "modified",
  "created",
  "deleted",
  "derived_from",
  "reviewed_by",
  "approved_by",
  "waived_by",
  "built_by",
  "deployed_as",
  "observed_in",
  "attests_to",
  "exports",
  "satisfies_policy",
  "violates_policy",
  "subject_of",
  "processed_for",
  "retained_under",
  "sent_to",
] as const;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ActorType = "user" | "system" | "service" | "ai_agent" | "anonymous";

export interface Principal {
  type: ActorType;
  id: string;
  display?: string;
}

export interface Resource {
  type: string;
  id: string;
  display?: string;
}

export interface EvidenceScope {
  tenantId?: string;
  workspaceId?: string;
  environment?: string;
}

export type EvidenceEntityType = (typeof EVIDENCE_ENTITY_TYPES)[number];
export type EvidenceEdgeRelation = (typeof EVIDENCE_EDGE_RELATIONS)[number];

export interface EvidenceEntity {
  type: EvidenceEntityType;
  id: string;
  actorType?: "user" | "service" | "system" | "ai_agent";
  resourceType?: string;
  version?: string;
  pathHash?: string;
}

export interface EvidenceEdgeInput {
  id?: string;
  occurredAt?: string | Date;
  scope?: EvidenceScope;
  from: EvidenceEntity;
  relation: EvidenceEdgeRelation;
  to: EvidenceEntity;
  metadata?: Record<string, unknown>;
}

export interface EvidenceEdge {
  id: string;
  schemaVersion: typeof EDGE_SCHEMA_VERSION;
  occurredAt: string;
  scope?: EvidenceScope;
  from: EvidenceEntity;
  relation: EvidenceEdgeRelation;
  to: EvidenceEntity;
  metadata: JsonObject;
}

export type LawfulBasis =
  | "consent"
  | "contract"
  | "legal_obligation"
  | "vital_interests"
  | "public_task"
  | "legitimate_interests"
  | "not_applicable";

export interface AuditEventInput {
  id?: string;
  occurredAt?: string | Date;
  actor: Principal;
  action: string;
  target: Resource;
  scope?: EvidenceScope;
  requestId?: string;
  purpose?: string;
  lawfulBasis?: LawfulBasis;
  dataCategories?: string[];
  retention?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  schemaVersion: typeof SCHEMA_VERSION;
  occurredAt: string;
  actor: Principal;
  action: string;
  target: Resource;
  scope?: EvidenceScope;
  requestId?: string;
  purpose?: string;
  lawfulBasis?: LawfulBasis;
  dataCategories?: string[];
  retention?: string;
  metadata: JsonObject;
}

export interface AuditRecord {
  event: AuditEvent;
  sequence: number;
  previousHash: string | null;
  hash: string;
  hashAlgorithm: typeof HASH_ALGORITHM;
  canonicalization: "veritio-json-v1";
  appendedAt: string;
  idempotencyKeyHash: string;
}

export interface EvidenceEdgeRecord {
  edge: EvidenceEdge;
  sequence: number;
  previousHash: string | null;
  hash: string;
  hashAlgorithm: typeof HASH_ALGORITHM;
  canonicalization: "veritio-json-v1";
  appendedAt: string;
  idempotencyKeyHash: string;
}

export interface AuditStoreAppendOptions {
  idempotencyKey?: string;
  expectedPreviousHash?: string | null;
}

export interface AuditStoreListOptions {
  afterSequence?: number;
  limit?: number;
}

export interface AuditStore {
  append(event: AuditEvent, options?: AuditStoreAppendOptions): Promise<AuditRecord>;
  list(scope: EvidenceScope & { tenantId: string }, options?: AuditStoreListOptions): Promise<AuditRecord[]>;
}

export interface AuditRecorder {
  record(input: AuditEventInput, options?: AuditStoreAppendOptions): Promise<AuditRecord>;
}

export type VerificationResult =
  | { ok: true }
  | {
      ok: false;
      index: number;
      reason:
        | "missing_tenant_scope"
        | "unsupported_hash_algorithm"
        | "unsupported_canonicalization"
        | "sequence_mismatch"
        | "previous_hash_mismatch"
        | "hash_mismatch";
    };

const SENSITIVE_KEY_PATTERN = /(password|secret|token|api[_-]?key|authorization|email|phone|ssn)/i;

/**
 * Produces the protocol canonical JSON string used by hashing and fixtures.
 * Object keys are sorted, undefined object fields are omitted, array holes become
 * null, and unsupported numeric/object values fail before they can affect hashes.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeForJson(value));
}

/**
 * Normalizes host-provided audit input into the language-neutral audit event
 * contract while enforcing action format, required actor/target fields, sorted
 * data categories, and deterministic metadata redaction.
 */
export function createAuditEvent(input: AuditEventInput): AuditEvent {
  assertNonEmpty(input.actor?.id, "actor.id");
  assertNonEmpty(input.actor?.type, "actor.type");
  assertNonEmpty(input.action, "action");
  assertNonEmpty(input.target?.id, "target.id");
  assertNonEmpty(input.target?.type, "target.type");
  if (!ACTION_PATTERN.test(input.action)) {
    throw new TypeError("action must use dotted lowercase protocol form");
  }

  const event: AuditEvent = {
    id: input.id ?? `evt_${randomUUID()}`,
    schemaVersion: SCHEMA_VERSION,
    occurredAt: normalizeDate(input.occurredAt ?? new Date()),
    actor: cleanPrincipal(input.actor),
    action: input.action,
    target: cleanResource(input.target),
    metadata: redactMetadata(input.metadata ?? {}),
  };

  const scope = input.scope ? cleanScope(input.scope) : undefined;
  if (scope) {
    event.scope = scope;
  }
  if (input.requestId) {
    event.requestId = input.requestId;
  }
  if (input.purpose) {
    event.purpose = input.purpose;
  }
  if (input.lawfulBasis) {
    event.lawfulBasis = input.lawfulBasis;
  }
  if (input.dataCategories?.length) {
    event.dataCategories = [...new Set(input.dataCategories)].sort();
  }
  if (input.retention) {
    event.retention = input.retention;
  }

  return event;
}

/**
 * Creates a portable evidence-graph edge without changing audit-event
 * semantics. Entity and relation validation stays here so hosted products cannot
 * invent framework-specific graph vocabulary.
 */
export function createEvidenceEdge(input: EvidenceEdgeInput): EvidenceEdge {
  const from = cleanEvidenceEntity(input.from, "from");
  const to = cleanEvidenceEntity(input.to, "to");
  if (!isEvidenceEdgeRelation(input.relation)) {
    throw new TypeError("relation must be a supported evidence graph relation");
  }

  const edge: EvidenceEdge = {
    id: input.id ?? `edge_${randomUUID()}`,
    schemaVersion: EDGE_SCHEMA_VERSION,
    occurredAt: normalizeDate(input.occurredAt ?? new Date()),
    from,
    relation: input.relation,
    to,
    metadata: redactMetadata(input.metadata ?? {}),
  };

  const scope = input.scope ? cleanScope(input.scope) : undefined;
  if (scope) {
    edge.scope = scope;
  }

  return edge;
}

/**
 * Hashes an audit event together with the previous chain hash. This is the
 * event-level link used by conformance fixtures and must remain stable across
 * the TypeScript, Python, and Go SDKs.
 */
export function hashAuditEvent(event: AuditEvent, previousHash: string | null = null): string {
  return sha256Hex(
    canonicalJson({
      event,
      previousHash,
    }),
  );
}

/**
 * Hashes an evidence edge together with the previous edge-chain hash. It mirrors
 * audit-event hashing so graph records can be verified independently.
 */
export function hashEvidenceEdge(edge: EvidenceEdge, previousHash: string | null = null): string {
  return sha256Hex(
    canonicalJson({
      edge,
      previousHash,
    }),
  );
}

/**
 * Recomputes the envelope hash for an audit record while excluding the stored
 * hash field itself. Storage adapters use this to detect tampering after read.
 */
export function hashAuditRecord(record: AuditRecord | Omit<AuditRecord, "hash">): string {
  const { hash: _hash, ...hashInput } = record as AuditRecord;
  return sha256Hex(canonicalJson(hashInput));
}

/**
 * Recomputes the envelope hash for an evidence-edge record while excluding the
 * stored hash field itself. Verifiers rely on this to prove graph-chain integrity.
 */
export function hashEvidenceEdgeRecord(record: EvidenceEdgeRecord | Omit<EvidenceEdgeRecord, "hash">): string {
  const { hash: _hash, ...hashInput } = record as EvidenceEdgeRecord;
  return sha256Hex(canonicalJson(hashInput));
}

/**
 * Verifies tenant-scoped audit records as independent hash chains. The verifier
 * fails closed on missing tenant scope, unsupported envelope metadata, sequence
 * gaps, previous-hash mismatches, and record-hash tampering.
 */
export function verifyAuditRecords(records: readonly AuditRecord[]): VerificationResult {
  const tenantState = new Map<string, { previousHash: string | null; sequence: number }>();

  for (const [index, record] of records.entries()) {
    if (!record.event.scope?.tenantId) {
      return { ok: false, index, reason: "missing_tenant_scope" };
    }
    if (record.hashAlgorithm !== HASH_ALGORITHM) {
      return { ok: false, index, reason: "unsupported_hash_algorithm" };
    }
    if (record.canonicalization !== "veritio-json-v1") {
      return { ok: false, index, reason: "unsupported_canonicalization" };
    }

    const state = tenantState.get(record.event.scope.tenantId) ?? { previousHash: null, sequence: 0 };
    if (record.sequence !== state.sequence + 1) {
      return { ok: false, index, reason: "sequence_mismatch" };
    }
    if (record.previousHash !== state.previousHash) {
      return { ok: false, index, reason: "previous_hash_mismatch" };
    }

    const expectedHash = hashAuditRecord(record);
    if (record.hash !== expectedHash) {
      return { ok: false, index, reason: "hash_mismatch" };
    }

    tenantState.set(record.event.scope.tenantId, {
      previousHash: record.hash,
      sequence: record.sequence,
    });
  }

  return { ok: true };
}

/**
 * Verifies tenant-scoped evidence-edge records using the same envelope rules as
 * audit records while keeping graph chains separate from audit-event chains.
 */
export function verifyEvidenceEdgeRecords(records: readonly EvidenceEdgeRecord[]): VerificationResult {
  const tenantState = new Map<string, { previousHash: string | null; sequence: number }>();

  for (const [index, record] of records.entries()) {
    if (!record.edge.scope?.tenantId) {
      return { ok: false, index, reason: "missing_tenant_scope" };
    }
    if (record.hashAlgorithm !== HASH_ALGORITHM) {
      return { ok: false, index, reason: "unsupported_hash_algorithm" };
    }
    if (record.canonicalization !== "veritio-json-v1") {
      return { ok: false, index, reason: "unsupported_canonicalization" };
    }

    const state = tenantState.get(record.edge.scope.tenantId) ?? { previousHash: null, sequence: 0 };
    if (record.sequence !== state.sequence + 1) {
      return { ok: false, index, reason: "sequence_mismatch" };
    }
    if (record.previousHash !== state.previousHash) {
      return { ok: false, index, reason: "previous_hash_mismatch" };
    }

    const expectedHash = hashEvidenceEdgeRecord(record);
    if (record.hash !== expectedHash) {
      return { ok: false, index, reason: "hash_mismatch" };
    }

    tenantState.set(record.edge.scope.tenantId, {
      previousHash: record.hash,
      sequence: record.sequence,
    });
  }

  return { ok: true };
}

/**
 * Wraps an injected AuditStore with the minimal recorder API used by adapters.
 * The SDK never reads host environment state directly; callers inject storage at
 * the application boundary.
 */
export function createAuditRecorder(options: { store: AuditStore }): AuditRecorder {
  return {
    async record(input, appendOptions) {
      return options.store.append(createAuditEvent(input), appendOptions);
    },
  };
}

/**
 * Local-only AuditStore implementation for tests, examples, and Workbench
 * scenarios. It preserves tenant isolation, idempotency replay, and hash-chain
 * semantics without implying production durability.
 */
export class MemoryAuditStore implements AuditStore {
  #records: AuditRecord[] = [];
  #idempotencyRecords = new Map<string, { eventCanonical: string; record: AuditRecord }>();
  #tenantTips = new Map<string, AuditRecord>();

  /**
   * Appends one audit event to the tenant-local in-memory hash chain. Idempotent
   * replays return the original record, while conflicting payloads or stale chain
   * tips fail closed.
   */
  async append(event: AuditEvent, options: AuditStoreAppendOptions = {}): Promise<AuditRecord> {
    const tenantId = requireTenantId(event);
    const idempotencyKeyHash = hashIdempotencyKey(tenantId, options.idempotencyKey ?? event.id);
    const eventCanonical = canonicalJson(event);
    const storedEvent = cloneEvent(event);
    const existing = this.#idempotencyRecords.get(idempotencyKeyHash);
    if (existing) {
      if (existing.eventCanonical !== eventCanonical) {
        throw new TypeError("idempotency conflict");
      }
      return cloneRecord(existing.record);
    }

    const previousRecord = this.#tenantTips.get(tenantId);
    const previousHash = previousRecord?.hash ?? null;
    if (options.expectedPreviousHash !== undefined && options.expectedPreviousHash !== previousHash) {
      throw new TypeError("expectedPreviousHash does not match tenant chain tip");
    }

    const recordWithoutHash: Omit<AuditRecord, "hash"> = {
      event: storedEvent,
      sequence: (previousRecord?.sequence ?? 0) + 1,
      previousHash,
      hashAlgorithm: HASH_ALGORITHM,
      canonicalization: "veritio-json-v1",
      appendedAt: new Date().toISOString(),
      idempotencyKeyHash,
    };
    const record: AuditRecord = {
      ...recordWithoutHash,
      hash: hashAuditRecord(recordWithoutHash),
    };

    this.#records.push(record);
    this.#tenantTips.set(tenantId, record);
    this.#idempotencyRecords.set(idempotencyKeyHash, { eventCanonical, record });
    return cloneRecord(record);
  }

  /**
   * Lists cloned tenant records after an optional sequence boundary. Callers must
   * provide tenant scope so one tenant cannot observe another tenant's chain.
   */
  async list(scope: EvidenceScope & { tenantId: string }, options: AuditStoreListOptions = {}): Promise<AuditRecord[]> {
    assertNonEmpty(scope.tenantId, "scope.tenantId");
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) {
      throw new TypeError("limit must be a non-negative integer");
    }
    if (
      options.afterSequence !== undefined &&
      (!Number.isInteger(options.afterSequence) || options.afterSequence < 0)
    ) {
      throw new TypeError("afterSequence must be a non-negative integer");
    }

    const afterSequence = options.afterSequence ?? 0;
    const records = this.#records.filter((record) => {
      return record.event.scope?.tenantId === scope.tenantId && record.sequence > afterSequence;
    });
    const limited = options.limit === undefined ? records : records.slice(0, options.limit);
    return limited.map(cloneRecord);
  }

  /**
   * Returns a cloned snapshot for local verification and tests without exposing
   * mutable references to the store's internal record array.
   */
  records(): AuditRecord[] {
    return this.#records.map(cloneRecord);
  }
}

/**
 * Applies deterministic metadata redaction before metadata enters canonical JSON
 * or hashes. Sensitive key names are redacted recursively rather than persisted.
 */
function redactMetadata(value: Record<string, unknown>): JsonObject {
  return redactAny(value, "") as JsonObject;
}

/**
 * Recursively converts arbitrary metadata into protocol JSON while replacing
 * sensitive-key values with the stable redaction marker.
 */
function redactAny(value: unknown, key: string): JsonValue {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }

  if (value === undefined) {
    return null;
  }

  if (value == null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("metadata numbers must be finite");
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactAny(item, key));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    const result: JsonObject = {};
    for (const objectKey of Object.keys(value as Record<string, unknown>).sort()) {
      const objectValue = (value as Record<string, unknown>)[objectKey];
      if (objectValue !== undefined) {
        result[objectKey] = redactAny(objectValue, objectKey);
      }
    }
    return result;
  }

  return String(value);
}

/**
 * Converts arbitrary values into the canonical JSON domain used by hashing.
 * Sorting and undefined handling live here so every hash entrypoint shares one
 * deterministic representation.
 */
function normalizeForJson(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value == null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JSON numbers must be finite");
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForJson(item) ?? null);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    const result: JsonObject = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const normalized = normalizeForJson((value as Record<string, unknown>)[key]);
      if (normalized !== undefined) {
        result[key] = normalized;
      }
    }
    return result;
  }

  throw new TypeError(`unsupported JSON value type: ${typeof value}`);
}

/**
 * Accepts Date objects or date strings and emits an ISO timestamp. Invalid dates
 * fail before they become part of an auditable record.
 */
function normalizeDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("occurredAt must be a valid date");
  }
  return date.toISOString();
}

/**
 * Enforces required string fields at the SDK boundary with consistent errors.
 */
function assertNonEmpty(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
}

/**
 * Returns a protocol principal without carrying undefined or extra host fields.
 */
function cleanPrincipal(value: Principal): Principal {
  return value.display
    ? { type: value.type, id: value.id, display: value.display }
    : { type: value.type, id: value.id };
}

/**
 * Returns a protocol resource without carrying undefined or extra host fields.
 */
function cleanResource(value: Resource): Resource {
  return value.display
    ? { type: value.type, id: value.id, display: value.display }
    : { type: value.type, id: value.id };
}

/**
 * Validates evidence graph entities against the public vocabulary and strips any
 * non-protocol fields before the edge is hashed or exported.
 */
function cleanEvidenceEntity(value: EvidenceEntity, field: string): EvidenceEntity {
  assertNonEmpty(value?.type, `${field}.type`);
  assertNonEmpty(value?.id, `${field}.id`);
  if (!isEvidenceEntityType(value.type)) {
    throw new TypeError(`${field}.type must be a supported evidence graph entity type`);
  }

  const entity: EvidenceEntity = { type: value.type, id: value.id };
  if (value.actorType) {
    entity.actorType = value.actorType;
  }
  if (value.resourceType) {
    entity.resourceType = value.resourceType;
  }
  if (value.version) {
    entity.version = value.version;
  }
  if (value.pathHash) {
    entity.pathHash = value.pathHash;
  }
  return entity;
}

/**
 * Narrows a string to the supported evidence entity vocabulary.
 */
function isEvidenceEntityType(value: string): value is EvidenceEntityType {
  return (EVIDENCE_ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * Narrows a string to the supported evidence-edge relation vocabulary.
 */
function isEvidenceEdgeRelation(value: string): value is EvidenceEdgeRelation {
  return (EVIDENCE_EDGE_RELATIONS as readonly string[]).includes(value);
}

/**
 * Normalizes optional scope fields while preserving tenant/workspace/environment
 * names exactly as supplied by the host boundary.
 */
function cleanScope(value: EvidenceScope): EvidenceScope | undefined {
  const scope: EvidenceScope = {};
  if (value.tenantId) {
    scope.tenantId = value.tenantId;
  }
  if (value.workspaceId) {
    scope.workspaceId = value.workspaceId;
  }
  if (value.environment) {
    scope.environment = value.environment;
  }
  return Object.keys(scope).length > 0 ? scope : undefined;
}

/**
 * Requires tenant scope before appending to any audit chain. Tenantless records
 * are rejected because they cannot be isolated or verified safely.
 */
function requireTenantId(event: AuditEvent): string {
  const tenantId = event.scope?.tenantId;
  if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
    throw new TypeError("scope.tenantId is required");
  }
  return tenantId;
}

/**
 * Hashes idempotency keys with the tenant id so the same host key cannot collide
 * across tenant chains.
 */
export function hashIdempotencyKey(tenantId: string, idempotencyKey: string): string {
  assertNonEmpty(tenantId, "tenantId");
  assertNonEmpty(idempotencyKey, "idempotencyKey");
  return sha256Hex(`${tenantId}\u0000${idempotencyKey}`);
}

/**
 * Deep-clones audit events before storage returns them so callers cannot mutate
 * stored evidence after append.
 */
function cloneEvent(event: AuditEvent): AuditEvent {
  return JSON.parse(JSON.stringify(event)) as AuditEvent;
}

/**
 * Deep-clones audit records before exposing them to callers or test fixtures.
 */
function cloneRecord(record: AuditRecord): AuditRecord {
  return JSON.parse(JSON.stringify(record)) as AuditRecord;
}

/**
 * Computes a lowercase SHA-256 hex digest, the only hash algorithm currently
 * accepted by the protocol envelope.
 */
function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export * from "./provenance";

import { createHash, randomUUID } from "node:crypto";

export const SCHEMA_VERSION = "2026-06-10";
export const HASH_ALGORITHM = "sha256";
const ACTION_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;

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

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeForJson(value));
}

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

export function hashAuditEvent(event: AuditEvent, previousHash: string | null = null): string {
  return sha256Hex(
    canonicalJson({
      event,
      previousHash,
    }),
  );
}

export function hashAuditRecord(record: AuditRecord | Omit<AuditRecord, "hash">): string {
  const { hash: _hash, ...hashInput } = record as AuditRecord;
  return sha256Hex(canonicalJson(hashInput));
}

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

export function createAuditRecorder(options: { store: AuditStore }): AuditRecorder {
  return {
    async record(input, appendOptions) {
      return options.store.append(createAuditEvent(input), appendOptions);
    },
  };
}

export class MemoryAuditStore implements AuditStore {
  #records: AuditRecord[] = [];
  #idempotencyRecords = new Map<string, { eventCanonical: string; record: AuditRecord }>();
  #tenantTips = new Map<string, AuditRecord>();

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

  async list(scope: EvidenceScope & { tenantId: string }, options: AuditStoreListOptions = {}): Promise<AuditRecord[]> {
    assertNonEmpty(scope.tenantId, "scope.tenantId");
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 0)) {
      throw new TypeError("limit must be a non-negative integer");
    }
    if (options.afterSequence !== undefined && (!Number.isInteger(options.afterSequence) || options.afterSequence < 0)) {
      throw new TypeError("afterSequence must be a non-negative integer");
    }

    const afterSequence = options.afterSequence ?? 0;
    const records = this.#records.filter((record) => {
      return record.event.scope?.tenantId === scope.tenantId && record.sequence > afterSequence;
    });
    const limited = options.limit === undefined ? records : records.slice(0, options.limit);
    return limited.map(cloneRecord);
  }

  records(): AuditRecord[] {
    return this.#records.map(cloneRecord);
  }
}

function redactMetadata(value: Record<string, unknown>): JsonObject {
  return redactAny(value, "") as JsonObject;
}

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

function normalizeDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("occurredAt must be a valid date");
  }
  return date.toISOString();
}

function assertNonEmpty(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
}

function cleanPrincipal(value: Principal): Principal {
  return value.display ? { type: value.type, id: value.id, display: value.display } : { type: value.type, id: value.id };
}

function cleanResource(value: Resource): Resource {
  return value.display ? { type: value.type, id: value.id, display: value.display } : { type: value.type, id: value.id };
}

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

function requireTenantId(event: AuditEvent): string {
  const tenantId = event.scope?.tenantId;
  if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
    throw new TypeError("scope.tenantId is required");
  }
  return tenantId;
}

export function hashIdempotencyKey(tenantId: string, idempotencyKey: string): string {
  assertNonEmpty(tenantId, "tenantId");
  assertNonEmpty(idempotencyKey, "idempotencyKey");
  return sha256Hex(`${tenantId}\u0000${idempotencyKey}`);
}

function cloneEvent(event: AuditEvent): AuditEvent {
  return JSON.parse(JSON.stringify(event)) as AuditEvent;
}

function cloneRecord(record: AuditRecord): AuditRecord {
  return JSON.parse(JSON.stringify(record)) as AuditRecord;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

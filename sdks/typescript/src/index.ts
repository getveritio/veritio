import { createHash, randomUUID } from "node:crypto";

export const SCHEMA_VERSION = "2026-06-10";
export const HASH_ALGORITHM = "sha256";

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
  previousHash: string | null;
  hash: string;
  hashAlgorithm: typeof HASH_ALGORITHM;
  canonicalization: "veritio-json-v1";
  appendedAt: string;
}

export type VerificationResult =
  | { ok: true }
  | { ok: false; index: number; reason: "previous_hash_mismatch" | "hash_mismatch" };

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

export function verifyAuditRecords(records: readonly AuditRecord[]): VerificationResult {
  let previousHash: string | null = null;

  for (const [index, record] of records.entries()) {
    if (record.previousHash !== previousHash) {
      return { ok: false, index, reason: "previous_hash_mismatch" };
    }

    const expectedHash = hashAuditEvent(record.event, previousHash);
    if (record.hash !== expectedHash) {
      return { ok: false, index, reason: "hash_mismatch" };
    }

    previousHash = record.hash;
  }

  return { ok: true };
}

export class MemoryAuditStore {
  #records: AuditRecord[] = [];

  async append(event: AuditEvent): Promise<AuditRecord> {
    const previousHash = this.#records.at(-1)?.hash ?? null;
    const record: AuditRecord = {
      event,
      previousHash,
      hash: hashAuditEvent(event, previousHash),
      hashAlgorithm: HASH_ALGORITHM,
      canonicalization: "veritio-json-v1",
      appendedAt: new Date().toISOString(),
    };

    this.#records.push(record);
    return cloneRecord(record);
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

function cloneRecord(record: AuditRecord): AuditRecord {
  return JSON.parse(JSON.stringify(record)) as AuditRecord;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

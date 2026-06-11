import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  HASH_ALGORITHM,
  MemoryAuditStore,
  canonicalJson,
  createAuditRecorder,
  createAuditEvent,
  hashAuditEvent,
  hashAuditRecord,
  hashIdempotencyKey,
  verifyAuditRecords,
} from "../index";
import type { AuditEvent, AuditEventInput, JsonObject } from "../index";

const CONFORMANCE_DIR = join(import.meta.dir, "../../../../spec/conformance");

interface CanonicalJsonFixture {
  cases: Array<{
    name: string;
    input: unknown;
    expected: string;
  }>;
}

interface RedactionFixture {
  cases: Array<{
    name: string;
    metadata: Record<string, unknown>;
    expectedMetadata: JsonObject;
  }>;
}

interface EventCreationFixture {
  cases: Array<{
    name: string;
    input: AuditEventInput;
    expected: AuditEvent;
  }>;
}

interface EventHashingFixture {
  cases: Array<{
    name: string;
    event: AuditEvent;
    previousHash: string | null;
    expectedHash: string;
  }>;
}

interface AuditRecordHashingFixture {
  cases: Array<{
    name: string;
    tenantId: string;
    idempotencyKey: string;
    expectedIdempotencyKeyHash: string;
    recordWithoutHash: Parameters<typeof hashAuditRecord>[0];
    expectedHash: string;
  }>;
}

async function loadConformanceFixture<T>(fileName: string): Promise<T> {
  return (await Bun.file(join(CONFORMANCE_DIR, fileName)).json()) as T;
}

describe("canonicalJson", () => {
  test("matches conformance fixtures", async () => {
    const fixture = await loadConformanceFixture<CanonicalJsonFixture>("canonical-json.json");

    for (const conformanceCase of fixture.cases) {
      expect(canonicalJson(conformanceCase.input)).toBe(conformanceCase.expected);
    }
  });

  test("omits undefined values", () => {
    const actual = canonicalJson({
      z: 1,
      a: {
        d: undefined,
        c: 3,
        b: [2, { y: "yes", x: "first" }],
      },
    });

    expect(actual).toBe('{"a":{"b":[2,{"x":"first","y":"yes"}],"c":3},"z":1}');
  });
});

describe("audit record schema", () => {
  test("requires tenant-scoped record envelope fields", async () => {
    const schema = (await Bun.file("spec/audit-record.schema.json").json()) as {
      required: string[];
      properties: {
        event: {
          allOf: [
            unknown,
            {
              required: string[];
              properties: {
                scope: {
                  required: string[];
                  properties: {
                    tenantId: {
                      minLength: number;
                    };
                  };
                };
              };
            },
          ];
        };
      };
      $defs: {
        sha256Hex: {
          pattern: string;
        };
      };
    };

    expect(schema.required).toEqual([
      "event",
      "sequence",
      "previousHash",
      "hash",
      "hashAlgorithm",
      "canonicalization",
      "appendedAt",
      "idempotencyKeyHash",
    ]);
    expect(schema.properties.event.allOf[1].required).toContain("scope");
    expect(schema.properties.event.allOf[1].properties.scope.required).toContain("tenantId");
    expect(schema.properties.event.allOf[1].properties.scope.properties.tenantId.minLength).toBe(1);
    expect(schema.$defs.sha256Hex.pattern).toBe("^[a-f0-9]{64}$");
  });
});

describe("createAuditEvent", () => {
  test("matches event creation conformance fixtures", async () => {
    const fixture = await loadConformanceFixture<EventCreationFixture>("event-creation.json");

    for (const conformanceCase of fixture.cases) {
      expect(createAuditEvent(conformanceCase.input)).toEqual(conformanceCase.expected);
    }
  });

  test("matches redaction conformance fixtures", async () => {
    const fixture = await loadConformanceFixture<RedactionFixture>("redaction.json");

    for (const conformanceCase of fixture.cases) {
      const event = createAuditEvent({
        id: "evt_redaction_fixture",
        occurredAt: "2026-06-10T00:00:00.000Z",
        actor: { type: "user", id: "usr_fixture_123" },
        action: "org.member.invited",
        target: { type: "organization", id: "org_fixture_123" },
        metadata: conformanceCase.metadata,
      });

      expect(event.metadata).toEqual(conformanceCase.expectedMetadata);
    }
  });

  test("rejects actions outside the protocol pattern", () => {
    expect(() =>
      createAuditEvent({
        id: "evt_01",
        occurredAt: "2026-06-10T00:00:00.000Z",
        actor: { type: "user", id: "usr_123" },
        action: "OrgMemberInvited",
        target: { type: "organization", id: "org_123" },
        metadata: {},
      }),
    ).toThrow("action must use dotted lowercase protocol form");
  });
});

describe("hashAuditEvent", () => {
  test("matches conformance fixtures", async () => {
    const fixture = await loadConformanceFixture<EventHashingFixture>("event-hashing.json");

    for (const conformanceCase of fixture.cases) {
      expect(
        hashAuditEvent(conformanceCase.event, conformanceCase.previousHash),
      ).toBe(conformanceCase.expectedHash);
    }
  });
});

describe("MemoryAuditStore", () => {
  test("appends records as a verifiable hash chain and detects tampering", async () => {
    const store = new MemoryAuditStore();
    const first = createAuditEvent({
      id: "evt_01",
      occurredAt: "2026-06-10T00:00:00.000Z",
      actor: { type: "user", id: "usr_123" },
      action: "org.member.invited",
      target: { type: "organization", id: "org_123" },
      scope: { tenantId: "org_123", environment: "test" },
      metadata: { role: "viewer" },
    });
    const second = createAuditEvent({
      id: "evt_02",
      occurredAt: "2026-06-10T00:01:00.000Z",
      actor: { type: "system", id: "sys_retention" },
      action: "retention.policy.applied",
      target: { type: "organization", id: "org_123" },
      scope: { tenantId: "org_123", environment: "test" },
      metadata: { policy: "security_1y" },
    });

    const firstRecord = await store.append(first);
    const secondRecord = await store.append(second);

    expect(firstRecord.previousHash).toBeNull();
    expect(secondRecord.previousHash).toBe(firstRecord.hash);
    expect(verifyAuditRecords(store.records())).toEqual({ ok: true });

    const tampered = store.records();
    tampered[1] = {
      ...tampered[1],
      event: {
        ...tampered[1].event,
        metadata: { policy: "security_7y" },
      },
    };

    expect(verifyAuditRecords(tampered)).toEqual({
      ok: false,
      index: 1,
      reason: "hash_mismatch",
    });
  });

  test("emits the language-neutral audit record envelope", async () => {
    const store = new MemoryAuditStore();
    const record = await store.append(
      createAuditEvent({
        id: "evt_01",
        occurredAt: "2026-06-10T00:00:00.000Z",
        actor: { type: "user", id: "usr_123" },
        action: "org.member.invited",
        target: { type: "organization", id: "org_123" },
        scope: { tenantId: "org_123", environment: "test" },
        metadata: { role: "viewer" },
      }),
      { idempotencyKey: "org_123:invite:usr_456" },
    );

    expect(Object.keys(record).sort()).toEqual([
      "appendedAt",
      "canonicalization",
      "event",
      "hash",
      "hashAlgorithm",
      "idempotencyKeyHash",
      "previousHash",
      "sequence",
    ]);
    expect(record.sequence).toBe(1);
    expect(record.previousHash).toBeNull();
    expect(record.hashAlgorithm).toBe(HASH_ALGORITHM);
    expect(record.canonicalization).toBe("veritio-json-v1");
    expect(record.appendedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record.idempotencyKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.hash).toBe(hashAuditRecord(record));
  });

  test("matches audit record hashing and idempotency conformance fixtures", async () => {
    const fixture = await loadConformanceFixture<AuditRecordHashingFixture>("audit-record-hashing.json");

    for (const conformanceCase of fixture.cases) {
      expect(
        hashIdempotencyKey(conformanceCase.tenantId, conformanceCase.idempotencyKey),
      ).toBe(conformanceCase.expectedIdempotencyKeyHash);
      expect(hashAuditRecord(conformanceCase.recordWithoutHash)).toBe(conformanceCase.expectedHash);
    }
  });
});

describe("MemoryAuditStore fail-closed behavior", () => {
  test("requires tenant scope by default", async () => {
    const store = new MemoryAuditStore();
    const event = createAuditEvent({
      id: "evt_missing_scope",
      occurredAt: "2026-06-10T00:00:00.000Z",
      actor: { type: "user", id: "usr_123" },
      action: "org.member.invited",
      target: { type: "organization", id: "org_123" },
      metadata: { role: "viewer" },
    });

    await expect(store.append(event)).rejects.toThrow("scope.tenantId is required");
  });

  test("returns the existing record for the same idempotency key and tenant", async () => {
    const store = new MemoryAuditStore();
    const event = createAuditEvent({
      id: "evt_01",
      occurredAt: "2026-06-10T00:00:00.000Z",
      actor: { type: "user", id: "usr_123" },
      action: "org.member.invited",
      target: { type: "organization", id: "org_123" },
      scope: { tenantId: "org_123", environment: "test" },
      metadata: { role: "viewer" },
    });

    const first = await store.append(event, { idempotencyKey: "org_123:invite:usr_456" });
    const second = await store.append(event, { idempotencyKey: "org_123:invite:usr_456" });

    expect(second).toEqual(first);
    expect(store.records()).toHaveLength(1);
    expect(first.sequence).toBe(1);
    expect(first.idempotencyKeyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("rejects idempotency key reuse for different event payloads", async () => {
    const store = new MemoryAuditStore();
    const event = createAuditEvent({
      id: "evt_01",
      occurredAt: "2026-06-10T00:00:00.000Z",
      actor: { type: "user", id: "usr_123" },
      action: "org.member.invited",
      target: { type: "organization", id: "org_123" },
      scope: { tenantId: "org_123", environment: "test" },
      metadata: { role: "viewer" },
    });
    const conflicting = createAuditEvent({
      id: "evt_02",
      occurredAt: "2026-06-10T00:00:00.000Z",
      actor: { type: "user", id: "usr_123" },
      action: "org.member.invited",
      target: { type: "organization", id: "org_123" },
      scope: { tenantId: "org_123", environment: "test" },
      metadata: { role: "admin" },
    });

    await store.append(event, { idempotencyKey: "org_123:invite:usr_456" });

    await expect(store.append(conflicting, { idempotencyKey: "org_123:invite:usr_456" })).rejects.toThrow(
      "idempotency conflict",
    );
    expect(store.records()).toHaveLength(1);
  });

  test("chains records independently per tenant and lists deterministically", async () => {
    const store = new MemoryAuditStore();
    const orgOneFirst = await store.append(
      createAuditEvent({
        id: "evt_org_1_a",
        occurredAt: "2026-06-10T00:00:00.000Z",
        actor: { type: "user", id: "usr_123" },
        action: "org.member.invited",
        target: { type: "organization", id: "org_1" },
        scope: { tenantId: "org_1", environment: "test" },
        metadata: { role: "viewer" },
      }),
    );
    const orgTwoFirst = await store.append(
      createAuditEvent({
        id: "evt_org_2_a",
        occurredAt: "2026-06-10T00:00:00.000Z",
        actor: { type: "user", id: "usr_456" },
        action: "org.member.invited",
        target: { type: "organization", id: "org_2" },
        scope: { tenantId: "org_2", environment: "test" },
        metadata: { role: "viewer" },
      }),
    );
    const orgOneSecond = await store.append(
      createAuditEvent({
        id: "evt_org_1_b",
        occurredAt: "2026-06-10T00:01:00.000Z",
        actor: { type: "system", id: "sys_retention" },
        action: "retention.policy.applied",
        target: { type: "organization", id: "org_1" },
        scope: { tenantId: "org_1", environment: "test" },
        metadata: { policy: "security_1y" },
      }),
    );

    expect(orgOneFirst.sequence).toBe(1);
    expect(orgTwoFirst.sequence).toBe(1);
    expect(orgOneSecond.sequence).toBe(2);
    expect(orgOneSecond.previousHash).toBe(orgOneFirst.hash);

    expect(await store.list({ tenantId: "org_1" })).toEqual([orgOneFirst, orgOneSecond]);
    expect(await store.list({ tenantId: "org_1" }, { afterSequence: 1, limit: 1 })).toEqual([orgOneSecond]);
  });

  test("rejects appends when expected previous hash does not match the tenant chain tip", async () => {
    const store = new MemoryAuditStore();
    const event = createAuditEvent({
      id: "evt_01",
      occurredAt: "2026-06-10T00:00:00.000Z",
      actor: { type: "user", id: "usr_123" },
      action: "org.member.invited",
      target: { type: "organization", id: "org_123" },
      scope: { tenantId: "org_123", environment: "test" },
      metadata: { role: "viewer" },
    });

    await expect(store.append(event, { expectedPreviousHash: "not-the-tip" })).rejects.toThrow(
      "expectedPreviousHash does not match tenant chain tip",
    );
  });

  test("detects record envelope tampering", async () => {
    const store = new MemoryAuditStore();
    await store.append(
      createAuditEvent({
        id: "evt_01",
        occurredAt: "2026-06-10T00:00:00.000Z",
        actor: { type: "user", id: "usr_123" },
        action: "org.member.invited",
        target: { type: "organization", id: "org_123" },
        scope: { tenantId: "org_123", environment: "test" },
        metadata: { role: "viewer" },
      }),
    );

    const tampered = store.records();
    tampered[0] = { ...tampered[0], appendedAt: "2026-06-10T00:01:00.000Z" };

    expect(verifyAuditRecords(tampered)).toEqual({
      ok: false,
      index: 0,
      reason: "hash_mismatch",
    });
  });

  test("does not retain a mutable reference to the appended event", async () => {
    const store = new MemoryAuditStore();
    const event = createAuditEvent({
      id: "evt_01",
      occurredAt: "2026-06-10T00:00:00.000Z",
      actor: { type: "user", id: "usr_123" },
      action: "org.member.invited",
      target: { type: "organization", id: "org_123" },
      scope: { tenantId: "org_123", environment: "test" },
      metadata: { role: "viewer" },
    });

    await store.append(event);
    event.metadata.role = "admin";

    expect(store.records()[0]?.event.metadata).toEqual({ role: "viewer" });
    expect(verifyAuditRecords(store.records())).toEqual({ ok: true });
  });
});

describe("createAuditRecorder", () => {
  test("creates and appends a normalized event", async () => {
    const store = new MemoryAuditStore();
    const recorder = createAuditRecorder({ store });

    const record = await recorder.record({
      id: "evt_01",
      occurredAt: "2026-06-10T00:00:00.000Z",
      actor: { type: "user", id: "usr_123" },
      action: "org.member.invited",
      target: { type: "organization", id: "org_123" },
      scope: { tenantId: "org_123", environment: "test" },
      metadata: { invitedEmail: "member@example.com", role: "viewer" },
    });

    expect(record.event.metadata).toEqual({ invitedEmail: "[redacted]", role: "viewer" });
    expect(verifyAuditRecords(store.records())).toEqual({ ok: true });
  });
});

import { describe, expect, test } from "bun:test";
import {
  MemoryAuditStore,
  canonicalJson,
  createAuditRecorder,
  createAuditEvent,
  verifyAuditRecords,
} from "../index";

describe("canonicalJson", () => {
  test("sorts object keys recursively and omits undefined values", () => {
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

describe("createAuditEvent", () => {
  test("normalizes event fields and redacts sensitive metadata", () => {
    const event = createAuditEvent({
      id: "evt_01",
      occurredAt: "2026-06-10T00:00:00.000Z",
      actor: { type: "user", id: "usr_123" },
      action: "org.member.invited",
      target: { type: "organization", id: "org_123" },
      scope: { tenantId: "org_123", environment: "production" },
      purpose: "access_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: {
        invitedEmail: "member@example.com",
        role: "viewer",
        nested: {
          apiToken: "secret-token",
          note: "safe",
        },
      },
    });

    expect(event.schemaVersion).toBe("2026-06-10");
    expect(event.metadata).toEqual({
      invitedEmail: "[redacted]",
      role: "viewer",
      nested: {
        apiToken: "[redacted]",
        note: "safe",
      },
    });
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

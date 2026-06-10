import { describe, expect, test } from "bun:test";
import {
  MemoryAuditStore,
  canonicalJson,
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
      metadata: { role: "viewer" },
    });
    const second = createAuditEvent({
      id: "evt_02",
      occurredAt: "2026-06-10T00:01:00.000Z",
      actor: { type: "system", id: "sys_retention" },
      action: "retention.policy.applied",
      target: { type: "organization", id: "org_123" },
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

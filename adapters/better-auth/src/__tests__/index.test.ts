import { describe, expect, test } from "bun:test";
import { MemoryAuditStore, createAuditRecorder } from "veritio";
import { createBetterAuthVeritioAdapter } from "../index";

describe("createBetterAuthVeritioAdapter", () => {
  test("records a privacy-safe sign-up event", async () => {
    const store = new MemoryAuditStore();
    const adapter = createBetterAuthVeritioAdapter({
      recorder: createAuditRecorder({ store }),
      environment: "test",
    });

    await adapter.recordUserCreated({
      user: { id: "usr_123", email: "member@example.com" },
      tenantId: "org_123",
      requestId: "req_123",
    });

    const [record] = store.records();
    expect(record).toBeDefined();
    if (!record) {
      throw new Error("expected audit record");
    }
    expect(record.event.action).toBe("auth.user.created");
    expect(record.event.actor).toEqual({ type: "user", id: "usr_123" });
    expect(record.event.target).toEqual({ type: "user", id: "usr_123" });
    expect(record.event.scope).toEqual({ tenantId: "org_123", environment: "test" });
    expect(record.event.requestId).toBe("req_123");
    expect(record.event.purpose).toBe("access_management");
    expect(record.event.lawfulBasis).toBe("contract");
    expect(record.event.retention).toBe("security_1y");
    expect(record.event.metadata).toEqual({});
  });

  test("records an organization invitation without raw email metadata", async () => {
    const store = new MemoryAuditStore();
    const adapter = createBetterAuthVeritioAdapter({
      recorder: createAuditRecorder({ store }),
      environment: "test",
    });

    await adapter.recordInvitationCreated({
      invitation: { id: "inv_123", email: "member@example.com", role: "member" },
      inviter: { id: "usr_admin" },
      organization: { id: "org_123" },
      requestId: "req_456",
    });

    const [record] = store.records();
    expect(record).toBeDefined();
    if (!record) {
      throw new Error("expected audit record");
    }
    expect(record.event.action).toBe("org.member.invited");
    expect(record.event.actor).toEqual({ type: "user", id: "usr_admin" });
    expect(record.event.target).toEqual({ type: "organization_invitation", id: "inv_123" });
    expect(record.event.scope).toEqual({ tenantId: "org_123", environment: "test" });
    expect(record.event.requestId).toBe("req_456");
    expect(record.event.metadata).toEqual({ role: "member" });
  });
});

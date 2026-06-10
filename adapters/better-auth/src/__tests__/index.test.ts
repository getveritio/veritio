import { describe, expect, test } from "bun:test";
import { MemoryAuditStore, createAuditRecorder } from "@veritio/core";
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

  test("records a privacy-safe session creation event", async () => {
    const store = new MemoryAuditStore();
    const adapter = createBetterAuthVeritioAdapter({
      recorder: createAuditRecorder({ store }),
      environment: "test",
    });

    await adapter.recordSessionCreated({
      user: { id: "usr_123", email: "member@example.com" },
      session: { id: "ses_123" },
      tenantId: "org_123",
      requestId: "req_session_created",
    });

    const [record] = store.records();
    expect(record).toBeDefined();
    if (!record) {
      throw new Error("expected audit record");
    }
    expect(record.event.action).toBe("auth.session.created");
    expect(record.event.actor).toEqual({ type: "user", id: "usr_123" });
    expect(record.event.target).toEqual({ type: "session", id: "ses_123" });
    expect(record.event.scope).toEqual({ tenantId: "org_123", environment: "test" });
    expect(record.event.requestId).toBe("req_session_created");
    expect(record.event.purpose).toBe("access_management");
    expect(record.event.lawfulBasis).toBe("contract");
    expect(record.event.retention).toBe("security_1y");
    expect(record.event.metadata).toEqual({});
  });

  test("records a privacy-safe session revocation event", async () => {
    const store = new MemoryAuditStore();
    const adapter = createBetterAuthVeritioAdapter({
      recorder: createAuditRecorder({ store }),
      environment: "test",
    });

    await adapter.recordSessionRevoked({
      user: { id: "usr_123", email: "member@example.com" },
      session: { id: "ses_123" },
      tenantId: "org_123",
      requestId: "req_session_revoked",
    });

    const [record] = store.records();
    expect(record).toBeDefined();
    if (!record) {
      throw new Error("expected audit record");
    }
    expect(record.event.action).toBe("auth.session.revoked");
    expect(record.event.actor).toEqual({ type: "user", id: "usr_123" });
    expect(record.event.target).toEqual({ type: "session", id: "ses_123" });
    expect(record.event.scope).toEqual({ tenantId: "org_123", environment: "test" });
    expect(record.event.requestId).toBe("req_session_revoked");
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

  test("records an invitation acceptance without raw email metadata", async () => {
    const store = new MemoryAuditStore();
    const adapter = createBetterAuthVeritioAdapter({
      recorder: createAuditRecorder({ store }),
      environment: "test",
    });

    await adapter.recordInvitationAccepted({
      invitation: { id: "inv_123", email: "member@example.com" },
      member: { id: "mem_123", role: ["owner", "member", "member"] },
      user: { id: "usr_123", email: "member@example.com" },
      organization: { id: "org_123" },
      requestId: "req_789",
    });

    const [record] = store.records();
    expect(record).toBeDefined();
    if (!record) {
      throw new Error("expected audit record");
    }
    expect(record.event.action).toBe("org.member.joined");
    expect(record.event.actor).toEqual({ type: "user", id: "usr_123" });
    expect(record.event.target).toEqual({ type: "organization_member", id: "mem_123" });
    expect(record.event.scope).toEqual({ tenantId: "org_123", environment: "test" });
    expect(record.event.requestId).toBe("req_789");
    expect(record.event.purpose).toBe("access_management");
    expect(record.event.lawfulBasis).toBe("contract");
    expect(record.event.retention).toBe("security_1y");
    expect(record.event.metadata).toEqual({ invitationId: "inv_123", role: ["member", "owner"] });
  });
});

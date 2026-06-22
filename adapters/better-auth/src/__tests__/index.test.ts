import { describe, expect, test } from "bun:test";
import { createAuditRecorder, MemoryAuditStore } from "@veritio/core";
import {
  buildBetterAuthOrganizationCreatedAuditEventInput,
  buildBetterAuthSessionCreatedAuditEventInput,
  buildBetterAuthSessionRevokedAuditEventInput,
  buildBetterAuthUserCreatedAuditEventInput,
  createBetterAuthVeritioAdapter,
} from "../index";

describe("Better Auth audit-event input builders", () => {
  test("builds a privacy-safe user-created audit input", () => {
    const input = buildBetterAuthUserCreatedAuditEventInput(
      {
        user: { id: "usr_123", email: "member@example.com" },
        tenantId: "org_123",
        requestId: "req_123",
      },
      "test",
    );

    expect(input).toEqual({
      actor: { type: "user", id: "usr_123" },
      action: "auth.user.created",
      target: { type: "user", id: "usr_123" },
      scope: { tenantId: "org_123", environment: "test" },
      requestId: "req_123",
      purpose: "access_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: {},
    });
  });

  test("builds an organization-created audit input after organization scope exists", () => {
    const input = buildBetterAuthOrganizationCreatedAuditEventInput(
      {
        actor: { id: "usr_owner", email: "owner@example.com" },
        organization: { id: "org_123" },
        requestId: "req_org_created",
      },
      "test",
    );

    expect(input).toEqual({
      actor: { type: "user", id: "usr_owner" },
      action: "org.created",
      target: { type: "organization", id: "org_123" },
      scope: { tenantId: "org_123", environment: "test" },
      requestId: "req_org_created",
      purpose: "access_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: {},
    });
  });

  test("builds a session-created audit input with hashed security context", () => {
    const input = buildBetterAuthSessionCreatedAuditEventInput(
      {
        user: { id: "usr_123" },
        session: { id: "ses_123" },
        tenantId: "org_123",
        requestId: "req_session_created",
        securityContext: {
          ipAddressHash: "sha256:client-ip",
          userAgentHash: "sha256:user-agent",
          location: { country: "US", region: "CA" },
        },
        metadata: {
          authorization: "Bearer secret",
        },
      },
      "test",
    );

    expect(input).toEqual({
      actor: { type: "user", id: "usr_123" },
      action: "auth.session.created",
      target: { type: "session", id: "ses_123" },
      scope: { tenantId: "org_123", environment: "test" },
      requestId: "req_session_created",
      purpose: "access_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: {
        authorization: "Bearer secret",
        securityContext: {
          ipAddressHash: "sha256:client-ip",
          userAgentHash: "sha256:user-agent",
          location: { country: "US", region: "CA" },
        },
      },
    });
  });

  test("builds a session-revoked audit input for logout", () => {
    const input = buildBetterAuthSessionRevokedAuditEventInput({
      user: { id: "usr_123" },
      session: { id: "ses_123" },
      tenantId: "org_123",
    });

    expect(input).toEqual({
      actor: { type: "user", id: "usr_123" },
      action: "auth.session.revoked",
      target: { type: "session", id: "ses_123" },
      scope: { tenantId: "org_123" },
      purpose: "access_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: {},
    });
  });
});

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

  test("records hashed session context while redacting sensitive metadata keys", async () => {
    const store = new MemoryAuditStore();
    const adapter = createBetterAuthVeritioAdapter({
      recorder: createAuditRecorder({ store }),
      environment: "test",
    });

    await adapter.recordSessionCreated({
      user: { id: "usr_123" },
      session: { id: "ses_123" },
      tenantId: "org_123",
      securityContext: {
        ipAddressHash: "sha256:client-ip",
        userAgentHash: "sha256:user-agent",
        location: { country: "US", region: "CA" },
      },
      metadata: {
        authorization: "Bearer secret",
      },
    });

    const [record] = store.records();
    expect(record).toBeDefined();
    if (!record) {
      throw new Error("expected audit record");
    }
    expect(record.event.metadata).toEqual({
      authorization: "[redacted]",
      securityContext: {
        ipAddressHash: "sha256:client-ip",
        location: { country: "US", region: "CA" },
        userAgentHash: "sha256:user-agent",
      },
    });
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

  test("records a privacy-safe organization creation event", async () => {
    const store = new MemoryAuditStore();
    const adapter = createBetterAuthVeritioAdapter({
      recorder: createAuditRecorder({ store }),
      environment: "test",
    });

    await adapter.recordOrganizationCreated({
      actor: { id: "usr_owner", email: "owner@example.com" },
      organization: { id: "org_123" },
      requestId: "req_org_created",
    });

    const [record] = store.records();
    expect(record).toBeDefined();
    if (!record) {
      throw new Error("expected audit record");
    }
    expect(record.event.action).toBe("org.created");
    expect(record.event.actor).toEqual({ type: "user", id: "usr_owner" });
    expect(record.event.target).toEqual({ type: "organization", id: "org_123" });
    expect(record.event.scope).toEqual({ tenantId: "org_123", environment: "test" });
    expect(record.event.requestId).toBe("req_org_created");
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

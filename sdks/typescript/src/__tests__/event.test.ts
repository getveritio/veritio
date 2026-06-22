import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { AuditEvent, AuditEventInput, JsonObject } from "../index";
import {
  auditLogClassificationMetadata,
  auditLogSurfaceValues,
  auditLogVisibilityValues,
  auditTemplateSets,
  auditTemplates,
  canonicalJson,
  createAuditEvent,
  createAuditRecorder,
  detectAuditLogClassifiers,
  HASH_ALGORITHM,
  hashAuditEvent,
  hashAuditRecord,
  hashIdempotencyKey,
  MemoryAuditStore,
  verifyAuditRecords,
} from "../index";

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
      expect(hashAuditEvent(conformanceCase.event, conformanceCase.previousHash)).toBe(conformanceCase.expectedHash);
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
      expect(hashIdempotencyKey(conformanceCase.tenantId, conformanceCase.idempotencyKey)).toBe(
        conformanceCase.expectedIdempotencyKeyHash,
      );
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

describe("auditTemplates", () => {
  test("exposes canonical action sets for common integration flows", () => {
    expect(auditTemplateSets.auth).toContain("auth.session.created");
    expect(auditTemplateSets.organization).toContain("org.created");
    expect(auditTemplateSets.agent).toContain("agent.session.started");
    expect(auditTemplateSets.code).toContain("change.files.changed");
    expect(auditTemplateSets.code).toContain("review.waiver.recorded");
  });

  test("exposes audit log classifier metadata helpers and detectors", () => {
    expect(auditLogVisibilityValues).toEqual(["internal", "external", "partner", "system"]);
    expect(auditLogSurfaceValues).toEqual(["api", "app", "worker", "cli", "webhook"]);
    expect(auditLogClassificationMetadata({ visibility: "public", surface: "REST" })).toEqual({
      logVisibility: "external",
      logSurface: "api",
    });
    expect(auditLogClassificationMetadata({ visibility: "staff", surface: "dashboard" })).toEqual({
      logVisibility: "internal",
      logSurface: "app",
    });
    expect(detectAuditLogClassifiers({ auditLog: { visibility: "partner", surface: "webhook" } })).toEqual({
      visibility: "partner",
      surface: "webhook",
    });
    expect(
      detectAuditLogClassifiers({ visibility: "customer", client: { type: "browser" } }),
    ).toEqual({
      visibility: "external",
      surface: "app",
    });
  });

  test("creates auth session events with security context redaction", () => {
    const event = createAuditEvent(
      auditTemplates.auth.signedIn({
        id: "evt_signin",
        occurredAt: "2026-06-20T00:00:00.000Z",
        userId: "usr_123",
        sessionId: "sess_123",
        scope: { tenantId: "org_123", environment: "test" },
        securityContext: {
          ipAddressHash: "sha256:client-ip",
          userAgentHash: "sha256:user-agent",
          location: { country: "US", region: "CA" },
        },
        metadata: {
          authorization: "Bearer secret",
          ...auditLogClassificationMetadata({ visibility: "customer", surface: "api" }),
        },
      }),
    );

    expect(event.action).toBe("auth.session.created");
    expect(event.target).toEqual({ type: "session", id: "sess_123" });
    expect(event.purpose).toBe("access_management");
    expect(event.lawfulBasis).toBe("contract");
    expect(event.metadata).toEqual({
      authorization: "[redacted]",
      logSurface: "api",
      logVisibility: "external",
      securityContext: {
        ipAddressHash: "sha256:client-ip",
        location: { country: "US", region: "CA" },
        userAgentHash: "sha256:user-agent",
      },
    });
  });

  test("defaults organization creation to tenant scope", () => {
    const event = createAuditEvent(
      auditTemplates.organization.created({
        id: "evt_org_created",
        occurredAt: "2026-06-20T00:01:00.000Z",
        organizationId: "org_123",
        actor: { type: "user", id: "usr_123" },
      }),
    );

    expect(event.action).toBe("org.created");
    expect(event.target).toEqual({ type: "organization", id: "org_123" });
    expect(event.scope).toEqual({ tenantId: "org_123" });
  });

  test("preserves template-reserved agent session metadata", () => {
    const event = createAuditEvent(
      auditTemplates.agent.sessionStarted({
        id: "evt_agent_started",
        occurredAt: "2026-06-20T00:02:00.000Z",
        sessionId: "agt_sess_123",
        agentActor: { type: "ai_agent", id: "agent_codex" },
        scope: { tenantId: "org_123" },
        metadata: { sessionId: "caller_shadow", reason: "code_review" },
      }),
    );

    expect(event.action).toBe("agent.session.started");
    expect(event.target).toEqual({ type: "agent_session", id: "agt_sess_123" });
    expect(event.metadata).toEqual({ reason: "code_review", sessionId: "agt_sess_123" });
  });

  test("creates code change events without raw file paths", () => {
    const event = createAuditEvent(
      auditTemplates.code.filesChanged({
        id: "evt_files_changed",
        occurredAt: "2026-06-20T00:03:00.000Z",
        sourceTreeId: "tree_123",
        actor: { type: "ai_agent", id: "agent_codex" },
        scope: { tenantId: "org_123" },
        sessionId: "agt_sess_123",
        fileCount: 2,
        filePathHashes: ["hash_b", "hash_a"],
      }),
    );

    expect(event.action).toBe("change.files.changed");
    expect(event.target).toEqual({ type: "source_tree", id: "tree_123" });
    expect(event.metadata).toEqual({
      fileCount: 2,
      filePathHashes: ["hash_b", "hash_a"],
      sessionId: "agt_sess_123",
    });
  });

  test("adds session grouping to review waiver events", () => {
    const event = createAuditEvent(
      auditTemplates.code.reviewWaiverRecorded({
        id: "evt_review_waiver",
        occurredAt: "2026-06-20T00:04:00.000Z",
        pullRequestId: "pr_123",
        reviewer: { type: "user", id: "usr_reviewer" },
        scope: { tenantId: "org_123" },
        sessionId: "agt_sess_123",
        proposalId: "proposal_123",
        waiverCount: 1,
        metadata: { sessionId: "caller_shadow" },
      }),
    );

    expect(event.action).toBe("review.waiver.recorded");
    expect(event.metadata).toEqual({
      proposalId: "proposal_123",
      sessionId: "agt_sess_123",
      waiverCount: 1,
    });
  });

  test("rejects raw content metadata on agent and code templates", () => {
    const agentActor = { type: "ai_agent" as const, id: "agent_codex" };
    const scope = { tenantId: "org_123" };
    const unsafeCases: Array<{ name: string; build: () => unknown }> = [
      {
        name: "raw prompt",
        build: () =>
          auditTemplates.agent.promptRecorded({
            sessionId: "agt_sess_123",
            promptHash: "sha256:prompt",
            agentActor,
            scope,
            metadata: { prompt: "create a secret-bearing patch" },
          }),
      },
      {
        name: "raw diff",
        build: () =>
          auditTemplates.code.filesChanged({
            sourceTreeId: "tree_123",
            actor: agentActor,
            scope,
            metadata: { diff: "diff --git a/a.ts b/a.ts" },
          }),
      },
      {
        name: "raw hunk",
        build: () =>
          auditTemplates.code.filesChanged({
            sourceTreeId: "tree_123",
            actor: agentActor,
            scope,
            metadata: { hunk: "@@ -1 +1 @@" },
          }),
      },
      {
        name: "raw file path",
        build: () =>
          auditTemplates.code.filesChanged({
            sourceTreeId: "tree_123",
            actor: agentActor,
            scope,
            metadata: { filePath: "src/secrets.ts" },
          }),
      },
      {
        name: "stdout",
        build: () =>
          auditTemplates.agent.toolCalled({
            sessionId: "agt_sess_123",
            toolCallId: "tool_123",
            tool: "shell",
            status: "ok",
            agentActor,
            scope,
            metadata: { stdout: "raw command output" },
          }),
      },
      {
        name: "stderr",
        build: () =>
          auditTemplates.agent.toolCalled({
            sessionId: "agt_sess_123",
            toolCallId: "tool_123",
            tool: "shell",
            status: "failed",
            agentActor,
            scope,
            metadata: { stderr: "raw error output" },
          }),
      },
      {
        name: "tool args",
        build: () =>
          auditTemplates.agent.toolCalled({
            sessionId: "agt_sess_123",
            toolCallId: "tool_123",
            tool: "shell",
            status: "ok",
            agentActor,
            scope,
            metadata: { toolArgs: { command: "cat .env" } },
          }),
      },
      {
        name: "token-like value",
        build: () =>
          auditTemplates.code.changeProposalCreated({
            proposalId: "proposal_123",
            actor: agentActor,
            scope,
            metadata: { note: "Bearer abc.def" },
          }),
      },
    ];

    for (const unsafeCase of unsafeCases) {
      expect(unsafeCase.build, unsafeCase.name).toThrow(/not allowed|looks like raw content/);
    }
  });
});

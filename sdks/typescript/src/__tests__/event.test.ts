import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { AuditEvent, AuditEventInput, EvidenceCommit, EvidenceCommitInput, JsonObject } from "../index";
import {
  auditLogClassificationMetadata,
  auditLogSurfaceValues,
  auditLogVisibilityValues,
  auditTemplateSets,
  auditTemplates,
  canonicalJson,
  createAuditEvent,
  createAuditRecorder,
  createEvidenceCommit,
  detectAuditLogClassifiers,
  EVIDENCE_ENTITY_TYPES,
  episodeStartedTemplate,
  HASH_ALGORITHM,
  hashAuditEvent,
  hashAuditRecord,
  hashEvidenceCommit,
  hashIdempotencyKey,
  MemoryAuditStore,
  verifyAuditRecords,
  verifyEvidenceCommits,
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

interface EvidenceCommitFixture {
  cases: Array<{
    name: string;
    input: EvidenceCommitInput;
    expected?: EvidenceCommit;
    expectedRecordsRoot?: string;
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

describe("evidence commit schema", () => {
  test("requires ordered members and algorithm-qualified commit hashes", async () => {
    const schema = (await Bun.file("spec/evidence-commit.schema.json").json()) as {
      required: string[];
      properties: {
        members: {
          minItems: number;
          items: {
            required: string[];
            properties: {
              index: { minimum: number };
              recordType: { enum: string[] };
              recordHash: { pattern: string };
            };
          };
        };
        previousCommitHash: { anyOf: Array<{ type?: string; pattern?: string }> };
        recordsRoot: { pattern: string };
        hash: { pattern: string };
        treeAlgorithm: { const: string };
      };
    };

    expect(schema.required).toContain("members");
    expect(schema.properties.members.minItems).toBe(1);
    expect(schema.properties.members.items.required).toEqual(["index", "recordType", "recordId", "recordHash"]);
    expect(schema.properties.members.items.properties.index.minimum).toBe(0);
    expect(schema.properties.members.items.properties.recordType.enum).toContain("audit.record");
    expect(schema.properties.members.items.properties.recordType.enum).toContain("evidence.edge.record");
    expect(schema.properties.members.items.properties.recordHash.pattern).toBe("^sha256:[a-f0-9]{64}$");
    expect(schema.properties.previousCommitHash.anyOf.some((variant) => variant.type === "null")).toBe(true);
    expect(schema.properties.recordsRoot.pattern).toBe("^sha256:[a-f0-9]{64}$");
    expect(schema.properties.hash.pattern).toBe("^sha256:[a-f0-9]{64}$");
    expect(schema.properties.treeAlgorithm.const).toBe("veritio-merkle-v1");
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

describe("EvidenceCommit", () => {
  test("matches commit conformance fixtures and sorts members by index", async () => {
    const fixture = await loadConformanceFixture<EvidenceCommitFixture>("evidence-commit.json");
    const [orderedCase, oddCase] = fixture.cases;

    const commit = createEvidenceCommit(orderedCase!.input);
    expect(commit).toEqual(orderedCase!.expected);
    expect(hashEvidenceCommit(commit)).toBe(commit.hash);
    expect(verifyEvidenceCommits([commit])).toEqual({
      ok: false,
      index: 0,
      reason: "previous_hash_mismatch",
    });

    const oddCommit = createEvidenceCommit(oddCase!.input);
    expect(oddCommit.recordsRoot).toBe(oddCase!.expectedRecordsRoot);
  });

  test("rejects empty commits and duplicate members", () => {
    const baseInput: EvidenceCommitInput = {
      commitId: "cmt_empty",
      streamId: "str_fixture",
      sequence: 1,
      previousCommitHash: null,
      committedAt: "2026-06-23T10:15:31.000Z",
      members: [],
    };

    expect(() => createEvidenceCommit(baseInput)).toThrow("members must not be empty");
    expect(() =>
      createEvidenceCommit({
        ...baseInput,
        commitId: "cmt_duplicate",
        members: [
          {
            index: 0,
            recordType: "audit.record",
            recordId: "evt_01",
            recordHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
          {
            index: 1,
            recordType: "audit.record",
            recordId: "evt_01",
            recordHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        ],
      }),
    ).toThrow("duplicate commit member");
  });

  test("verifies commit sequence, previous hash chain, and tampering", () => {
    const first = createEvidenceCommit({
      commitId: "cmt_01",
      streamId: "str_fixture",
      sequence: 1,
      previousCommitHash: null,
      committedAt: "2026-06-23T10:15:31.000Z",
      members: [
        {
          index: 0,
          recordType: "audit.record",
          recordId: "evt_01",
          recordHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
    });
    const second = createEvidenceCommit({
      commitId: "cmt_02",
      streamId: "str_fixture",
      sequence: 2,
      previousCommitHash: first.hash,
      committedAt: "2026-06-23T10:16:31.000Z",
      members: [
        {
          index: 0,
          recordType: "evidence.edge.record",
          recordId: "edge_01",
          recordHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      ],
    });

    expect(verifyEvidenceCommits([first, second])).toEqual({ ok: true });
    expect(verifyEvidenceCommits([{ ...second, previousCommitHash: null }])).toEqual({
      ok: false,
      index: 0,
      reason: "sequence_mismatch",
    });
    expect(verifyEvidenceCommits([first, { ...second, recordCount: 2 }])).toEqual({
      ok: false,
      index: 1,
      reason: "record_count_mismatch",
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

describe("auditTemplates", () => {
  test("exposes canonical action sets for common integration flows", () => {
    expect(auditTemplateSets.auth).toContain("auth.session.created");
    expect(auditTemplateSets.organization).toContain("org.created");
    expect(auditTemplateSets.agent).toContain("agent.session.started");
    expect(auditTemplateSets.code).toContain("change.files.changed");
    expect(auditTemplateSets.code).toContain("review.waiver.recorded");
  });

  test("includes activity_episode in the evidence entity allowlist", () => {
    expect(EVIDENCE_ENTITY_TYPES).toContain("activity_episode");
  });

  test("threads activityEpisodeId un-shadowably onto template metadata", () => {
    const event = createAuditEvent(
      auditTemplates.code.filesChanged({
        id: "evt_files_ep",
        occurredAt: "2026-06-20T00:03:00.000Z",
        sourceTreeId: "tree_123",
        actor: { type: "ai_agent", id: "agent_codex" },
        scope: { tenantId: "org_123" },
        sessionId: "agt_sess_123",
        fileCount: 1,
        activityEpisodeId: "ep_001",
        metadata: { activityEpisodeId: "caller_shadow" },
      }),
    );

    expect(event.metadata.activityEpisodeId).toBe("ep_001");
    expect(event.metadata.sessionId).toBe("agt_sess_123");
  });

  test("builds an activity.episode.started event with episode metadata", () => {
    const event = createAuditEvent(
      episodeStartedTemplate({
        id: "evt_episode_started",
        occurredAt: "2026-06-20T00:05:00.000Z",
        activityEpisodeId: "ep_001",
        actor: { type: "user", id: "usr_admin" },
        scope: { tenantId: "org_123" },
        authSessionId: "ses_123",
        authContextId: "authctx_123",
        domain: "billing",
        startReason: "user_action",
      }),
    );

    expect(event.action).toBe("activity.episode.started");
    expect(event.target).toEqual({ type: "activity_episode", id: "ep_001" });
    expect(event.purpose).toBe("change_provenance");
    expect(event.metadata).toEqual({
      activityEpisodeId: "ep_001",
      authSessionId: "ses_123",
      authContextId: "authctx_123",
      domain: "billing",
      startReason: "user_action",
    });
  });

  test("drops the removed riskScore field from session security context", () => {
    const securityContext = { method: "password", provider: "credentials", riskScore: 0.9 };
    const event = createAuditEvent(
      auditTemplates.auth.signedIn({
        id: "evt_signin_risk",
        occurredAt: "2026-06-20T00:00:00.000Z",
        userId: "usr_123",
        sessionId: "sess_123",
        scope: { tenantId: "org_123", environment: "test" },
        securityContext,
      }),
    );

    expect(event.metadata.securityContext).toEqual({ method: "password", provider: "credentials" });
  });

  test("stamps normalized riskSignals onto template metadata", () => {
    const event = createAuditEvent(
      auditTemplates.code.filesChanged({
        id: "evt_files_risk",
        occurredAt: "2026-06-20T00:06:00.000Z",
        sourceTreeId: "tree_123",
        actor: { type: "ai_agent", id: "agent_codex" },
        scope: { tenantId: "org_123" },
        sessionId: "agt_sess_123",
        riskSignals: { operationType: "delete", dataVolume: 100 },
      }),
    );

    expect(event.metadata.riskSignals).toMatchObject({
      operationType: "delete",
      reversibility: "recoverable",
      envCriticality: "production",
      dataVolume: 100,
    });
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
    expect(detectAuditLogClassifiers({ visibility: "customer", client: { type: "browser" } })).toEqual({
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

describe("verifyEvidenceCommits defensive guards", () => {
  test("fails closed on an empty streamId and a non-string hash (Python parity)", () => {
    const commit = createEvidenceCommit({
      commitId: "cmt_guard",
      streamId: "str_guard",
      sequence: 1,
      previousCommitHash: null,
      committedAt: "2026-06-23T10:15:31.000Z",
      members: [
        {
          index: 0,
          recordType: "audit.record",
          recordId: "evt_guard",
          recordHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
    });

    expect(verifyEvidenceCommits([{ ...commit, streamId: "" }])).toEqual({
      ok: false,
      index: 0,
      reason: "invalid_member_manifest",
    });
    expect(verifyEvidenceCommits([{ ...commit, hash: 123 as unknown as string }])).toEqual({
      ok: false,
      index: 0,
      reason: "hash_mismatch",
    });
  });
});

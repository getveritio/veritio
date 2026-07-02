import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  canonicalJson,
  createAuditEvent,
  createEvidenceCommit,
  EVIDENCE_ENTITY_TYPES,
  type EvidenceCommitInput,
  hashAuditEvent,
  createSecurityRiskAssertion as reexportedCreateAssertion,
} from "../index";
import type {
  EpisodeRiskRollup,
  RiskAssessment,
  RiskSignals,
  SecurityRiskAssertion,
  SecurityRiskAssertionInput,
} from "../risk";
import {
  bandOf,
  buildSecurityRiskAssessedEvent,
  clamp01,
  createSecurityRiskAssertion,
  DEFAULT_RISK_POLICY,
  hashAssertionRecord,
  normalizeRiskSignals,
  rollupEpisodeRisk,
  round4,
  sat,
  scoreRiskSignals,
} from "../risk";

const CONFORMANCE_DIR = join(import.meta.dir, "../../../../spec/conformance");

/** Loads a cross-language conformance fixture authored in spec/conformance. */
async function loadConformanceFixture<T>(fileName: string): Promise<T> {
  return (await Bun.file(join(CONFORMANCE_DIR, fileName)).json()) as T;
}

describe("risk determinism primitives", () => {
  test("clamp01 bounds to the unit interval", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(1.4335)).toBe(1);
  });

  test("round4 rounds half up at four decimals", () => {
    expect(round4(0.001980198)).toBe(0.002);
    expect(round4(1.43351)).toBe(1.4335);
    expect(round4(0.21666666)).toBe(0.2167);
    expect(round4(0.067333333)).toBe(0.0673);
    expect(round4(0.13333333)).toBe(0.1333);
  });

  test("sat is the saturating x/(x+k) curve", () => {
    expect(sat(0, 100)).toBe(0);
    expect(sat(100, 100)).toBe(0.5);
    expect(sat(25, 25)).toBe(0.5);
  });

  test("DEFAULT_RISK_POLICY pins the reference constants", () => {
    expect(DEFAULT_RISK_POLICY.policyVersion).toBe("veritio.reference.v1");
    expect(DEFAULT_RISK_POLICY.operationBase.destructive).toBe(0.85);
    expect(DEFAULT_RISK_POLICY.reversibilityFactor.irreversible).toBe(1.3);
    expect(DEFAULT_RISK_POLICY.envCriticalityFactor.sandbox).toBe(0.4);
    expect(DEFAULT_RISK_POLICY.magnitude.maxBoost).toBe(0.4);
    expect(DEFAULT_RISK_POLICY.rollup.decayPerWindow).toBe(0.5);
  });

  test("bandOf uses half-open policy thresholds", () => {
    const { bands } = DEFAULT_RISK_POLICY;
    expect(bandOf(0.02, bands)).toBe("none");
    expect(bandOf(0.05, bands)).toBe("low");
    expect(bandOf(0.2499, bands)).toBe("low");
    expect(bandOf(0.25, bands)).toBe("medium");
    expect(bandOf(0.49, bands)).toBe("medium");
    expect(bandOf(0.5, bands)).toBe("high");
    expect(bandOf(0.7499, bands)).toBe("high");
    expect(bandOf(0.75, bands)).toBe("critical");
    expect(bandOf(1, bands)).toBe("critical");
  });
});

interface NormalizationFixture {
  cases: Array<{
    name: string;
    input: RiskSignals;
    normalized?: RiskSignals;
    expectError?: boolean;
  }>;
}

describe("normalizeRiskSignals", () => {
  test("matches normalization conformance fixtures", async () => {
    const fixture = await loadConformanceFixture<NormalizationFixture>("risk-signals-normalization.json");
    expect(fixture.cases.length).toBeGreaterThan(0);
    for (const c of fixture.cases) {
      if (c.expectError) {
        expect(() => normalizeRiskSignals(c.input)).toThrow();
      } else {
        expect(normalizeRiskSignals(c.input)).toEqual(c.normalized as RiskSignals);
      }
    }
  });

  test("applies caller metadata after defaults without mutating input", () => {
    const input = { operationType: "create" } as RiskSignals;
    const normalized = normalizeRiskSignals(input);
    expect(normalized).toEqual({
      operationType: "create",
      reversibility: "recoverable",
      envCriticality: "production",
      dataVolume: 0,
      fanOut: 0,
      referenceCount: 0,
    });
    expect(input).toEqual({ operationType: "create" });
  });
});

interface ScoringFixture {
  cases: Array<{
    name: string;
    signals: RiskSignals;
    expected: RiskAssessment;
  }>;
}

describe("scoreRiskSignals", () => {
  test("matches default-policy scoring conformance fixtures", async () => {
    const fixture = await loadConformanceFixture<ScoringFixture>("risk-scoring-default-policy.json");
    expect(fixture.cases.length).toBe(4);
    for (const c of fixture.cases) {
      expect(scoreRiskSignals(c.signals)).toEqual(c.expected);
    }
  });

  test("fails closed on invalid signals before scoring", () => {
    expect(() => scoreRiskSignals({ operationType: "wipe" } as unknown as RiskSignals)).toThrow();
    expect(() => scoreRiskSignals({ operationType: "create", dataVolume: -3 })).toThrow();
  });
});

interface RollupFixture {
  cases: Array<{
    name: string;
    steps: Array<{ occurredAt: string; score: number }>;
    expected: EpisodeRiskRollup;
  }>;
}

describe("rollupEpisodeRisk", () => {
  test("matches episode rollup conformance fixtures", async () => {
    const fixture = await loadConformanceFixture<RollupFixture>("risk-episode-rollup.json");
    expect(fixture.cases.length).toBe(5);
    for (const c of fixture.cases) {
      expect(rollupEpisodeRisk(c.steps)).toEqual(c.expected);
    }
  });

  test("does not mutate the caller's step array", () => {
    const steps = [
      { occurredAt: "2026-06-23T00:01:00.000Z", score: 0.5 },
      { occurredAt: "2026-06-23T00:00:00.000Z", score: 0.3 },
    ];
    rollupEpisodeRisk(steps);
    expect(steps[0]).toEqual({ occurredAt: "2026-06-23T00:01:00.000Z", score: 0.5 });
  });
});

const baseAssertionInput: SecurityRiskAssertionInput = {
  id: "asr_fixture_risk_01",
  scope: { tenantId: "org_fixture_123", workspaceId: "wks_fixture_456", environment: "production" },
  occurredAt: "2026-06-23T00:00:00.000Z",
  producerId: "veritio.detectors.risk",
  subject: { authority: "veritio", kind: "change", type: "billing.plan", id: "chg_fixture_01" },
  idempotencyKey: "risk:chg_fixture_01:step",
  conclusion: { score: 0.612, level: "high", policyVersion: "veritio.reference.v1", assessment: "step" },
  factors: [
    { key: "operationType", value: "destructive", kind: "base", weight: 1, contribution: 0.85 },
    { key: "envCriticality", value: "production", kind: "multiplier", weight: 1, contribution: 1 },
  ],
};

describe("createSecurityRiskAssertion", () => {
  test("builds the assertion.recorded envelope with fixed authorities", () => {
    const assertion = createSecurityRiskAssertion(baseAssertionInput);
    expect(assertion.recordType).toBe("assertion.recorded");
    expect(assertion.schemaVersion).toBe("2026-06-23");
    expect(assertion.recordAuthority).toBe("veritio");
    expect(assertion.type).toBe("security.risk");
    expect(assertion.producer).toEqual({
      authority: "veritio.detectors",
      kind: "principal",
      type: "service",
      id: "veritio.detectors.risk",
    });
    expect(assertion.scope).toEqual({
      tenantId: "org_fixture_123",
      workspaceId: "wks_fixture_456",
      environment: "production",
    });
    expect(assertion.occurredAt).toBe("2026-06-23T00:00:00.000Z");
    expect(assertion.idempotencyKeyHash).toBe("007bb0b51e8fdf6b4099eb4bb1faa04fbf32adb4e8894d1a20e119861111dbe8");
    expect(assertion.subject).toEqual({
      authority: "veritio",
      kind: "change",
      type: "billing.plan",
      id: "chg_fixture_01",
    });
    expect(assertion.conclusion).toEqual({
      score: 0.612,
      level: "high",
      policyVersion: "veritio.reference.v1",
      assessment: "step",
    });
    expect(assertion.factors).toHaveLength(2);
    // Re-serializable: builder output is plain JSON with no extra fields.
    expect(JSON.parse(canonicalJson(assertion)) as SecurityRiskAssertion).toEqual(assertion);
  });

  test("fails closed on missing tenant scope and unknown ref kind", () => {
    expect(() => createSecurityRiskAssertion({ ...baseAssertionInput, scope: { tenantId: "" } })).toThrow(
      "scope.tenantId is required",
    );
    expect(() =>
      createSecurityRiskAssertion({
        ...baseAssertionInput,
        subject: { ...baseAssertionInput.subject, kind: "bogus" as never },
      }),
    ).toThrow("subject.kind must be a supported evidence ref kind");
  });

  test("generates an asr_ id when none supplied", () => {
    const assertion = createSecurityRiskAssertion({ ...baseAssertionInput, id: undefined });
    expect(assertion.id).toMatch(/^asr_/);
  });

  test("fails closed on a non-finite/out-of-range score or unknown level", () => {
    expect(() =>
      createSecurityRiskAssertion({
        ...baseAssertionInput,
        conclusion: { ...baseAssertionInput.conclusion, score: Number.NaN },
      }),
    ).toThrow("conclusion.score must be a finite number in [0,1]");
    expect(() =>
      createSecurityRiskAssertion({
        ...baseAssertionInput,
        conclusion: { ...baseAssertionInput.conclusion, score: -0.1 },
      }),
    ).toThrow("conclusion.score must be a finite number in [0,1]");
    expect(() =>
      createSecurityRiskAssertion({
        ...baseAssertionInput,
        conclusion: { ...baseAssertionInput.conclusion, level: "severe" as never },
      }),
    ).toThrow("conclusion.level must be a known risk level");
  });
});

describe("hashAssertionRecord", () => {
  const assertion: SecurityRiskAssertion = {
    recordType: "assertion.recorded",
    schemaVersion: "2026-06-23",
    recordAuthority: "veritio",
    id: "asr_fixture_risk_01",
    type: "security.risk",
    scope: { tenantId: "org_fixture_123", workspaceId: "wks_fixture_456", environment: "production" },
    occurredAt: "2026-06-23T00:00:00.000Z",
    producer: { authority: "veritio.detectors", kind: "principal", type: "service", id: "veritio.detectors.risk" },
    idempotencyKeyHash: "007bb0b51e8fdf6b4099eb4bb1faa04fbf32adb4e8894d1a20e119861111dbe8",
    subject: { authority: "veritio", kind: "change", type: "billing.plan", id: "chg_fixture_01" },
    conclusion: { score: 0.612, level: "high", policyVersion: "veritio.reference.v1", assessment: "step" },
    factors: [
      { key: "operationType", value: "destructive", kind: "base", weight: 1, contribution: 0.85 },
      { key: "envCriticality", value: "production", kind: "multiplier", weight: 1, contribution: 1 },
    ],
  };

  test("hashes the full canonical assertion as bare hex (hashAuditRecord parity)", () => {
    const expected = createHash("sha256").update(canonicalJson(assertion)).digest("hex");
    expect(hashAssertionRecord(assertion)).toBe(expected);
    expect(hashAssertionRecord(assertion)).toMatch(/^[a-f0-9]{64}$/);
  });

  test("matches the frozen authoritative assertion hash", () => {
    expect(hashAssertionRecord(assertion)).toBe("fd6ee589489fda840e46bc80a999f5c2c95ffb95fafa073070796cd655ec5573");
  });

  test("ignores an embedded hash field (hashAuditRecord parity)", () => {
    // Regression: hashAssertionRecord must strip a stored `hash` before hashing so a
    // persisted digest never feeds back into its own recomputation, matching
    // hashAuditRecord/hashEvidenceEdgeRecord (TS) and Python's key!='hash' filter / Go's rebuild.
    const built = createSecurityRiskAssertion(baseAssertionInput);
    const withoutHash = hashAssertionRecord(built);
    const withEmbeddedHash = hashAssertionRecord({
      ...built,
      hash: "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    } as SecurityRiskAssertion);
    expect(withEmbeddedHash).toBe(withoutHash);
  });
});

describe("buildSecurityRiskAssessedEvent", () => {
  const base = {
    scope: { tenantId: "org_fixture_123", environment: "production" },
    occurredAt: "2026-06-23T00:00:00.000Z",
    producerId: "veritio.detectors.risk",
    subject: { authority: "veritio", kind: "change", type: "billing.plan", id: "chg_fixture_01" } as const,
    conclusion: { score: 0.612, level: "high", policyVersion: "veritio.reference.v1", assessment: "step" } as const,
  };

  test("produces a security.risk.assessed event targeting the subject", () => {
    const event = buildSecurityRiskAssessedEvent({ ...base, activityEpisodeId: "ep_fixture_01" });
    expect(event.action).toBe("security.risk.assessed");
    expect(event.target).toEqual({ type: "billing.plan", id: "chg_fixture_01" });
    expect(event.actor).toEqual({ type: "service", id: "veritio.detectors.risk" });
    expect(event.scope).toEqual({ tenantId: "org_fixture_123", environment: "production" });
    expect(event.occurredAt).toBe("2026-06-23T00:00:00.000Z");
    expect(event.metadata?.activityEpisodeId).toBe("ep_fixture_01");
    expect(event.metadata?.riskAssessment).toEqual({
      score: 0.612,
      level: "high",
      policyVersion: "veritio.reference.v1",
      assessment: "step",
    });
  });

  test("threads activityEpisodeId un-shadowably after caller metadata", () => {
    expect(() => buildSecurityRiskAssessedEvent({ ...base, metadata: { activityEpisodeId: "spoof" } })).toThrow(
      "metadata.activityEpisodeId is reserved by Veritio",
    );
  });

  test("stamps normalized riskSignals when provided", () => {
    const event = buildSecurityRiskAssessedEvent({ ...base, riskSignals: { operationType: "delete" } });
    expect((event.metadata?.riskSignals as { operationType: string }).operationType).toBe("delete");
  });

  test("pins the cross-language assessed-event hash anchor (TS/Python/Go parity)", () => {
    // Frozen tri-language anchor: TS, Python (test_assessed_event_hash_matches_ts_and_go),
    // and Go compute this exact hash for identical inputs. It proves the whole-float
    // canonical-JSON contract (1.0 score, 1.0 multiplier weights render as "1") holds.
    // Inputs (incl. event id) must match the Python anchor fixture byte-for-byte.
    const eventInput = buildSecurityRiskAssessedEvent({
      occurredAt: "2026-06-23T00:00:00.000Z",
      scope: { tenantId: "org_fixture_123", environment: "production" },
      producerId: "veritio.detectors.risk",
      subject: { authority: "veritio", kind: "change", type: "billing.plan", id: "chg_fixture_01" },
      conclusion: { score: 1, level: "critical", policyVersion: "veritio.reference.v1", assessment: "step" },
      activityEpisodeId: "ep_1",
      metadata: { note: "x" },
    });
    eventInput.id = "evt_assessed_fixture";
    const event = createAuditEvent(eventInput);
    expect(hashAuditEvent(event)).toBe("a74bd21afaaae794e7477ac4536bdacccff641e5e9b9b5f305af2644ef997f09");
  });

  test("fails closed on a non-finite or out-of-range conclusion score", () => {
    expect(() =>
      buildSecurityRiskAssessedEvent({
        ...base,
        conclusion: { ...base.conclusion, score: Number.POSITIVE_INFINITY },
      }),
    ).toThrow("conclusion.score must be a finite number in [0,1]");
    expect(() => buildSecurityRiskAssessedEvent({ ...base, conclusion: { ...base.conclusion, score: 1.5 } })).toThrow(
      "conclusion.score must be a finite number in [0,1]",
    );
  });

  test("fails closed on an unknown conclusion level", () => {
    expect(() =>
      buildSecurityRiskAssessedEvent({
        ...base,
        conclusion: { ...base.conclusion, level: "extreme" as never },
      }),
    ).toThrow("conclusion.level must be a known risk level");
  });
});

describe("index re-exports and evidence vocabulary", () => {
  test("adds activity_episode to the evidence entity vocabulary", () => {
    expect(EVIDENCE_ENTITY_TYPES as readonly string[]).toContain("activity_episode");
  });

  test("re-exports the risk assertion surface from the package entrypoint", () => {
    expect(typeof reexportedCreateAssertion).toBe("function");
  });
});

describe("risk signals schema", () => {
  test("constrains the non-PII signal envelope", async () => {
    const schema = (await Bun.file("spec/risk-signals.schema.json").json()) as {
      additionalProperties: boolean;
      required: string[];
      properties: {
        operationType: { enum: string[] };
        reversibility: { enum: string[] };
        envCriticality: { enum: string[] };
        dataVolume: { type: string; minimum: number };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["operationType"]);
    expect(schema.properties.operationType.enum).toContain("destructive");
    expect(schema.properties.reversibility.enum).toEqual(["reversible", "recoverable", "irreversible"]);
    expect(schema.properties.envCriticality.enum).toContain("production");
    expect(schema.properties.dataVolume.type).toBe("integer");
    expect(schema.properties.dataVolume.minimum).toBe(0);
  });
});

describe("security risk assertion schema", () => {
  test("requires the fixed assertion.recorded envelope", async () => {
    const schema = (await Bun.file("spec/security-risk-assertion.schema.json").json()) as {
      additionalProperties: boolean;
      required: string[];
      properties: {
        recordType: { const: string };
        recordAuthority: { const: string };
        type: { const: string };
        producer: { properties: { authority: { const: string } } };
        idempotencyKeyHash: { $ref: string };
        conclusion: { properties: { level: { enum: string[] }; assessment: { enum: string[] } } };
      };
      $defs: { sha256Hex: { pattern: string }; evidenceRef: { properties: { kind: { enum: string[] } } } };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain("conclusion");
    expect(schema.required).toContain("factors");
    expect(schema.properties.recordType.const).toBe("assertion.recorded");
    expect(schema.properties.recordAuthority.const).toBe("veritio");
    expect(schema.properties.type.const).toBe("security.risk");
    expect(schema.properties.producer.properties.authority.const).toBe("veritio.detectors");
    expect(schema.properties.conclusion.properties.level.enum).toContain("critical");
    expect(schema.properties.conclusion.properties.assessment.enum).toEqual(["step", "episode_rollup"]);
    expect(schema.$defs.sha256Hex.pattern).toBe("^[a-f0-9]{64}$");
    expect(schema.$defs.evidenceRef.properties.kind.enum).toContain("commit");
  });
});

describe("security risk assertion conformance", () => {
  test("matches the assertion-builder fixture", async () => {
    const fixture = await loadConformanceFixture<{
      cases: Array<{ name: string; input: SecurityRiskAssertionInput; expected: SecurityRiskAssertion }>;
    }>("security-risk-assertion.json");
    for (const conformanceCase of fixture.cases) {
      expect(createSecurityRiskAssertion(conformanceCase.input)).toEqual(conformanceCase.expected);
    }
  });

  test("matches the assertion hashing fixture", async () => {
    const fixture = await loadConformanceFixture<{
      cases: Array<{ name: string; assertion: SecurityRiskAssertion; expectedHash: string }>;
    }>("assertion-hashing.json");
    for (const conformanceCase of fixture.cases) {
      expect(hashAssertionRecord(conformanceCase.assertion)).toBe(conformanceCase.expectedHash);
    }
  });
});

describe("evidence commit assertion member conformance", () => {
  test("binds an assertion.record member with the authoritative records root", async () => {
    const fixture = await loadConformanceFixture<{
      cases: Array<{ name: string; input: EvidenceCommitInput; expectedRecordsRoot?: string }>;
    }>("evidence-commit.json");
    const assertionCase = fixture.cases.find((c) => c.name === "binds an assertion.record member");
    expect(assertionCase).toBeDefined();
    const commit = createEvidenceCommit(assertionCase!.input);
    expect(commit.members[1]).toEqual({
      index: 1,
      recordType: "assertion.record",
      recordId: "asr_fixture_risk_01",
      recordHash: "sha256:fd6ee589489fda840e46bc80a999f5c2c95ffb95fafa073070796cd655ec5573",
    });
    expect(commit.recordsRoot).toBe(assertionCase!.expectedRecordsRoot);
  });
});

describe("risk redaction conformance", () => {
  test("keeps risk signal/assessment bodies while redacting sensitive siblings", async () => {
    const fixture = await loadConformanceFixture<{
      cases: Array<{ name: string; metadata: Record<string, unknown>; expectedMetadata: Record<string, unknown> }>;
    }>("redaction.json");
    const names = ["preserves the risk signals envelope", "redacts sensitive siblings inside an assertion body"];
    for (const name of names) {
      const conformanceCase = fixture.cases.find((c) => c.name === name);
      expect(conformanceCase).toBeDefined();
      const event = createAuditEvent({
        id: "evt_risk_redaction",
        occurredAt: "2026-06-10T00:00:00.000Z",
        actor: { type: "service", id: "veritio.detectors.risk" },
        action: "security.risk.assessed",
        target: { type: "change", id: "chg_fixture_01" },
        metadata: conformanceCase!.metadata,
      });
      expect(event.metadata).toEqual(conformanceCase!.expectedMetadata);
    }
  });
});

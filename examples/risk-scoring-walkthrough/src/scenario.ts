/**
 * Risk-scoring walkthrough scenario. Everything here is deterministic protocol
 * math from @veritio/core — scoring happens host-side; the Better Auth adapter
 * only translates auth happenings into recorded audit events. The scenario
 * builders return plain data so the test suite (and `verify:examples`) can
 * assert exact scores, bands, and hashes.
 */

import { createBetterAuthVeritioAdapter } from "@veritio/better-auth";
import {
  type AuditRecord,
  createAuditRecorder,
  createSecurityRiskAssertion,
  DEFAULT_RISK_POLICY,
  type EpisodeRiskStep,
  hashAssertionRecord,
  MemoryAuditStore,
  type RiskAssessment,
  riskPolicy,
  rollupEpisodeRisk,
  type SecurityRiskAssertion,
  scoreRiskSignals,
} from "@veritio/core";

export const TENANT_ID = "org_example_risk";

/**
 * Scores three representative operations under the reference policy to show
 * the per-step model: base by operation class, magnitude boosts, and the
 * reversibility/environment multipliers, each with a full factors[] breakdown.
 */
export function scoreOperationSteps(): Record<string, RiskAssessment> {
  return {
    sandboxRead: scoreRiskSignals({ operationType: "read", envCriticality: "sandbox" }),
    stagingBulkUpdate: scoreRiskSignals({
      operationType: "bulk",
      reversibility: "reversible",
      envCriticality: "staging",
      dataVolume: 500,
    }),
    productionDestructive: scoreRiskSignals({
      operationType: "destructive",
      reversibility: "irreversible",
      envCriticality: "production",
      dataVolume: 12000,
    }),
  };
}

/**
 * Scores the same signals under temperature-derived policies to show band
 * movement: one knob, deterministic derivation, auditable policyVersion.
 * 0.5 reproduces the reference policy byte-for-byte (only the version differs).
 */
export function temperatureComparison(): Array<{
  temperature: number;
  score: number;
  level: string;
  policyVersion: string;
}> {
  const signals = { operationType: "delete", envCriticality: "production" } as const;
  return [0.2, 0.5, 0.8].map((temperature) => {
    const assessed = scoreRiskSignals(signals, riskPolicy({ temperature }));
    return { temperature, score: assessed.score, level: assessed.level, policyVersion: assessed.policyVersion };
  });
}

/**
 * Drives the real Better Auth adapter against an in-memory recorder to produce
 * the audit-event stream a host would actually have: a burst of failed logins,
 * an authorization denial, and two successful sign-ins. The adapter never
 * scores — it only records; the returned records feed the rollup below.
 */
export async function recordAuthActivity(): Promise<AuditRecord[]> {
  const store = new MemoryAuditStore();
  const adapter = createBetterAuthVeritioAdapter({
    recorder: createAuditRecorder({ store }),
    environment: "production",
  });

  const records: AuditRecord[] = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    records.push(
      await adapter.recordLoginFailed({
        tenantId: TENANT_ID,
        attemptId: `attempt_${attempt}`,
        reason: "invalid_credentials",
      }),
    );
  }
  records.push(
    await adapter.recordAccessDenied({
      tenantId: TENANT_ID,
      user: { id: "usr_42" },
      resource: { type: "billing.export", id: "exp_9" },
      permission: "billing.export.read",
    }),
  );
  for (const sessionId of ["sess_1", "sess_2"]) {
    records.push(
      await adapter.recordSessionCreated({
        tenantId: TENANT_ID,
        user: { id: "usr_42" },
        session: { id: sessionId },
      }),
    );
  }
  return records;
}

/**
 * Maps recorded audit events to episode rollup steps. The host chooses the
 * per-action signals; auth probes are deliberately low-risk per step (read /
 * production => 0.05) so the burst detection, not the step score, does the
 * escalation work. The step keeps the record's own occurredAt and action.
 */
export function stepsFromRecords(records: AuditRecord[]): EpisodeRiskStep[] {
  return records.map((record) => ({
    occurredAt: record.event.occurredAt,
    score: scoreRiskSignals({ operationType: "read", envCriticality: "production" }).score,
    action: record.event.action,
  }));
}

/**
 * The walkthrough's burst policy: >=5 failed logins inside any 300s window, or
 * >=3 authorization denials inside 120s, escalate the episode. Overrides
 * require an explicit policyVersion so the tuned policy is honestly labeled.
 */
export function burstPolicy() {
  return riskPolicy({
    overrides: {
      policyVersion: "example.auth-burst.v1",
      rollup: {
        frequencyRules: [
          { actions: ["auth.login.failed"], windowSeconds: 300, threshold: 5, boost: 0.8 },
          { actions: ["authz.access.denied"], windowSeconds: 120, threshold: 3, boost: 0.6 },
        ],
      },
    },
  });
}

/**
 * Re-times the same steps ten minutes apart from a fixed base instant. Same
 * actions, same per-step scores — only the cadence changes, which is exactly
 * what frequency rules and momentum decay react to.
 */
export function spreadSteps(steps: EpisodeRiskStep[], gapSeconds = 600): EpisodeRiskStep[] {
  const baseMs = Date.parse("2026-07-04T00:00:00.000Z");
  return steps.map((step, index) => ({
    ...step,
    occurredAt: new Date(baseMs + index * gapSeconds * 1000).toISOString(),
  }));
}

/**
 * Publishes the burst rollup as a security.risk assertion: the builder stamps
 * the deterministic envelope around the precomputed conclusion (it never
 * rescores), and hashAssertionRecord pins the canonical digest. Factors carry
 * only policy tokens/numbers — never freeform or user-derived text.
 */
export function assertEpisodeRollup(rollup: { score: number; level: string; policyVersion: string }): {
  assertion: SecurityRiskAssertion;
  hash: string;
} {
  const assertion = createSecurityRiskAssertion({
    id: "asr_walkthrough_episode",
    scope: { tenantId: TENANT_ID, environment: "production" },
    occurredAt: "2026-07-04T00:10:00.000Z",
    producerId: "example.risk.walkthrough",
    subject: { authority: "veritio", kind: "activity", type: "activity_episode", id: "ep_walkthrough_1" },
    idempotencyKey: "ep_walkthrough_1:rollup",
    conclusion: {
      score: rollup.score,
      level: rollup.level as SecurityRiskAssertion["conclusion"]["level"],
      policyVersion: rollup.policyVersion,
      assessment: "episode_rollup",
    },
    factors: [],
  });
  return { assertion, hash: hashAssertionRecord(assertion) };
}

/** Convenience wrapper: reference-policy rollup used for comparisons in tests. */
export function referenceRollup(steps: EpisodeRiskStep[]) {
  return rollupEpisodeRisk(steps, DEFAULT_RISK_POLICY);
}

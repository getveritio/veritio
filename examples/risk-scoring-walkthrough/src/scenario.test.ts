/**
 * Example-driven verification: the auth event stream comes from the real
 * Better Auth adapter (no synthetic seeding), scoring/rollup/assertions come
 * from @veritio/core, and every expectation is deterministic protocol math.
 */

import { describe, expect, test } from "bun:test";
import { DEFAULT_RISK_POLICY, riskPolicy, rollupEpisodeRisk } from "@veritio/core";
import {
  assertEpisodeRollup,
  burstPolicy,
  recordAuthActivity,
  referenceRollup,
  scoreOperationSteps,
  spreadSteps,
  stepsFromRecords,
  temperatureComparison,
} from "./scenario";

describe("per-step scoring", () => {
  test("scores the walkthrough operations deterministically", () => {
    const steps = scoreOperationSteps();
    expect(steps.sandboxRead.score).toBe(0.02);
    expect(steps.sandboxRead.level).toBe("none");
    expect(steps.stagingBulkUpdate.level).toBe("medium");
    expect(steps.productionDestructive.score).toBe(1);
    expect(steps.productionDestructive.level).toBe("critical");
    expect(steps.productionDestructive.factors).toHaveLength(6);
  });
});

describe("temperature", () => {
  test("temperature 0.5 reproduces the reference policy values", () => {
    const derived = riskPolicy({ temperature: 0.5 });
    expect(derived.policyVersion).toBe("veritio.reference.v1+temp0.50");
    expect({ ...derived, policyVersion: DEFAULT_RISK_POLICY.policyVersion }).toEqual(DEFAULT_RISK_POLICY);
  });

  test("the same signals band differently across temperatures", () => {
    const [lenient, reference, strict] = temperatureComparison();
    expect(lenient?.policyVersion).toBe("veritio.reference.v1+temp0.20");
    expect(reference?.policyVersion).toBe("veritio.reference.v1+temp0.50");
    expect(strict?.policyVersion).toBe("veritio.reference.v1+temp0.80");
    // delete/production: 0.7 base; multipliers scale with temperature.
    expect(lenient?.score).toBeLessThan(strict?.score as number);
    expect(reference?.level).toBe("high");
    expect(strict?.level).toBe("critical");
  });
});

describe("failed-login burst via the Better Auth adapter", () => {
  test("burst escalates while the same actions spread out do not", async () => {
    const records = await recordAuthActivity();
    expect(records.map((r) => r.event.action)).toEqual([
      "auth.login.failed",
      "auth.login.failed",
      "auth.login.failed",
      "auth.login.failed",
      "auth.login.failed",
      "authz.access.denied",
      "auth.session.created",
      "auth.session.created",
    ]);

    const steps = stepsFromRecords(records);
    const policy = burstPolicy();

    // Recorded back-to-back: all five failures land inside one 300s window.
    const burst = rollupEpisodeRisk(steps, policy);
    expect(burst.frequencyScore).toBe(0.8);
    expect(burst.score).toBe(0.8);
    expect(burst.level).toBe("critical");
    const loginRule = burst.frequencyMatches?.find((m) => m.actions.includes("auth.login.failed"));
    expect(loginRule?.fired).toBe(true);
    expect(loginRule?.count).toBe(5);
    const denyRule = burst.frequencyMatches?.find((m) => m.actions.includes("authz.access.denied"));
    expect(denyRule?.fired).toBe(false);
    expect(denyRule?.boost).toBe(0);

    // Same actions, ten minutes apart: no window ever holds five failures.
    const drip = rollupEpisodeRisk(spreadSteps(steps), policy);
    expect(drip.frequencyScore).toBe(0);
    expect(drip.score).toBe(0.05);
    expect(drip.level).toBe("low");

    // Without frequency rules the reference rollup never sees the burst.
    const reference = referenceRollup(steps);
    expect(reference.level).toBe("low");
    expect("frequencyScore" in reference).toBe(false);
  });
});

describe("security.risk assertion", () => {
  test("publishes the rollup conclusion with a stable canonical hash", async () => {
    const steps = stepsFromRecords(await recordAuthActivity());
    const rollup = rollupEpisodeRisk(spreadSteps(steps, 30), burstPolicy());
    expect(rollup.level).toBe("critical");

    const first = assertEpisodeRollup(rollup);
    const second = assertEpisodeRollup(rollup);
    expect(first.assertion.conclusion.assessment).toBe("episode_rollup");
    expect(first.assertion.conclusion.policyVersion).toBe("example.auth-burst.v1");
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.hash).toBe(first.hash);
  });
});

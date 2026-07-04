---
name: veritio-risk-scoring
description: Use when scoring operation risk with the Veritio SDK — attaching riskSignals to audit events, rolling up episode risk, tuning policy strictness with a temperature knob, detecting action bursts like repeated failed logins (frequency rules), or publishing security.risk assertions via @veritio/core.
license: Apache-2.0
---

# Veritio Risk Scoring

## Overview

Deterministic, explainable risk math from `@veritio/core` (>= 0.2.0): the same
signals produce byte-identical scores in TypeScript, Python, and Go. No ML, no
randomness — auditable policy constants only. Scoring happens HOST-side; Veritio
adapters and servers never score. Do not guess API names — use these verbatim.

## Quick Reference

| Task | API |
|---|---|
| Score one operation | `scoreRiskSignals(signals, policy?)` → `{ score, level, policyVersion, factors }` |
| Attach signals to event metadata | `withRiskSignals(metadata, signals)` |
| Roll up an episode | `rollupEpisodeRisk(steps, policy?)` → `{ score, level, peak, velocityScore, stepCount, policyVersion, frequencyScore?, frequencyMatches? }` |
| One-knob policy tuning | `riskPolicy({ temperature })` — 0 lenient, 0.5 = reference, 1 strict |
| Granular tuning | `riskPolicy({ temperature?, overrides: { policyVersion: "...", ... } })` |
| Publish a conclusion | `createSecurityRiskAssertion(...)` + `hashAssertionRecord(...)` |
| Browser/edge bundle | import from `@veritio/core/risk-score` (crypto-free subpath) |

Python: `score_risk_signals`, `rollup_episode_risk`, `risk_policy`,
`with_risk_signals`. Go: `ScoreRiskSignals`, `RollupEpisodeRisk`, `RiskPolicy`,
`WithRiskSignals` (policy is an explicit argument in Go).

## Signals and Scoring

```ts
import { riskPolicy, rollupEpisodeRisk, scoreRiskSignals } from "@veritio/core/risk-score";

const step = scoreRiskSignals({
  operationType: "delete",        // read|create|update|config|bulk|permission|delete|destructive
  reversibility: "irreversible",  // reversible|recoverable|irreversible (default: recoverable)
  envCriticality: "production",   // sandbox|development|staging|production (default: production)
  dataVolume: 250,                // non-negative integers; invalid values THROW (fail-closed)
});
// step.score in [0,1], step.level "none".."critical", step.factors[] explains every contribution
```

Temperature derives a full policy from the pinned reference constants
(`veritio.reference.v1`). It must be a multiple of 0.01 in [0,1]; 0.5 equals the
reference policy byte-for-byte; the derived `policyVersion` is e.g.
`veritio.reference.v1+temp0.80`. Any `overrides` REQUIRE an explicit
`overrides.policyVersion` or the call throws — hand-tuned policies must be
honestly labeled in hashed conclusions.

## Burst Detection (frequency rules)

"N matching actions inside a time window raise the episode score" — e.g. failed
logins:

```ts
const policy = riskPolicy({
  overrides: {
    policyVersion: "acme.auth-burst.v1",
    rollup: { frequencyRules: [
      { actions: ["auth.login.failed"], windowSeconds: 300, threshold: 5, boost: 0.8 },
    ]},
  },
});
const rollup = rollupEpisodeRisk(
  events.map((e) => ({ occurredAt: e.occurredAt, score: 0.05, action: e.action })),
  policy,
);
// >=5 failures inside any 300s window: rollup.frequencyScore 0.8 → level "critical".
// Rules fire once per episode and can only RAISE a score, never lower it.
```

Steps without an `action` never match. `actions` strings are policy
configuration — never put freeform or user-derived text in them.

## Assertions (publishing conclusions)

`createSecurityRiskAssertion` stamps a deterministic envelope around a
PRECOMPUTED conclusion (it never rescores); `hashAssertionRecord` pins the
canonical SHA-256. The assertion body is NOT redacted — `factors[].value` must
only ever be policy tokens or numbers, never emails/names/freeform text.

## Common Mistakes

- Scoring inside a framework adapter or the Veritio server — scoring is
  host/detector-side only.
- Passing floats like `temperature: 0.005` or magnitudes like `dataVolume: 2.5`
  — both throw; the math is fail-closed by design.
- Supplying `overrides` without `policyVersion` — throws.
- Importing `@veritio/core` (barrel) into a browser bundle — drags in
  `node:crypto`; use `@veritio/core/risk-score`.
- Expecting frequency rules to lower scores or fire per-match — they max-join
  once per episode.

Full model: `docs/risk-scoring.md`; normative algorithm: `spec/risk-scoring.md`
in https://github.com/getveritio/veritio. Runnable demo:
`examples/risk-scoring-walkthrough`.

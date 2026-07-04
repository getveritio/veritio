# Risk Scoring

Veritio turns structured **risk signals** about an operation into a
deterministic, explainable score. Scoring is evidence support, not legal advice,
and never a compliance guarantee. The same signals produce byte-identical scores
in the TypeScript, Python, and Go SDKs so a score recorded by one runtime can be
verified by another.

## Risk signals

A caller describes one operation with `RiskSignals`:

```ts
RiskSignals {
  operationType: "read" | "create" | "update" | "config" | "bulk"
              | "permission" | "delete" | "destructive";
  reversibility?: "reversible" | "recoverable" | "irreversible";
  envCriticality?: "sandbox" | "development" | "staging" | "production";
  dataVolume?: number;      // non-negative integer
  fanOut?: number;          // non-negative integer
  referenceCount?: number;  // non-negative integer
}
```

`normalizeRiskSignals` fails closed: unknown enums and negative, fractional,
`NaN`, or `Infinity` magnitudes throw rather than silently scoring low. Absent
enums default to the most conservative class (`reversibility = 'recoverable'`,
`envCriticality = 'production'`) and absent magnitudes default to `0`, so an
omitted signal can never lower risk below an explicit zero.

Signals ride on event metadata at `metadata.riskSignals` via `withRiskSignals`
(`with_risk_signals` in Python, `WithRiskSignals` in Go). The envelope is stamped
*after* caller metadata, so a host can never shadow the scored signals, and the
stored value is always the fully-defaulted, byte-stable normalized shape the
scorer reads.

## Deterministic scoring (identical bytes across TS/Python/Go)

The normative algorithm spec lives at
[`spec/risk-scoring.md`](../spec/risk-scoring.md); where prose and the
conformance fixtures could disagree, the fixtures win.

Scoring uses only primitives with no `ln`/`exp`/`pow`, so every runtime emits the
same bytes:

- `clamp01(x)` — clamp to the inclusive `[0,1]` unit interval.
- `round4(x)` — round half-up to four decimals using `floor` + integer
  arithmetic only.
- `sat(x, K) = x / (x + K)` — a saturating magnitude curve (0 at zero,
  asymptotic to 1) so large counts add boost without exceeding `maxBoost`.
- Episode decay — `decayPerWindow` applied once per whole elapsed window by
  repeated multiply, never `Math.pow`.

**Per step.** Score an operation base, add saturating boosts for the magnitude
signals, then scale by the reversibility and environment-criticality multipliers,
clamped and banded:

```
score = clamp01(round4(
  (operationBase + dataVolumeBoost + fanOutBoost + referenceCountBoost)
  * reversibilityFactor * envCriticalityFactor
))
```

Each step returns its full `factors[]` breakdown (base seed, additive boosts,
multipliers) for explainability. The factor order and the
`multiplier weight == contribution` convention are part of the conformance
contract pinned by `spec/conformance/risk-scoring-default-policy.json`.

A `security.risk` assertion is a standalone record, not an audit event, so it is
**not** run through `redactMetadata`. A `RiskFactor.value` must therefore only ever
be a stable policy token (the signal key/enum) or a normalized number — never
freeform, caller-supplied, or user-derived text. The SDK scorer only ever emits
tokens; a host that hand-builds factors is responsible for keeping PII out of
`value`, since the assertion body is preserved verbatim for integrity.

**Episode rollup.** `rollupEpisodeRisk` folds a sequence of per-step scores into
one episode summary. Steps are sorted by `occurredAt` ascending (non-mutating);
momentum carries forward with integer-window decay so a burst of risky steps
escalates while quiet gaps cool off. The rollup reports `peak` (max raw step
score), `velocityScore` (normalized peak momentum), and the banded episode
`score = max(peak, velocityScore)` — plus a `frequencyScore` component when the
policy configures [frequency rules](#frequency-rules).

## The scoring policy

`scoreRiskSignals(signals, policy?)` and `rollupEpisodeRisk(steps, policy?)`
both accept an optional `RiskScoringPolicy` and default to
`DEFAULT_RISK_POLICY` (`policyVersion: 'veritio.reference.v1'`). The math shape
is fixed — a policy only retunes constants. The full field reference, with the
reference values:

| Field | Reference value | Meaning |
|---|---|---|
| `policyVersion` | `veritio.reference.v1` | Recorded on every assessment/rollup so conclusions stay auditable |
| `operationBase.read / create / update / config / bulk / permission / delete / destructive` | `0.05 / 0.20 / 0.30 / 0.45 / 0.55 / 0.60 / 0.70 / 0.85` | Base score seeded by the operation class |
| `reversibilityFactor.reversible / recoverable / irreversible` | `0.6 / 1.0 / 1.3` | Multiplier for how recoverable the operation is |
| `envCriticalityFactor.sandbox / development / staging / production` | `0.4 / 0.6 / 0.8 / 1.0` | Multiplier for deployment criticality |
| `magnitude.maxBoost` | `0.40` | Ceiling on the combined additive magnitude boost |
| `magnitude.weights.dataVolume / fanOut / referenceCount` | `0.5 / 0.3 / 0.2` | Share of `maxBoost` each magnitude signal can contribute |
| `magnitude.k.dataVolume / fanOut / referenceCount` | `100 / 25 / 50` | Saturation constants for `sat(x, K) = x / (x + K)` |
| `bands.low / medium / high / critical` | `0.05 / 0.25 / 0.50 / 0.75` | Half-open band thresholds (`none` below `low`, `critical` at/above `critical`) |
| `rollup.windowSeconds` | `60` | Decay window for episode momentum |
| `rollup.decayPerWindow` | `0.5` | Momentum multiplier applied once per whole elapsed window |
| `rollup.velocityNormalizer` | `3.0` | Divisor turning peak momentum into `velocityScore` |
| `rollup.frequencyRules` | `[]` | Optional per-action burst rules (see below) |

These reference constants are the cross-language contract: changing any value in
`DEFAULT_RISK_POLICY` is a protocol change and must update the TypeScript,
Python, and Go SDKs and the conformance fixtures together.

## Custom policies and temperature

A host (or hosted product) may supply a retuned policy. The easy path is the
`riskPolicy` helper (`risk_policy` in Python, `RiskPolicy` in Go), which derives
a complete policy from the reference constants:

```ts
import { riskPolicy, scoreRiskSignals } from "@veritio/core/risk-score";

// One knob: 0 = most lenient, 0.5 = the reference policy, 1 = strictest.
const strict = riskPolicy({ temperature: 0.8 });
scoreRiskSignals({ operationType: "delete", envCriticality: "production" }, strict);
```

**Temperature** must be a multiple of `0.01` in `[0, 1]` (fail-closed
otherwise). `0.5` reproduces the reference values exactly; lower temperatures
raise band thresholds, speed up momentum decay, and soften the
irreversible/production multipliers; higher temperatures do the opposite.
Derivation is pure two-segment linear interpolation with `round4` (no
`pow`/`exp`), so all three SDKs derive byte-identical policies — pinned by
`spec/conformance/risk-policy-temperature.json`. Only these fields scale:
`bands.*`, `rollup.decayPerWindow`, `rollup.velocityNormalizer`,
`magnitude.maxBoost`, `reversibilityFactor.irreversible`, and
`envCriticalityFactor.production`; everything else keeps its reference value.

The derived `policyVersion` is deterministic and built from integer hundredths,
never float formatting: `riskPolicy({ temperature: 0.7 })` yields
`veritio.reference.v1+temp0.70`.

**Overrides** deep-merge *after* temperature derivation for granular tuning:

```ts
const tuned = riskPolicy({
  temperature: 0.7,
  overrides: {
    policyVersion: "acme.custom.v3", // REQUIRED whenever overrides are present
    magnitude: { maxBoost: 0.5 },
  },
});
```

Any override makes the policy hand-tuned, so `overrides.policyVersion` is
mandatory (the call fails closed without it) — an automatic `+temp` suffix must
never misrepresent overridden constants in a hashed conclusion.
`rollup.frequencyRules` in overrides replaces the rule list wholesale, never
merges it.

## Frequency rules

`policy.rollup.frequencyRules` adds per-action burst detection to the episode
rollup — "N matching actions within a time window raise the episode score."
Each rollup step may carry an optional freeform `action` (a dotted Veritio
event action); steps without one never match a rule:

```ts
import { riskPolicy, rollupEpisodeRisk } from "@veritio/core/risk-score";

const policy = riskPolicy({
  overrides: {
    policyVersion: "acme.auth-burst.v1",
    rollup: {
      frequencyRules: [
        // >= 5 failed logins inside any 300s window adds a 0.8 boost.
        { actions: ["auth.login.failed"], windowSeconds: 300, threshold: 5, boost: 0.8 },
      ],
    },
  },
});

const rollup = rollupEpisodeRisk(
  failedLogins.map((e) => ({ occurredAt: e.occurredAt, score: 0.1, action: e.action })),
  policy,
);
// rollup.frequencyScore === 0.8, rollup.level === "critical"
```

Semantics (pinned by `spec/conformance/risk-episode-frequency.json`): for each
rule, the rollup counts steps whose `action` exact-matches one of the rule's
`actions` inside an inclusive sliding window of `windowSeconds`; a rule fires at
most once per episode when any window reaches `threshold`. The episode
`frequencyScore` is the clamped sum of fired boosts and the final score becomes
`max(peak, velocityScore, frequencyScore)` — so frequency rules can only raise
an episode score, never lower it. With no rules configured the rollup output is
byte-identical to the pre-frequency protocol and carries no frequency fields.
`frequencyMatches` reports every configured rule (fired or not) for
explainability.

Rule fields are validated fail-closed: `actions` must be non-empty strings,
`windowSeconds` finite and positive, `threshold` an integer of at least 1, and
`boost` finite and non-negative. Action strings are policy configuration, not
user input — never put freeform or user-derived text in them.

## Where scoring lives

Scoring lives entirely in the SDK risk module (`risk.ts` / `risk.py` / `risk.go`)
and the template plumbing. `createAuditEvent` knows nothing about scoring or
domain risk — it only redacts and hashes. Framework adapters and the local
server never score: they thread signals and persist precomputed conclusions.

## Assertions

When a risk conclusion crosses a band, detectors (in Veritio Cloud) append a
`security.risk.assessed` audit event and a `security.risk` assertion record. The
OSS SDK ships only the builders:

- `buildSecurityRiskAssessedEvent` returns the `security.risk.assessed`
  `AuditEventInput` (the host recorder runs redaction + hashing).
- `createSecurityRiskAssertion` builds the append-only assertion envelope
  (`recordType: 'assertion.recorded'`, `schemaVersion: '2026-06-23'`,
  `recordAuthority: 'veritio'`, `producer.authority: 'veritio.detectors'`), with
  a tenant-scoped hashed idempotency key and the precomputed
  `conclusion { score, level, policyVersion, assessment }` plus `factors[]`.
- `hashAssertionRecord` produces the canonical SHA-256 digest (parity with
  `hashAuditRecord`).

The assertion builders never recompute a score — they stamp the deterministic
envelope around a conclusion the caller already computed. Evidence linkage is by
`based_on` edges from the assertion to its subject, never an inline `evidence[]`
field. The local self-hosted server (`server/node`) is a **sink**:
`recordAssertion` persists the conclusion byte-for-byte, hashes it for integrity,
and emits the `based_on` edge; it never imports `scoreRiskSignals` or
`rollupEpisodeRisk`.

## Activity episodes

Risk is grouped by **activity episode**: a stable id (entity type
`activity_episode`) that ties one agent session's events together. Every event a
session emits carries `metadata.activityEpisodeId` (stamped by the recorder after
caller metadata, the same mechanism as `metadata.sessionId`), so step scores can
be rolled up per episode. See [ai-integration.md](./ai-integration.md) for how
the Claude Code capture adapter threads the episode id.

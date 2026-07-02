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
`score = max(peak, velocityScore)`.

## Reference policy

`DEFAULT_RISK_POLICY` (`policyVersion: 'veritio.reference.v1'`) pins the exact
constants — operation bases, reversibility/criticality factors, magnitude weights
and saturation constants, band thresholds, and rollup window/decay/normalizer.
These constants are the cross-language contract: changing any value is a protocol
change and must update the TypeScript, Python, and Go SDKs and the conformance
fixtures together. Hosted products may supply a retuned policy, but the math shape
is fixed.

Bands map a `0..1` score to a level with half-open thresholds: `none` below
`low`, then `low`/`medium`/`high`, and `critical` at or above the critical
threshold.

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

# Risk Scoring Algorithm (normative)

This document specifies the deterministic risk-scoring math so an independent
implementation can reproduce byte-identical scores without reading SDK source.
The reference implementations live in the TypeScript, Python, and Go SDKs and
are pinned to each other by the `spec/conformance/risk-*.json` fixtures; where
this prose and a conformance fixture could ever disagree, the fixture wins.

All arithmetic is IEEE-754 double precision using ONLY comparison, addition,
multiplication, division, and floor — never `pow`, `exp`, or `log` — evaluated
in the operation order written here so every language produces identical bytes.
Shared primitives:

```
clamp01(x) = min(1, max(0, x))
round4(x)  = floor(x * 10000 + 0.5) / 10000          // round half-up, 4 decimals
sat(x, K)  = x / (x + K)                             // saturating magnitude curve
```

| Concern | TypeScript | Python | Go |
|---|---|---|---|
| Signal normalization | `normalizeRiskSignals` | `normalize_risk_signals` | `NormalizeRiskSignals` |
| Per-step score | `scoreRiskSignals` | `score_risk_signals` | `ScoreRiskSignals` |
| Episode rollup | `rollupEpisodeRisk` | `rollup_episode_risk` | `RollupEpisodeRisk` |
| Policy derivation | `riskPolicy` | `risk_policy` | `RiskPolicy` |
| Banding | `bandOf` | `band_of` | `BandOf` |

## 1. Signal normalization (fixture: `risk-signals-normalization.json`)

`RiskSignals` normalization fails closed:

1. `operationType` must be one of `read`, `create`, `update`, `config`,
   `bulk`, `permission`, `delete`, `destructive`; anything else errors.
2. Absent `reversibility` defaults to `recoverable`; absent `envCriticality`
   defaults to `production` (the conservative classes). Unknown values error.
3. Magnitudes (`dataVolume`, `fanOut`, `referenceCount`): absent becomes `0`;
   present values must be finite non-negative integers (booleans, `NaN`,
   `±Infinity`, fractional, and negative values error).

## 2. Per-step score (fixture: `risk-scoring-default-policy.json`)

With normalized signals and a policy:

```
dvBoost = round4(maxBoost * weights.dataVolume     * sat(dataVolume,     k.dataVolume))
foBoost = round4(maxBoost * weights.fanOut         * sat(fanOut,         k.fanOut))
rcBoost = round4(maxBoost * weights.referenceCount * sat(referenceCount, k.referenceCount))
score   = clamp01(round4(
            (operationBase[operationType] + dvBoost + foBoost + rcBoost)
            * reversibilityFactor[reversibility]
            * envCriticalityFactor[envCriticality]))
```

The assessment reports exactly six `factors` in this fixed order:
`operationType` (kind `base`, weight `1`, contribution = base), `dataVolume`,
`fanOut`, `referenceCount` (kind `additive`, weight = the magnitude weight,
contribution = the round4 boost), then `reversibility` and `envCriticality`
(kind `multiplier`, where `weight == contribution ==` the factor). Factor
`value` fields are only signal enums or normalized numbers — never freeform
text.

## 3. Episode rollup (fixture: `risk-episode-rollup.json`)

Steps `{occurredAt, score, action?}` are sorted ascending by `occurredAt`
(stable sort; the input is never mutated). Momentum then folds left to right:

```
windows(gapMs)  = floor(max(0, gapMs / 1000) / windowSeconds)
decay(gapMs)    = decayPerWindow multiplied windows(gapMs) times   // repeated multiply, never pow
momentum[i]     = round4(score[i] + momentum[i-1] * decay(gap))    // momentum[-1] = 0
peak            = max raw step score
velocityScore   = clamp01(round4(maxMomentum / velocityNormalizer))
score           = clamp01(round4(max(peak, velocityScore)))        // no frequency rules configured
```

An empty episode yields all zeros with level `none`. A non-positive gap is zero
windows (full momentum carry).

## 4. Frequency rules (fixture: `risk-episode-frequency.json`)

`policy.rollup.frequencyRules` is a list of
`{actions, windowSeconds, threshold, boost}`. Validation fails closed before
any scoring: `actions` non-empty array of non-empty strings; `windowSeconds`
finite, `> 0`; `threshold` integer `>= 1`; `boost` finite, `>= 0`. A policy
without the `frequencyRules` member is treated as an empty rule list.

Evaluation, per rule, over the time-sorted steps:

1. Select qualifying steps: those whose `action` exact-matches one of the
   rule's `actions`. Steps without an `action` never qualify.
2. Slide an inclusive window over the qualifying steps' millisecond
   timestamps: for each end index, advance the start index while
   `endMs - startMs > windowSeconds * 1000`; the window count is
   `end - start + 1`. `count` is the maximum window count observed.
3. The rule fires at most once per episode when `count >= threshold`; a fired
   rule contributes its `boost` once.

```
frequencyScore = clamp01(round4(sum of fired boosts))
score          = clamp01(round4(max(peak, velocityScore, frequencyScore)))
```

Frequency rules can only raise an episode score, never lower it. When at least
one rule is configured the rollup additionally reports `frequencyScore` and
`frequencyMatches` (one entry per configured rule: `actions`, `windowSeconds`,
`threshold`, `count`, `fired`, and the applied `boost`, `0` when unfired). With
zero rules configured neither member is present and the output is byte-identical
to §3.

## 5. Temperature-derived policies (fixture: `risk-policy-temperature.json`)

`riskPolicy({temperature?, overrides?})` derives a complete policy from the
reference constants (`veritio.reference.v1`).

**Temperature validation.** `temperature` must be finite, within `[0, 1]`, and
a multiple of `0.01`: with `hundredths = round(temperature * 100)`, the value
is rejected when `|temperature * 100 - hundredths| > 1e-9`. Anything else
errors.

**Derivation.** Each scaled field interpolates between pinned
lenient (`t = 0`) / reference (`t = 0.5`) / strict (`t = 1`) endpoints:

```
lerp(L, R, S, t) = t <= 0.5 ? round4(L + (R - L) * (t / 0.5))
                            : round4(R + (S - R) * ((t - 0.5) / 0.5))
```

| Field | Lenient (t=0) | Reference (t=0.5) | Strict (t=1) |
|---|---|---|---|
| `bands.low` | 0.10 | 0.05 | 0.02 |
| `bands.medium` | 0.35 | 0.25 | 0.18 |
| `bands.high` | 0.60 | 0.50 | 0.40 |
| `bands.critical` | 0.85 | 0.75 | 0.65 |
| `rollup.decayPerWindow` | 0.30 | 0.50 | 0.70 |
| `rollup.velocityNormalizer` | 4.00 | 3.00 | 2.00 |
| `magnitude.maxBoost` | 0.25 | 0.40 | 0.60 |
| `reversibilityFactor.irreversible` | 1.15 | 1.30 | 1.60 |
| `envCriticalityFactor.production` | 0.90 | 1.00 | 1.20 |

Every other policy field keeps its reference value. `t = 0.5` reproduces the
reference constants exactly.

**Derived policyVersion.** Built from integer `hundredths` only — never float
formatting: `"veritio.reference.v1" + "+temp" + (hundredths div 100) + "." +
zeroPad2(hundredths mod 100)`, e.g. `veritio.reference.v1+temp0.70`. Omitting
`temperature` (and overrides) returns the reference policy with the unsuffixed
version.

**Overrides.** Applied after derivation via explicit enumerated merge: one
level into `operationBase`, `reversibilityFactor`, `envCriticalityFactor`,
`bands`, `rollup`; two levels into `magnitude.weights` / `magnitude.k`;
`rollup.frequencyRules` replaces wholesale. Whenever any override is supplied,
`overrides.policyVersion` (non-empty string) is mandatory; its absence errors,
so a hand-tuned policy is never misrepresented by a temperature version
string.

**Post-derivation check.** The final policy (after overrides) must have all
finite numeric leaves, strictly ascending bands, positive multiplier factors,
positive `windowSeconds`/`velocityNormalizer`, and a non-empty
`policyVersion`; violations error.

## 6. Bands

`bandOf(score, bands)` maps a `0..1` score with half-open thresholds: `none`
below `low`; `low` below `medium`; `medium` below `high`; `high` below
`critical`; otherwise `critical`.

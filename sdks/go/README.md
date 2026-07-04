# Veritio Go SDK

Go implementation of the Veritio evidence protocol: normalized audit events,
evidence-graph edges, canonical JSON, tamper-evident hashing, and deterministic
risk scoring — byte-identical with the TypeScript and Python SDKs, pinned by
the `spec/conformance` fixtures.

```go
import veritio "github.com/getveritio/veritio/sdks/go"
```

## Audit events

```go
event, err := veritio.CreateAuditEvent(veritio.AuditEventInput{
    OccurredAt: "2026-07-03T10:00:00.000Z",
    Actor:      veritio.Principal{Type: "user", ID: "usr_123"},
    Action:     "billing.plan.updated",
    Target:     veritio.Resource{Type: "billing.plan", ID: "plan_pro"},
    Scope:      &veritio.EvidenceScope{TenantID: "org_123", Environment: "production"},
})
hash, err := veritio.HashAuditEvent(event, nil) // previous hash chains records
```

## Risk Scoring

Deterministic, explainable risk math (`veritio.reference.v1` policy):

```go
step, err := veritio.ScoreRiskSignals(veritio.RiskSignals{
    OperationType:  "delete",
    Reversibility:  "irreversible",
    EnvCriticality: "production",
    DataVolume:     250,
}, veritio.DefaultRiskPolicy)
// step.Score (0..1), step.Level ("none".."critical"), step.Factors

episode, err := veritio.RollupEpisodeRisk([]veritio.EpisodeRiskStep{
    {OccurredAt: "2026-07-03T10:00:00.000Z", Score: step.Score},
    {OccurredAt: "2026-07-03T10:00:20.000Z", Score: 0.35},
}, veritio.DefaultRiskPolicy)

// Attach normalized signals to event metadata (fail-closed validation):
metadata, err := veritio.WithRiskSignals(map[string]any{"table": "invoices"},
    veritio.RiskSignals{OperationType: "bulk", FanOut: 40})
```

`RiskPolicy` derives a full policy from the reference constants with one
temperature knob (`0` lenient, `0.5` = reference policy byte-for-byte, `1`
strictest; multiples of `0.01` only). Overrides apply after derivation and
require an explicit `PolicyVersion`:

```go
strict, err := veritio.RiskPolicy(veritio.RiskPolicyOptions{Temperature: veritio.Float64(0.8)})
// strict.PolicyVersion == "veritio.reference.v1+temp0.80"
```

Episode rollups detect per-action bursts (e.g. repeated failed logins) via
`RiskRollupPolicy.FrequencyRules`; steps carry an optional `Action` and a fired
rule can only raise the episode score. See `docs/risk-scoring.md` for the
scoring model and `spec/risk-scoring.md` for the normative algorithm.

## security.risk Assertions

```go
assertion, err := veritio.CreateSecurityRiskAssertion(veritio.SecurityRiskAssertionInput{
    Scope:          veritio.EvidenceScope{TenantID: "org_123"},
    ProducerID:     "risk_engine_1",
    Subject:        veritio.EvidenceRef{Authority: "veritio", Kind: "activity", Type: "agent_session", ID: "sess_01"},
    IdempotencyKey: "sess_01:step_9",
    Conclusion:     veritio.RiskConclusion{Score: step.Score, Level: step.Level, PolicyVersion: step.PolicyVersion, Assessment: "step"},
    Factors:        step.Factors,
})
assertionHash, err := veritio.HashAssertionRecord(assertion) // parity with HashAuditRecord
```

## Testing

```sh
go test ./...
```

The suite consumes the shared `spec/conformance` fixtures, so a green run
proves cross-language parity for events, hashing, redaction, and risk scoring.

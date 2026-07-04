# Risk Scoring Walkthrough

Runnable, tested tour of the Veritio risk-scoring surface: per-step scoring,
episode rollups, temperature-derived policies, per-action frequency rules, and
`security.risk` assertions. Risk scoring supports compliance evidence; it does
not guarantee legal compliance and is not legal advice.

The auth event stream is produced by the real `@veritio/better-auth` adapter
against an in-memory recorder — no synthetic seeding. The adapter only records
(`auth.login.failed`, `authz.access.denied`, `auth.session.created`); all
scoring happens host-side in this example, per the adapter-boundary rules.

What the scenario shows:

- **Per-step scoring** — `scoreRiskSignals` on sandbox read / staging bulk /
  production destructive operations, with the full `factors[]` breakdown.
- **Temperature** — the same delete-in-production signals scored under
  `riskPolicy({ temperature: 0.2 | 0.5 | 0.8 })`: one knob moves the band from
  lenient to strict, and `0.5` reproduces the reference policy byte-for-byte.
- **Frequency rules** — five failed logins recorded back-to-back fire a
  `>=5 in 300s` rule and escalate the episode to `critical`, while the same
  actions spread ten minutes apart stay `low`. Rules only ever raise a score.
- **Assertions** — the episode rollup published as a `security.risk` assertion
  with a stable canonical hash (`hashAssertionRecord`).

Run it:

```sh
bun install
bun test src        # deterministic scenario assertions
bun run typecheck
```

See `docs/risk-scoring.md` for the scoring model and `spec/risk-scoring.md`
for the normative algorithm.

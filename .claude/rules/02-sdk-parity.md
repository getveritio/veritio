# SDK Parity

- TypeScript, Python, and Go SDKs must expose equivalent core behavior:
  - event creation
  - metadata redaction
  - canonical JSON
  - event hashing
  - hash-chain verification when implemented
  - deterministic risk-signal scoring: signal normalization (fail-closed),
    per-step scoring, episode rollup, and the `DEFAULT_RISK_POLICY`
    (`veritio.reference.v1`) constants must produce byte-identical scores across
    languages, pinned by `spec/conformance` fixtures
  - `security.risk` assertion builders, with `hashAssertionRecord` parity with
    `hashAuditRecord`
  - governed-action draft helpers: `createGovernedActionDraft`,
    `create_governed_action_draft`, and `CreateGovernedActionDraft` must derive
    the same change/activity IDs, tenant-scoped idempotency hash, changed paths,
    revision evidence, event actions, edge relations, and outbox shape, pinned
    by `spec/conformance/governed-action-draft.json`
- If a feature lands in one SDK only, document it as experimental or add parity tasks before handoff.
- Prefer standard libraries in core SDKs.
- Do not read environment variables in SDK core.
- Keep generated IDs prefixed with `evt_` unless the protocol changes.
- Tests must cover the same behavior across languages when feasible.

## Provenance recorder conventions (parity obligations)

These are recorder behaviors, not event-schema fields, but any SDK that ships a
provenance recorder MUST reproduce them identically (currently TypeScript only —
treat as a parity TODO for Python/Go):

- **`metadata.sessionId` stamp.** Every event a session emits — the
  `agent.session.started` event AND every downstream `record*` event — carries
  `metadata.sessionId === <sessionId>`, applied AFTER caller-supplied metadata so
  a caller can never shadow it. Read models group a session's events by this key
  (downstream change/review/ci/deploy/runtime events target isolated or shared
  entities and cannot otherwise be attributed to one session). `sessionId` is
  non-PII and must not match the redaction key pattern.

- **`metadata.activityEpisodeId` stamp.** Mirroring the `metadata.sessionId`
  convention, every event a session emits also carries
  `metadata.activityEpisodeId === <activityEpisodeId>`, applied AFTER caller
  metadata so a caller can never shadow it. It groups one session's events under
  one durable activity episode for risk rollup. Currently TypeScript only — treat
  as a parity TODO for Python/Go capture/recorder. `activityEpisodeId` is non-PII
  and must not match the redaction key pattern.

- **Agent-capture adapters.** `@veritio/claude-code` (TypeScript) captures Claude
  Code hook events into the recorder. The hook→recorder mapping (see its
  `DESIGN.md`/`README.md`) is the language-neutral contract a Python/Go capture
  adapter must reproduce: hash prompts/tool-inputs/file-contents (never raw),
  stable ids + content hashes only, and a `Stop` git-scan to catch Bash-driven
  file changes the edit hooks miss.

- **Risk-signal classification mapping.** The capture classifier
  (`bashRiskSignals` / `fileChangeRiskSignals` / `envCriticalityOf` in
  `adapters/claude-code/src/map.ts`) stamps `metadata.riskSignals` BEFORE
  hashing, so the command→class mapping is hash-affecting capture contract, not
  an implementation detail. The normative table lives in the adapter's
  `DESIGN.md` ("Risk-signal classification"); vocabulary is pinned by
  `spec/risk-signals.schema.json`. Currently TypeScript only — a Python/Go
  capture adapter must reproduce the mapping (patterns, precedence, unmatched →
  no signal) byte-identically. Parity TODO alongside the sessionId /
  activityEpisodeId stamps above.

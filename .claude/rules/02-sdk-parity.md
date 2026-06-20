# SDK Parity

- TypeScript, Python, and Go SDKs must expose equivalent core behavior:
  - event creation
  - metadata redaction
  - canonical JSON
  - event hashing
  - hash-chain verification when implemented
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

- **Agent-capture adapters.** `@veritio/claude-code` (TypeScript) captures Claude
  Code hook events into the recorder. The hook→recorder mapping (see its
  `DESIGN.md`/`README.md`) is the language-neutral contract a Python/Go capture
  adapter must reproduce: hash prompts/tool-inputs/file-contents (never raw),
  stable ids + content hashes only, and a `Stop` git-scan to catch Bash-driven
  file changes the edit hooks miss.

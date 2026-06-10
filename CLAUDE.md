# CLAUDE.md - Veritio

**Authority:** Claude-facing repo entrypoint. Follow this file, root `AGENTS.md`, path-matched `.claude/rules/*`, local skills, and explicit user direction.

Veritio is a protocol-first OSS evidence layer for application audit trails, consent history, DSAR workflows, retention, and compliance exports.

## Operating Mode

- Reality over assumptions: read current code, specs, and docs before changing behavior.
- Implement by default when the request is actionable.
- Do not invent framework APIs, compliance claims, package names, or hosted-provider behavior that is not represented in the repo.
- Preserve user changes. Never revert unrelated dirty work.
- Keep product copy clear that Veritio supports compliance evidence; it does not guarantee legal compliance.
- Treat generated/reviewer output as critique, not truth. Verify claims locally before patching.

## Workflow Routing

- Feature or package work: use `veritio-implement-feature`.
- Protocol/schema/hash/redaction work: use `veritio-protocol-change`.
- Non-trivial diff review: use `veritio-review-diff`.
- Before claiming done: run the strongest feasible verification command, usually `bun run verify`.

## Non-Negotiables

- The event protocol is language-neutral. TypeScript, Python, and Go SDKs must preserve the same field names and semantics.
- Core SDKs must not read environment variables or framework globals directly.
- Sensitive metadata must be explicitly redacted and deterministic.
- Hash-chain, canonical JSON, retention, and event ordering semantics must be tested.
- Framework adapters stay thin and receive configured Veritio recorders from host apps.
- Hosted-provider features must remain optional and must not make the OSS SDK unusable without an account.

## Commands

- Install: `bun install`
- Full gate: `bun run verify`
- TypeScript tests: `bun run test:ts`
- Python tests: `bun run test:python`
- Go tests: `bun run test:go`
- TypeScript typecheck: `bun run typecheck`

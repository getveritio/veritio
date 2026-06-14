# CLAUDE.md - Veritio OSS / SDK

**Authority:** Claude-facing repo entrypoint. Follow this file, root `AGENTS.md`, path-matched `.claude/rules/*`, local skills, and explicit user direction.

Veritio is a protocol-first OSS evidence layer for application audit trails, consent history, DSAR workflows, retention, and compliance exports.

This repo is the public OSS/SDK/protocol repo. The public website belongs in
`veritio-website`; the private hosted SaaS/PaaS product belongs in
`veritio-cloud`.

Read any local hidden execution specs under `.codex/private/specs/` when
present. Those files are intentionally ignored and must not be committed.
Use the split boundaries in this file before changing work that may belong in a
sibling repo.

## Operating Mode

- Reality over assumptions: read current code, specs, and docs before changing behavior.
- Implement by default when the request is actionable.
- Do not invent framework APIs, compliance claims, package names, or hosted-provider behavior that is not represented in the repo.
- Before using framework or build-tool APIs that may have changed recently
  (TanStack Start, Vinxi, Vite, Better Auth, Cloudflare Workers, SvelteKit,
  Next.js, Astro, tRPC, etc.), verify current official docs or installed package
  behavior instead of trusting stale model knowledge. Capture the current source
  of truth in a nearby comment or doc when it prevents a likely repeat failure.
- For TanStack Start specifically, current React docs configure Start through
  Vite/Rsbuild build-tool plugins and Vite scripts such as `vite dev` and
  `vite build`; do not reintroduce old `vinxi dev` / `vinxi build` assumptions
  unless current package docs or installed package metadata prove that is correct.
- Preserve user changes. Never revert unrelated dirty work.
- Keep product copy clear that Veritio supports compliance evidence; it does not guarantee legal compliance.
- Treat generated/reviewer output as critique, not truth. Verify claims locally before patching.
- Do not add public website or hosted SaaS/PaaS implementation code to this repo.
- Do not publish internal product specs, execution prompts, roadmap details, or
  private orchestration notes in public docs.

## Workflow Routing

- Feature or package work: use `veritio-implement-feature`.
- Protocol/schema/hash/redaction work: use `veritio-protocol-change`.
- Non-trivial diff review: use `veritio-review-diff`.
- Multi-repo coordination from this repo: use `split-orchestrator`.
- Cross-repo ownership checks: use `repo-routing-reviewer`.
- Before claiming done: run the strongest feasible verification command, usually `bun run verify`.

## Split Routing

- `veritio`: public protocol, schemas, SDKs, framework adapters, storage
  helpers, self-hosted server modules, verifier, export format, conformance
  fixtures, and public examples.
- `veritio-website`: public Astro website, docs pages, SEO metadata, marketing
  copy, public examples, and static assets.
- `veritio-cloud`: private hosted SaaS/PaaS implementation, hosted ingest,
  hosted MCP, managed storage, billing, regions, customer portals, admin, and
  operational jobs.
- For multi-repo features, define portable protocol and SDK behavior here first,
  implement managed behavior in `veritio-cloud`, then publish website claims in
  `veritio-website`.

## Non-Negotiables

- The event protocol is language-neutral. TypeScript, Python, and Go SDKs must preserve the same field names and semantics.
- Core SDKs must not read environment variables or framework globals directly.
- Sensitive metadata must be explicitly redacted and deterministic.
- Hash-chain, canonical JSON, retention, and event ordering semantics must be tested.
- Framework adapters stay thin and receive configured Veritio recorders from host apps.
- Hosted-provider features must remain optional and must not make the OSS SDK unusable without an account.
- Hosted-only fields, billing concepts, hosted region behavior, private admin operations, and customer portal logic must not become protocol semantics here.
- Do not ask the user to open separate chats merely because a sibling repo owns
  a change. Coordinate from this repo with explicit sibling paths when feasible.
- Every named function, exported helper, class method with protocol/storage
  behavior, route handler, and CLI entrypoint needs a leading documentation
  comment. TypeScript/JavaScript should use the slash-star JSDoc form:
  ```ts
  /**
   * Describe the boundary, invariant, side effect, or framework contract this
   * function protects. Mention tenant scope, hashing, redaction, idempotency,
   * storage ordering, or hosted/OSS boundaries when relevant.
   */
  ```
- In Python use function docstrings; in Go use Go doc comments; in shell use
  `#` comment blocks. Keep the same level of detail even when the language
  cannot use slash-star comments.
- Comments must be useful to the next AI or human maintainer. Do not add empty
  narration that only repeats the function name; document why the function
  exists, what it must not break, and any non-obvious runtime assumption.

## Commands

- Install: `bun install`
- Full gate: `bun run verify`
- TypeScript tests: `bun run test:ts`
- Python tests: `bun run test:python`
- Go tests: `bun run test:go`
- TypeScript typecheck: `bun run typecheck`
- Split status: `bun run status:split`
- Split siblings gate: `bun run verify:siblings`
- Full split gate: `bun run verify:split`

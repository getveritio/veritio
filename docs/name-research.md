# Name Research

Working name: **Veritio**.

## Why Veritio

Veritio keeps the same semantic territory as "Evident": truth, evidence, clarity, and verification. It is less generic than "Evident" and less synthetic than "Proofline".

## Availability Snapshot

Checked on 2026-06-10.

- npm `veritio`: available
- npm `@veritio/core`, `@veritio/sdk`, `@veritio/server`, `@veritio/react`, `@veritio/next`, `@veritio/tanstack-start`, `@veritio/sveltekit`: available
- npm spot check on 2026-06-11: `@veritio/core`, `@veritio/better-auth`, and `@veritio/server` returned not found
- PyPI `veritio`, `veritio-sdk`, `veritio-core`: available
- GitHub `veritio`, `getveritio`, `veritiolabs`, `veritiohq`: public page checks returned 404
- `veritio.com`: registered
- `getveritio.com`: whois returned no match
- `veritiolabs.com`: whois returned no match

## Package Naming Decision

- Use `@veritio/core` for the TypeScript SDK.
- Use `@veritio/*` for JavaScript adapters and server packages.
- Use `@veritio/storage` for host-injected JavaScript storage helpers.
- Keep `veritio` / `veritio-*` for non-JavaScript packages where ecosystem naming fits.

## JS Publish Guardrail

- `@veritio/core`, `@veritio/better-auth`, `@veritio/storage`, and implemented framework helper packages are publishable only when they have implementation source, tests, and package dry-run output.
- Placeholder JavaScript adapter and server packages must stay `private: true` until they have implementation source, tests, and successful package dry-run output.
- `@veritio/server` stays private for now because `server/node` currently documents the planned self-hosted API surface but does not contain implementation source.

## Rejected Names

- Evident: taken on npm and PyPI, with existing security/compliance brand usage.
- Certus: taken on npm, PyPI, GitHub, and active in certified data erasure/compliance software.
- Verity: crowded in compliance and data-destruction tooling.
- Evidra: existing evidence/audit-ready GitOps product.
- Attesta: direct packages were available, but public name and domain signals were noisier than Veritio.

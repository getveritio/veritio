# Veritio OSS / SDK Repository Spec

## Mission

`veritio` is the portable evidence foundation. It defines the public protocol,
SDK behavior, storage contracts, adapters, self-hosted server modules,
conformance fixtures, local tooling, and export formats. It must be useful
without a Veritio Cloud account.

## Owns

- `spec/`: language-neutral event and audit-record schemas.
- `spec/conformance/`: canonical JSON, hashing, redaction, event creation, and
  record hashing fixtures shared by every SDK.
- `sdks/typescript/`, `sdks/python/`, `sdks/go/`: public SDKs with equivalent
  field names and semantics.
- `storage/`: host-injected storage helpers and adapter conformance behavior.
- `adapters/`: thin framework adapters that translate host context into
  Veritio events without redefining protocol semantics.
- `server/`: self-hosted server modules.
- `examples/`: public examples that work without proprietary hosted state.
- `docs/`: OSS architecture, protocol, agent setup, release, and split docs.
- `scripts/verify-split.sh`: split-repo verification orchestration from this
  repo.
- `.codex/agents/`: project-scoped reviewers for protocol compatibility, SDK
  parity, privacy/redaction, adapter boundaries, repo routing, and split
  orchestration.

## Does Not Own

- Public website implementation, SEO pages, or marketing assets.
- Hosted SaaS/PaaS implementation, billing, hosted regions, hosted customer
  portals, private operations, or managed service commitments.
- Hosted-only fields that are not part of the public protocol.
- Website or cloud implementation code under the guise of orchestration.

## Edit Routing

| Change | Repository |
| --- | --- |
| New event field, graph edge, hash input, canonical JSON rule, redaction rule, export manifest field | `veritio` first |
| SDK API or adapter behavior | `veritio` |
| Local verifier, conformance fixture, self-hosted server behavior | `veritio` |
| Hosted ingest, hosted MCP, billing, admin, region, or customer portal behavior | `veritio-cloud` |
| Public landing page, docs page, SEO metadata, public product copy | `veritio-website` |

## Handoff Contract

If a task begins here but needs hosted behavior, first define or confirm the
public contract in this repo. Then hand implementation to `veritio-cloud`.
If a task begins here but is only public copy, hand it to `veritio-website`.
For feasible multi-repo tasks, coordinate the sibling edits from this repo using
explicit paths instead of requiring separate user-controlled chats.

## Verification

Run `bun run verify` before claiming done for non-doc OSS changes. For docs-only
changes, inspect the changed docs and run targeted checks when links, examples,
or commands changed.

Run `bun run verify:split` before claiming done for changes that touch multiple
Veritio split repositories.

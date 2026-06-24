# Veritio Repository Map

Veritio is split across focused repositories so the public OSS trust layer,
public website, and private hosted product do not blur into each other.

## Sibling Layout

```txt
veritio/          public OSS protocol, SDKs, adapters, storage, local server
veritio-website/  public website, website docs, SEO, marketing, static assets
veritio-cloud/    private hosted SaaS/PaaS implementation
```

The expected local layout is sibling folders under the same parent directory.
Override paths with environment variables when local checkout paths differ.

## Control Point

Use `veritio` as the default control repo for split-repo work. It may contain
public routing docs, scripts, prompts, and agent configuration that coordinate
the split. It must not absorb public website implementation or hosted SaaS/PaaS
implementation code.

From a Codex session rooted at `veritio`, use explicit sibling paths or shell
workdirs to inspect, edit, and verify `veritio-website` and `veritio-cloud`
when those repos own the requested change.

## Routing Rule

Start in the repository that owns the source of truth:

- Protocol semantics, event fields, canonical JSON, hashing, redaction,
  retention labels, graph relations, export manifests, SDK behavior,
  conformance fixtures, storage helpers, adapters, local server behavior, and
  public examples: `veritio`.
- Public website implementation, website docs pages, SEO metadata, public
  marketing copy, public product education, static assets, and website-only
  examples: `veritio-website`.
- Hosted ingest, hosted MCP, managed storage, SaaS dashboard, billing, hosted
  Workbench, scoped keys, customer portals, regional storage, private jobs,
  admin, and service commitments: `veritio-cloud`.

## Cross-Repo Order

When a feature needs multiple repositories:

1. Define portable protocol, SDK, export, storage, or adapter behavior in
   `veritio`.
2. Implement hosted product behavior in `veritio-cloud` through public package
   boundaries or explicit local development links.
3. Publish website claims in `veritio-website` only after backing OSS or hosted
   behavior exists.

## Hard Boundaries

- `veritio` must remain useful without a hosted account, hosted project ID,
  hosted API key, hosted billing, or proprietary storage.
- `veritio-cloud` must not define public protocol semantics.
- `veritio-website` must not publish private hosted internals or compliance
  guarantees.
- Hosted-only fields, billing concepts, region behavior, private admin
  operations, and customer portal behavior must not become OSS protocol
  semantics.
- No repository may claim Veritio provides legal advice or automatic regulatory
  compliance.

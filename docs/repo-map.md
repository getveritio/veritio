# Veritio Repository Map

This map is duplicated across the Veritio sibling repositories so Codex can
route work without guessing.

## Sibling Layout

```txt
veritio/          public OSS protocol, SDKs, adapters, storage, self-hosted server
veritio-website/  public Astro website and documentation
veritio-cloud/    private TanStack Start SaaS/PaaS implementation
```

Expected local layout is sibling folders under the same parent directory.

## Coordination Point

Use `veritio` as the default Codex control repo for cross-repo work. It may
contain orchestration docs, prompts, scripts, and agents that coordinate the
split. It must not absorb website or hosted SaaS/PaaS implementation code.

From a single Codex session rooted at `veritio`, use explicit sibling paths or
shell workdirs to inspect, edit, and verify `veritio-website` and
`veritio-cloud`. Do not ask the user to open separate chats unless a task
explicitly needs independent parallel threads.

## Routing Rule

Start in the repository that owns the source of truth:

- protocol semantics, event fields, canonical JSON, hashing, redaction,
  retention semantics, export manifests, SDK behavior, conformance fixtures:
  `veritio`
- public copy, marketing pages, docs pages, SEO metadata, public examples,
  static assets: `veritio-website`
- hosted ingest, hosted MCP, managed storage, SaaS dashboard, billing, hosted
  Workbench, customer portals, private jobs, regions, operational commitments:
  `veritio-cloud`

If the current repository is wrong for the requested change, stop and move to
the owning sibling before implementing. Do not smuggle the change into the
current repo.

## Cross-Repo Order

When one feature needs multiple repositories, use this order:

1. Define portable protocol and SDK behavior in `veritio`.
2. Implement hosted product behavior in `veritio-cloud` using public OSS
   package boundaries or explicit local development links.
3. Publish or update public claims in `veritio-website` only after the backing
   OSS or hosted feature exists.

## Hard Boundaries

- `veritio` must remain useful without a hosted account.
- `veritio-cloud` must not define public protocol semantics.
- `veritio-website` must not publish private hosted internals or compliance
  guarantees.
- Hosted-only fields, billing concepts, region behavior, and private admin
  operations must not become OSS protocol semantics.

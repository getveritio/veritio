# Release Checklist

Use this checklist before tagging or publishing a Veritio release. Veritio is
pre-1.0, so release notes should be explicit about protocol, package,
verification, and migration risk.

Veritio provides evidence support for audit trails, consent history, records of
processing, data subject workflows, retention, and exportable records. It is not
legal advice and does not make an application automatically compliant with any
regulation or framework.

## 1. Scope

- Confirm the release branch, target version, and intended package list.
- List public packages included in the release.
- Confirm private workspace packages such as `@veritio/server`,
  `@veritio/express`, `@veritio/hono`, and `@veritio/trpc` are not published by
  accident.
- Identify protocol, schema, canonical JSON, hashing, idempotency, redaction,
  retention, storage-ordering, tenant-scope, export-manifest, adapter, and
  example changes.
- Identify whether the release affects only OSS, only examples/docs, or also
  sibling website/cloud repos.

## 2. Compatibility

- Check that `spec/` remains the source of truth for event, edge, audit-record,
  and edge-record contracts.
- Verify TypeScript, Python, and Go SDKs preserve the same field names and
  semantics for shared behavior.
- Mark intentional TS-only APIs clearly, especially `MemoryAuditStore`,
  verification helpers, and `createProvenanceRecorder`.
- Update conformance fixtures when canonical JSON, hashing, redaction, event
  creation, edge creation, record hashing, or template semantics change.
- Confirm framework adapters remain thin and host-injected.
- Confirm browser UI helpers do not record audit events client-side.
- Confirm OSS packages do not require a hosted account, hosted project ID,
  hosted API key, hosted billing, or proprietary storage.

## 3. Privacy And Integrity

- Review default metadata for unnecessary personal data collection.
- Confirm redaction behavior is explicit, deterministic, and covered by tests.
- Confirm storage adapters fail closed when required fields, tenant scope, or
  integrity data are missing.
- Confirm hash-chain verification covers canonicalization version, hash
  algorithm, tenant-local ordering, previous-hash links, idempotency semantics,
  and payload hashes.
- Review examples and docs so they do not include real secrets, production
  tokens, private keys, personal data, customer records, raw prompts, raw diffs,
  command output, or private operational details.

## 4. Verification

Run the full OSS gate when feasible:

```sh
bun run verify
```

For focused checks, run the relevant subset and record any skipped command:

```sh
bun run test:ts
bun run test:python
bun run test:go
bun run test:storage
bun run test:adapters
bun run typecheck
bun run verify:examples
git diff --check
```

`bun run test:storage` loads env-gated live database conformance suites when
matching connection strings are present. For release verification, record
whether these variables were set against disposable databases or CI services:

- `VERITIO_POSTGRES_TEST_URL`
- `VERITIO_NEON_TEST_URL`
- `VERITIO_MYSQL_TEST_URL`
- `VERITIO_MARIADB_TEST_URL`
- `VERITIO_MONGODB_TEST_URL`

For split-repo changes from the OSS control repo:

```sh
bun run status:split
bun run verify:siblings
bun run verify:split
```

## 5. Package Dry Runs

For each public npm package, inspect dry-run package contents:

```sh
npm pack --dry-run --json
```

Run the dry run from each package directory and confirm:

- package-local README is included
- license metadata is correct
- `exports` point at built files
- `files` excludes source-only or private material unintentionally
- bins such as `veritio`, `veritio-claude-code-hook`, and
  `veritio-claude-code-mcp` point at built output
- private packages are not publishable

For Python and Go releases, confirm package metadata, module paths, examples,
and version references match the intended release.

## 6. Documentation

- Update `CHANGELOG.md` when present or create release notes in the release PR.
- Update package READMEs for public packages whose install, API, examples, or
  support status changed.
- Update root `README.md` if repository layout, package names, protocol
  invariants, examples, or product boundaries changed.
- Update `docs/architecture.md` when protocol, storage, server, adapter,
  Workbench, MCP, or export behavior changed.
- Update `docs/ai-integration.md` when agent capture, MCP tools, provenance
  conventions, or privacy guidance changed.
- Update split-routing docs when ownership across `veritio`, `veritio-website`,
  and `veritio-cloud` changes.
- Keep local private execution specs under ignored paths. Do not publish private
  roadmap, prompt, or operational material.

Search public copy for accidental legal or compliance guarantees:

```sh
rg -n -i "guarantee|guaranteed|automatically.*compliant|automatic compliance|makes .* compliant|legal advice|certified by veritio" README.md docs sdks adapters storage server examples .github
```

Expected matches should be guardrails, warnings, or examples of wording to avoid.

## 7. Changelog

Each release entry should include:

- Added, changed, fixed, deprecated, removed, and security notes when applicable.
- Breaking changes and migration steps.
- Protocol, SDK, adapter, storage, server, docs, and packaging highlights.
- Verification summary and skipped checks.
- Security disclosure references when public.

Avoid release claims that imply Veritio gives legal advice or guarantees
compliance.

## 8. Publish

- Confirm the working tree contains only intentional release edits.
- Confirm package versions and tags are intentional.
- Publish public packages from clean, verified package directories.
- Create a GitHub release with the changelog entry, verification summary, and
  migration notes.
- Keep hosted-provider or server features marked private/planned unless they are
  implemented and released through the correct package or sibling repo.

## 9. After Release

- Verify published package metadata and tarball contents.
- Check GitHub release links and installation snippets.
- Open follow-up issues for deferred work, skipped checks, known limitations, or
  private-package surfaces that still need release decisions.
- Keep security disclosure details private until the coordinated disclosure plan
  allows publication.

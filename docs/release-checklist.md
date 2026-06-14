# Release Checklist

Use this checklist before tagging or publishing a Veritio release. Veritio is pre-1.0, so release notes should be explicit about protocol, package, and migration risk.

Veritio provides evidence support for audit trails, consent history, records of processing, data subject workflows, retention, and exportable records. It is not legal advice and does not make an application automatically compliant with any regulation or framework.

## 1. Scope

- Confirm the release branch and target version.
- List public packages included in the release.
- Confirm private packages, such as server modules, are not published by accident.
- Identify protocol, schema, canonical JSON, hashing, idempotency, redaction, retention, storage-ordering, and tenant-scope changes.
- Identify docs, examples, adapter, and storage helper changes that need migration notes.

## 2. Compatibility

- Check that `spec/` remains the source of truth for event and audit-record contracts.
- Verify TypeScript, Python, and Go SDKs preserve the same field names and semantics.
- Update parity vectors or cross-SDK tests when behavior could diverge.
- Confirm framework adapters remain thin and host-injected.
- Confirm OSS packages do not require a hosted Veritio account.

## 3. Privacy and Integrity

- Review default metadata for unnecessary personal data collection.
- Confirm redaction behavior is explicit and deterministic.
- Confirm storage adapters fail closed when required fields, tenant scope, or integrity data are missing.
- Confirm hash-chain verification covers canonicalization version, hash algorithm, tenant-local ordering, previous-hash links, and idempotency semantics.
- Review examples so they do not include real secrets, production tokens, private keys, personal data, or customer records.

## 4. Verification

Run the full gate when feasible:

```sh
bun run verify
```

For focused release checks, run the relevant subset and record any skipped command:

```sh
bun run test:ts
bun run test:python
bun run test:go
bun run test:storage
bun run test:adapters
bun run typecheck
git diff --check
```

`bun run test:storage` also loads the env-gated live database conformance
suites. For release verification, record whether the following variables were
set against disposable databases or CI service containers:

- `VERITIO_POSTGRES_TEST_URL`
- `VERITIO_NEON_TEST_URL`
- `VERITIO_MYSQL_TEST_URL`
- `VERITIO_MARIADB_TEST_URL`
- `VERITIO_MONGODB_TEST_URL`

For public npm packages, inspect dry-run package contents before publishing:

```sh
npm pack --dry-run --json
```

Run that command from each public package directory, and confirm package-local README, license metadata, exports, files, and built output are correct.

## 5. Documentation

- Update `CHANGELOG.md`.
- Update package READMEs for public packages whose install, API, examples, or support status changed.
- Update root `README.md` if the repository layout, initial modules, package names, or product boundary changed.
- Update architecture or implementation docs when protocol, storage, server, adapter, or hosted-provider boundaries changed.
- Search public copy for accidental legal or compliance guarantees:

```sh
rg -n -i "guarantee|guaranteed|automatically.*compliant|automatic compliance|makes .* compliant|legal advice|certified by veritio" README.md docs sdks adapters storage server .github
```

Expected matches should be guardrails, warnings, or examples of wording to avoid.

## 6. Changelog

Each release entry should include:

- Added, changed, fixed, deprecated, removed, and security notes when applicable.
- Breaking changes and migration steps.
- Protocol, SDK, adapter, storage, server, docs, and packaging highlights.
- Security disclosure references when public.

Avoid release claims that imply Veritio gives legal advice or guarantees compliance.

## 7. Publish

- Confirm the working tree is clean except for intentional release edits.
- Confirm package versions and tags are intentional.
- Publish public packages from clean, verified package directories.
- Create a GitHub release with the changelog entry, verification summary, and migration notes.
- Mark any hosted-provider or server features as planned unless they are implemented and released.

## 8. After Release

- Verify published package metadata and tarball contents.
- Check the GitHub release links and installation snippets.
- Open follow-up issues for deferred work, skipped checks, or known limitations.
- Keep security disclosure details private until the coordinated disclosure plan allows publication.

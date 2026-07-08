# Security guidance for Veritio

Veritio is an open-source evidence protocol: TypeScript, Python, and Go SDKs, framework
adapters, an optional server, and storage drivers. The protocol's value is integrity and
privacy, so these rules are repo-specific and additive to the built-in vulnerability
checklist — focus findings on the Veritio invariants below and report the affected
symbol/path. Source of truth: `.claude/rules/01-protocol-and-schemas.md`,
`02-sdk-parity.md`, `03-privacy-security.md`, `04-adapters-and-server.md`, and `CLAUDE.md`.

## 1. Protocol integrity (highest priority)

Integrity is the product. A change that weakens it silently is a P0.

- Hash input must include the documented fields (event payload + previous hash) using the
  field names in `spec/`. Flag any SDK that feeds the hash function a different field set,
  order, or encoding than the spec defines.
- Canonical JSON must be deterministic and identical across TypeScript, Python, and Go:
  same input, same bytes. Flag map/dict iteration order, locale-dependent number/date
  formatting, non-UTF-8 encoding, or insertion-order assumptions in canonicalization.
- Hash-chain verification must fail closed when `previousHash`, `eventHash`, or canonical
  input is missing or malformed. Flag verification paths that skip, default, or swallow a
  missing-integrity-field condition.
- A change to hash input or canonical form must be explicit in `spec/`, docs, and tests
  across all affected SDKs. Flag a one-SDK change to integrity behavior with no spec/parity
  update.

## 2. Redaction correctness

Redaction must run before persistence/transport and must be provable.

- Redaction must be deterministic and tested: the same input yields the same redacted
  output across runs and languages. Flag redaction with no test, or redaction whose output
  depends on ordering, environment, or randomness.
- Redaction rules must match across TypeScript, Python, and Go. Flag a redaction key/list
  present in one SDK but missing in another.
- A recorded event must not bypass redaction. Flag any record path that serializes or
  stores metadata before the redaction step.

## 3. Secrets, credentials & PII in metadata

- Never record raw secrets, passwords, API keys, bearer tokens, authorization headers,
  database URLs, or connector credentials in event metadata. Flag any code that copies a
  request header, env value, or connection string into metadata.
- Prefer stable IDs over emails, display names, IP addresses, or freeform personal data.
  Flag examples or adapters that record raw PII by default.
- Audit/log/error paths must carry safe metadata only — never raw secrets, credentials,
  PII, or full unknown-exception `error.message`.

## 4. SDK core boundaries

- No environment-variable reads inside SDK core. Config must be injected by the caller.
  Flag `process.env`, `os.environ`, or `os.Getenv` in `sdks/**` core modules (process-
  boundary entry modules in `server/`/`cli/` may read env).
- SDK core stays framework-agnostic. Flag React/Vue/Svelte or server-framework imports in
  `sdks/**`.
- Governed-action helpers must keep raw idempotency keys at the capture
  boundary and emit only the tenant-scoped idempotency hash. Flag any
  `outboxEntry`, event metadata, edge metadata, or revision evidence that leaks
  raw idempotency keys or keyed-digest secrets.

## 5. Storage & adapter boundaries

- Storage adapters must never receive credentials in browser-visible code. Flag storage
  driver config, provider tokens, or connection strings reaching `adapters/react`,
  `adapters/vue`, `adapters/svelte(kit)`, or client bundles.
- Adapters are translators, not protocol owners. They receive configured recorders/clients
  from the host app. Flag adapters that re-implement hashing, canonical JSON, or redaction
  instead of calling an SDK.
- Governed create/update/delete evidence must be recorded from the host
  application's server-side mutation boundary with the SDK governed-action
  helper. Flag browser form state or framework adapters that compute changed
  paths, idempotency hashes, revision IDs, or storage writes themselves.
- Hosted-provider code must remain optional and must not block self-hosted OSS usage.

## 6. Compliance-claim safety

- Veritio supports compliance evidence; it does not guarantee legal compliance. Flag
  product copy, docs, README, or example text that asserts guaranteed legal/regulatory
  compliance (GDPR, SOC 2, HIPAA, "legally binding", "court-admissible") as an absolute.
- DSAR, consent, and retention features are tooling, not legal advice. Retention must be a
  named policy, not ad hoc timestamps scattered through code.

## 7. Fail-closed defaults

- Fail closed on missing integrity fields, missing redaction, missing required actor/
  action/target/scope, or invalid environment state. Flag `catch { return null }`,
  `catch { return [] }`, or default-to-valid behavior on integrity, verification, or
  redaction paths.
- A verification failure must surface as a typed failure, never a silent pass.

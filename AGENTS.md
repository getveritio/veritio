# AGENTS.md - Veritio

Veritio is a protocol-first OSS evidence layer for application audit trails, consent history, DSAR workflows, retention, and compliance exports.

## Product Rules

- Veritio is not legal advice and must not claim automatic GDPR, EAA, SOC 2, HIPAA, DORA, or NIS2 compliance.
- Prefer "evidence support", "audit trail", "records of processing", and "data subject workflow" over "guaranteed compliance".
- Keep the core protocol language-neutral. SDKs in TypeScript, Python, and Go must share the same event semantics.
- Do not make any framework adapter authoritative for the event model.

## Engineering Rules

- Core packages must not read process environment variables directly. Inject configuration at the host boundary.
- Default APIs must avoid collecting unnecessary personal data.
- Metadata redaction must be explicit and deterministic.
- Hashing, canonical JSON, idempotency keys, and storage ordering must be deterministic and tested.
- Storage adapters must fail closed when required fields, tenant scope, or integrity data are missing.
- Avoid vendor lock-in in OSS modules. Hosted-provider features belong behind optional clients or server modules.

## Naming

- Working brand: Veritio.
- Working hosted domain: getveritio.com.
- Use `@veritio/*` for npm packages and `veritio` / `veritio-*` for non-JS packages where available.

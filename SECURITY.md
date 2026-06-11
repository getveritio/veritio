# Security Policy

Veritio handles evidence-support primitives that may be used around authentication, consent history, data subject workflows, retention, and compliance exports. Security reports are welcome.

Veritio is not legal advice and does not make an application automatically compliant with GDPR, EAA, SOC 2, HIPAA, DORA, NIS2, or any other framework.

## Reporting a Vulnerability

Please do not open a public GitHub issue for vulnerabilities.

Use GitHub private vulnerability reporting for this repository when available. If it is not available, email the maintainer listed on the GitHub repository profile with:

- a short description of the issue
- affected package, adapter, storage helper, server module, or example
- reproduction steps or a minimal proof of concept
- expected impact
- whether sensitive data, tenant isolation, hashing, canonical JSON, idempotency, or storage integrity is involved
- any workaround you know

Do not include real secrets, production tokens, private keys, personal data, or customer records in the report.

## What to Report

Please report suspected issues such as:

- tenant-scope bypasses or cross-tenant record access
- hash-chain, canonical JSON, idempotency, or record-ordering integrity failures
- metadata redaction bypasses or accidental collection of unnecessary personal data
- storage adapters accepting records without required tenant scope or integrity fields
- server or adapter paths that expose secrets, storage credentials, provider tokens, or recorder internals to browser code
- dependency or packaging issues that could affect consumers of public packages

## Response Expectations

This is a young OSS project with limited maintainer capacity. The maintainers will try to:

- acknowledge valid reports within 7 days
- confirm the affected versions or unreleased branch state
- coordinate a fix and release plan before public disclosure when practical
- credit reporters when requested and appropriate

Reports about unreleased code are still useful. The response may be a patch, docs correction, release-blocking note, or issue created after sensitive details are removed.

## Supported Versions

Veritio has not published a stable `1.0` release yet. Security fixes target the default branch and any actively maintained pre-1.0 release branch or package version.

## Disclosure

Please give maintainers a reasonable window to investigate before sharing details publicly. If you believe active exploitation is occurring or disclosure is urgent, say that in the report.

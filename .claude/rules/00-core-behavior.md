# Core Behavior

## Before Changing Code

- Read root `CLAUDE.md`, `AGENTS.md`, and the closest docs/spec files.
- Define success criteria in verifiable terms.
- Prefer narrow, testable edits over broad refactors.
- Ask only when repo evidence cannot resolve a choice that materially changes scope, security, data loss, or package/public API shape.

## Execution

- Keep working through implementation and verification unless blocked.
- Add or update tests for behavior changes.
- For bug fixes, prefer first creating or identifying a failing repro.
- Report exact verification commands and results.
- Do not leave known quality regressions in touched paths.

## Summary

<!-- Briefly describe what changed and why. -->

## Type of Change

- [ ] Protocol, schema, hashing, redaction, retention, or records-of-processing contract
- [ ] SDK behavior
- [ ] Adapter or example
- [ ] Storage or server module
- [ ] Documentation or release hygiene
- [ ] CI, packaging, or repository maintenance

## Evidence and Safety Checklist

- [ ] I kept the core protocol language-neutral and did not make an adapter authoritative for the event model.
- [ ] I avoided new unnecessary personal data collection and kept metadata redaction explicit and deterministic.
- [ ] I preserved deterministic canonical JSON, hashing, idempotency, and storage ordering semantics, or documented the intentional change.
- [ ] I avoided hosted-provider lock-in in OSS modules.
- [ ] Public copy uses evidence-support language and does not claim legal advice or automatic compliance.

## Verification

- [ ] `bun run verify`
- [ ] Focused tests:
- [ ] Docs or grep checks:
- [ ] Not run, with reason:

## Release Notes

- [ ] Changelog updated, or this change does not need a changelog entry.
- [ ] Release checklist impact reviewed for package, schema, docs, or security changes.

## Notes for Reviewers

<!-- Add review focus areas, follow-ups, or risk notes. -->

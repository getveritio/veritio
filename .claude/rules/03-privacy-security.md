# Privacy And Security

- Veritio supports evidence and privacy workflows; it is not legal advice.
- Never put raw secrets, passwords, API keys, bearer tokens, authorization headers, database URLs, or connector credentials in event metadata.
- Prefer stable IDs over emails, display names, IP addresses, or freeform personal data.
- Redaction must be deterministic and testable.
- Retention classes should be named policies, not ad hoc timestamps scattered through app code.
- Framework/browser packages must never receive storage credentials or hosted-provider secrets.
- Fail closed when required tenant scope, actor, target, action, or integrity fields are missing.

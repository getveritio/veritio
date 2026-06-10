# Protocol And Schemas

- `spec/event.schema.json` is the protocol source of truth for field names and semantics.
- Any event shape change must update docs and all affected SDKs.
- Keep JSON field names stable and language-neutral.
- Do not add SDK-only event fields without a protocol decision.
- Canonical JSON must remain deterministic across languages.
- Hash input must include event payload and previous hash using documented field names.
- Schema changes require tests that prove old assumptions do not silently break.

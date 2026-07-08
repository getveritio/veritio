# Adapters And Server

- Adapters are translators, not protocol owners.
- Adapter packages must receive configured recorders/clients from the host app.
- Do not auto-record every request by default; favor explicit mutation/action capture first.
- Governed create/update/delete actions belong in the host application's
  server-side mutation boundary via `createGovernedActionDraft` /
  `create_governed_action_draft` / `CreateGovernedActionDraft`. Adapters may
  pass request/auth context into that flow, but must not own changed-path,
  idempotency, storage, or protocol semantics.
- Browser-visible code must not include storage credentials, provider tokens, or server-only configuration.
- Server modules may read environment-derived config only at process boundary modules, not in shared protocol helpers.
- Hosted-provider code must remain optional and must not block self-hosted OSS usage.

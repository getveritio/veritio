# Adapters And Server

- Adapters are translators, not protocol owners.
- Adapter packages must receive configured recorders/clients from the host app.
- Do not auto-record every request by default; favor explicit mutation/action capture first.
- Browser-visible code must not include storage credentials, provider tokens, or server-only configuration.
- Server modules may read environment-derived config only at process boundary modules, not in shared protocol helpers.
- Hosted-provider code must remain optional and must not block self-hosted OSS usage.

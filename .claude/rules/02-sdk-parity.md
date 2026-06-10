# SDK Parity

- TypeScript, Python, and Go SDKs must expose equivalent core behavior:
  - event creation
  - metadata redaction
  - canonical JSON
  - event hashing
  - hash-chain verification when implemented
- If a feature lands in one SDK only, document it as experimental or add parity tasks before handoff.
- Prefer standard libraries in core SDKs.
- Do not read environment variables in SDK core.
- Keep generated IDs prefixed with `evt_` unless the protocol changes.
- Tests must cover the same behavior across languages when feasible.

# Veritio Evidence Export Bundle v1 — `vevb-1` (normative)

This document specifies the byte-level construction and offline verification of a
`vevb-1` export bundle so an independent implementation can build and verify
bundles without reading SDK source. The reference implementation lives in the
TypeScript SDK (`sdks/typescript/src/export-bundle.ts`) and is pinned by
`spec/conformance/export-bundle-golden.json` and
`spec/conformance/export-bundle-tampered.json`; where this prose and the
conformance fixtures could ever disagree, the fixtures win. The container and
manifest shapes are additionally pinned by `spec/export-bundle.schema.json`.

All canonical serialization below is `veritio-json-v1` (recursively sorted object
keys, `undefined`/missing members omitted, array holes nulled, UTF-8, no HTML
escaping) and all digests are SHA-256. Export-bundle digests are **bare 64-hex**
(`<64 lowercase hex>`), matching v1 audit/edge record envelope hashes and
deliberately unlike the algorithm-qualified `sha256:<hex>` EvidenceCommit digests.

## 1. Container

A bundle is a single JSON object with a fixed shape:

```
{
  "bundleVersion": "vevb-1",
  "manifest": { … },              // the signed, verifiable index (§2)
  "files":     { "<path>": "<payload>", … },  // exact file bytes (§3)
  "signature": { … }              // OPTIONAL; present only on a signed bundle (§5)
}
```

`bundleVersion` MUST be the literal string `vevb-1`; any other value is
unsupported and MUST fail closed. `manifest` and `files` MUST both be present
JSON objects. The single-file container form is the canonical JSON of this whole
object, so the container bytes are deterministic and key-sorted.

## 2. Manifest

The manifest is the signed, verifiable index of the export:

- `bundleVersion` — the literal `vevb-1`.
- `createdAt` — an ISO-8601 timestamp supplied by the caller. The builder never
  reads a clock; `createdAt` is an input, so the same input yields the same
  manifest.
- `scope` — `{ tenantId (required), workspaceId?, environment? }`.
- `range` — `{ from, to }`, the ISO-8601 time window the export covers.
- `producer` — `{ authority, kind: "principal", type: "service" | "user", id }`,
  the authoritative principal that produced the bundle.
- `files` — the array of file entries (§3), each `{ path, sha256, records }`.
- `rootHash` — the deterministic digest binding `files` (§4).
- `annex` — OPTIONAL array of `{ packId, version }` summaries for attached
  evidence packs.
- `signaturePublicKeyFingerprint` — OPTIONAL; present only once the bundle is
  signed (§5).

## 3. Files and payload rules

Every bundle lists exactly these four files, plus zero or more annex files:

- `records/audit-events.jsonl` — audit record envelopes.
- `records/evidence-edges.jsonl` — evidence-edge record envelopes.
- `records/commits.jsonl` — evidence-commit records.
- `verification.json` — the embedded chain-verification report (§4).
- `annex/<packId>.json` — OPTIONAL, one per attached evidence pack.

`manifest.files` and the `files` object MUST map 1:1: every manifest path has
exactly one payload key and vice versa, with no duplicate paths. The three
`records/*.jsonl` files and `verification.json` are REQUIRED regardless of
whether any records are present.

**JSONL payload rule.** A `records/*.jsonl` payload is each record serialized as
its own `veritio-json-v1` line, joined by `\n`, with a single trailing `\n`. A
record file's `records` count is the number of record lines.

**Empty-file rule.** A record file with zero records serializes to the empty
string `""` (no lone `\n`), and its manifest `records` count is `0`. The file is
still listed in the manifest.

**Annex payload rule.** Each annex file is `canonicalJson(pack)` for its pack.
Annex packs are sorted by `packId` before assembly, and a duplicate `packId`
MUST fail closed (two packs would collide on one `annex/<packId>.json` key). A
`packId` MUST be printable ASCII so its position in path ordering (§4) is
unambiguous.

Each `manifest.files` entry carries `sha256`, the bare-64-hex SHA-256 of that
file's exact UTF-8 payload bytes.

## 4. `rootHash`

`rootHash` binds the manifest's file set into one digest:

```
rootHash = sha256Hex(canonicalJson(sortByPath(files)))
```

`files` here is the array of `{ path, sha256, records }` entries. `sortByPath`
orders entries ascending by `path` using raw code-unit comparison — the same
ordering JavaScript's default `<`/`>` on strings gives, i.e. **UTF-16 code-unit
order**, not locale-aware or Unicode-collation order. Sorting makes `rootHash`
order-insensitive: the same set of files yields the same `rootHash` regardless of
the order the files were appended. Because `path` is the sort key and an annex
`packId` is embedded in its path, `packId` is constrained to printable ASCII so
this ordering is stable across implementations.

`verification.json` is `canonicalJson({ audit, edges, commits })`, where each
value is the `{ valid, issues? }` verdict of re-running the corresponding chain
verifier over the raw records. It is a file like any other: hashed into its
`manifest.files` entry and covered by `rootHash`.

## 5. Signature

A bundle MAY be signed with Ed25519. Signing derives the signing key's
**fingerprint** — the bare-64-hex SHA-256 of the raw (`'raw'`-format) public key
bytes — writes it into the manifest as `signaturePublicKeyFingerprint`, and adds a
detached `signature` object:

```
signature = {
  algorithm:            "ed25519",
  publicKeyFingerprint: "<fingerprint>",         // == manifest.signaturePublicKeyFingerprint
  signature:            "<base64 Ed25519 sig>"
}
```

The signed **payload** is the UTF-8 bytes of `sha256Hex(canonicalJson(manifest))`
— a fixed 64-byte hex string — over the manifest that already carries
`signaturePublicKeyFingerprint`. Signing the manifest digest keeps the payload a
fixed size while still binding every manifest field (`createdAt`, `scope`,
`rootHash`, the fingerprint, and the rest), so any manifest tamper after signing
invalidates the signature. Writing the fingerprint changes the manifest but not
`rootHash`, which binds only `files`. Ed25519 signing is deterministic, so the
same bundle and key always produce byte-identical output.

## 6. Verification levels

Offline verification runs four independent gates over a bundle's bytes, with no
network or authority call. A consumer trusts the single fail-closed `valid`, true
only when every applicable gate holds:

1. **Structure** — `manifest` and `files` are objects and `manifest.files` is an
   array; manifest paths and `files` keys map 1:1 with no duplicates; the three
   `records/*.jsonl` files and `verification.json` are all present.
2. **Integrity** — every file's SHA-256 is recomputed from its bytes and matched
   to its manifest entry, `rootHash` is recomputed (§4) and matched, and each
   record file's line count equals its declared `records` count.
3. **Chains** — each record file is parsed back and re-run through the audit,
   edge, and commit chain verifiers, whose `valid` verdicts MUST equal the
   embedded `verification.json`.
4. **Signature** — a present signature is checked against a caller-supplied public
   key and reported `valid`/`invalid`; present without a key is `skipped`; absent
   is `absent`. The algorithm MUST be `ed25519`, and the caller key's fingerprint
   MUST equal both `signature.publicKeyFingerprint` and the manifest's
   `signaturePublicKeyFingerprint` before the Ed25519 check runs. Only an
   `invalid` signature — or a signature required by the caller but `absent` —
   drives `valid` false; `skipped` and `absent` (when not required) are satisfied.

## 7. Determinism and fail-closed rules

- The build is a pure function of its input: no clock reads, no randomness. The
  same input yields byte-identical `files` and `manifest`.
- Content problems never throw during verification — they land in the report as
  sanitized issue strings and drive `valid` false. Verification throws only for
  programmer misuse (a non-object bundle).
- Issue strings are static and sanitized: a `path` or `packId` may be embedded,
  but never raw error text, parser messages, or record content.
- A bundle that is malformed, whose hashes do not recompute, whose chains do not
  re-verify, or whose required signature is absent MUST verify as `valid: false`.

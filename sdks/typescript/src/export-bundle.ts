/**
 * vevb-1 export-bundle manifest contract.
 *
 * This module defines the portable "Veritio Evidence Export Bundle v1" (vevb-1)
 * manifest types and the `rootHash` computation that binds a bundle's record
 * files into a single tamper-evident digest. The manifest is the signed,
 * verifiable index of an export: it names every record file, its per-file
 * content hash, and the deterministic `rootHash` over all files. Hashing here
 * MUST use the same canonical-JSON bytes and SHA-256 semantics as the rest of
 * the protocol, so all hashing routes through the export-bundle-deps shim.
 */

import { canonicalJson, sha256Hex, verifyAuditChain, verifyCommitChain, verifyEdgeChain } from "./export-bundle-deps";

/**
 * One record file inside an export bundle. `path` is the bundle-relative file
 * location (used as the stable sort key for `rootHash`), `sha256` is the
 * lowercase-hex SHA-256 of that file's bytes, and `records` is the count of
 * records the file contains. These fields are hashed into `rootHash`, so their
 * shape and semantics are part of the vevb-1 protocol surface.
 */
export interface ExportBundleFileEntry {
  path: string;
  sha256: string;
  records: number;
}

/**
 * The vevb-1 export-bundle manifest: the signed, verifiable index of an export.
 *
 * `bundleVersion` pins the format to `'vevb-1'`. `scope` and `range` describe
 * the tenant/workspace/environment and time window the export covers.
 * `producer` records the authoritative principal that produced the bundle.
 * `files` lists every record file, and `rootHash` is the deterministic digest
 * over those files (see {@link computeRootHash}) that a verifier recomputes to
 * confirm the manifest has not been altered. `annex` and
 * `signaturePublicKeyFingerprint` are optional and carry pack references and the
 * signing-key fingerprint when the bundle is signed.
 */
export interface ExportBundleManifest {
  bundleVersion: "vevb-1";
  createdAt: string;
  scope: { tenantId: string; workspaceId?: string; environment?: string };
  range: { from: string; to: string };
  producer: {
    authority: string;
    kind: "principal";
    type: "service" | "user";
    id: string;
  };
  files: ExportBundleFileEntry[];
  rootHash: string;
  annex?: { packId: string; version: string }[];
  signaturePublicKeyFingerprint?: string;
}

/**
 * Computes the deterministic `rootHash` over a bundle's file entries.
 *
 * The entries are sorted by `path` in ascending byte order (raw `<`/`>`
 * comparison, not locale-aware) on a copy so the caller's array is not mutated,
 * then hashed as `sha256Hex(canonicalJson(sorted))`. Sorting makes the hash
 * order-insensitive: the same set of files produces the same `rootHash`
 * regardless of the order they were appended. Uses the protocol canonical-JSON
 * bytes and SHA-256 from the export-bundle shim so the digest matches what a
 * verifier recomputes. Async because the underlying SHA-256 helper is Promise-based.
 */
export async function computeRootHash(files: ExportBundleFileEntry[]): Promise<string> {
  const sorted = [...files].sort((left, right) => {
    if (left.path < right.path) return -1;
    if (left.path > right.path) return 1;
    return 0;
  });
  return sha256Hex(canonicalJson(sorted));
}

/**
 * A detached signature over an export bundle. `algorithm` names the signing
 * scheme, `publicKeyFingerprint` identifies the signing key (matching the
 * manifest's `signaturePublicKeyFingerprint`), and `signature` carries the
 * encoded signature value. The concrete Ed25519 signing/verification flow that
 * populates this record is added by a later task; {@link buildExportBundle}
 * never signs, so a bundle it produces has no `signature`.
 */
export interface ExportBundleSignature {
  algorithm: string;
  publicKeyFingerprint: string;
  signature: string;
}

/**
 * Input to {@link buildExportBundle}: the authoritative context plus the raw
 * record arrays that make up an export.
 *
 * `scope`, `range`, and `producer` are copied verbatim into the manifest.
 * `createdAt` is supplied by the caller so the build is fully deterministic (no
 * clock reads). `events`, `edges`, and `commits` are the raw record arrays that
 * become the bundle's `records/*.jsonl` files and are fed to the chain
 * verifiers; they are typed `unknown[]` because a builder may serialize records
 * that predate a schema change. `commits` defaults to an empty set when absent.
 * `annex` optionally attaches evidence packs, each written to its own annex file
 * and referenced from the manifest.
 */
export interface ExportBundleInput {
  scope: ExportBundleManifest["scope"];
  range: ExportBundleManifest["range"];
  producer: ExportBundleManifest["producer"];
  createdAt: string;
  events: unknown[];
  edges: unknown[];
  commits?: unknown[];
  annex?: {
    packId: string;
    version: string;
    entries: { dutyId: string; recordIds: string[] }[];
  }[];
}

/**
 * A fully assembled vevb-1 export bundle: the {@link ExportBundleManifest} index
 * plus the concrete file contents it describes. `files` maps each bundle-relative
 * path to its exact serialized string (the same bytes hashed into the manifest),
 * so a consumer can persist the bundle or recompute its hashes directly.
 * `signature` is present only once a bundle has been signed by a later task.
 */
export interface ExportBundle {
  bundleVersion: "vevb-1";
  manifest: ExportBundleManifest;
  files: Record<string, string>;
  signature?: ExportBundleSignature;
}

/**
 * Serializes a record array into a `.jsonl` payload. Each record is emitted as
 * its own canonical-JSON line joined by `\n` with a trailing `\n`, so the file
 * hash is stable regardless of how the records were constructed. An empty record
 * set serializes to `''` (no trailing newline) rather than a lone `\n`, matching
 * the vevb-1 rule that a zero-record file is still listed in the manifest but
 * carries no bytes.
 */
function serializeRecords(records: unknown[]): string {
  if (records.length === 0) return "";
  return `${records.map((record) => canonicalJson(record)).join("\n")}\n`;
}

/**
 * Builds a deterministic vevb-1 export bundle from raw record arrays.
 *
 * The build is a pure function of its input: it never reads a clock or any
 * randomness, so the same input always yields byte-identical files and manifest.
 * It serializes the audit-event, evidence-edge, and commit arrays into fixed
 * `records/*.jsonl` paths (see {@link serializeRecords}); runs the three chain
 * verifiers over the raw inputs and stores their `{ audit, edges, commits }`
 * verdicts as canonical JSON in `verification.json`; hashes every file with
 * {@link sha256Hex}; and binds the file entries with {@link computeRootHash}.
 * Optional annex packs are written to `annex/<packId>.json` (sorted by `packId`),
 * listed in `manifest.files` like every other file so they are covered by
 * `rootHash`, and summarized in `manifest.annex` as `{ packId, version }`. The
 * returned bundle is unsigned.
 */
export async function buildExportBundle(input: ExportBundleInput): Promise<ExportBundle> {
  const commits = input.commits ?? [];

  const sortedAnnex = input.annex
    ? [...input.annex].sort((left, right) => {
        if (left.packId < right.packId) return -1;
        if (left.packId > right.packId) return 1;
        return 0;
      })
    : undefined;

  // Fail closed on duplicate annex packIds: two packs sharing a packId would map
  // to one `annex/<packId>.json` key (last write wins) while manifest.files and
  // manifest.annex keep both, breaking the manifest↔files 1:1 invariant.
  if (sortedAnnex) {
    const seen = new Set<string>();
    for (const pack of sortedAnnex) {
      if (seen.has(pack.packId)) {
        throw new Error(`export bundle: duplicate annex packId "${pack.packId}"`);
      }
      seen.add(pack.packId);
    }
  }

  const trackedFiles: { path: string; content: string; records: number }[] = [
    { path: "records/audit-events.jsonl", content: serializeRecords(input.events), records: input.events.length },
    { path: "records/evidence-edges.jsonl", content: serializeRecords(input.edges), records: input.edges.length },
    { path: "records/commits.jsonl", content: serializeRecords(commits), records: commits.length },
    {
      path: "verification.json",
      content: canonicalJson({
        audit: verifyAuditChain(input.events),
        edges: verifyEdgeChain(input.edges),
        commits: verifyCommitChain(commits),
      }),
      records: 0,
    },
    ...(sortedAnnex ?? []).map((pack) => ({
      path: `annex/${pack.packId}.json`,
      content: canonicalJson(pack),
      records: pack.entries.length,
    })),
  ];

  const files: Record<string, string> = {};
  for (const file of trackedFiles) {
    files[file.path] = file.content;
  }

  const manifestFiles: ExportBundleFileEntry[] = await Promise.all(
    trackedFiles.map(async (entry) => ({
      path: entry.path,
      sha256: await sha256Hex(entry.content),
      records: entry.records,
    })),
  );

  const manifest: ExportBundleManifest = {
    bundleVersion: "vevb-1",
    createdAt: input.createdAt,
    scope: input.scope,
    range: input.range,
    producer: input.producer,
    files: manifestFiles,
    rootHash: await computeRootHash(manifestFiles),
    ...(sortedAnnex ? { annex: sortedAnnex.map((pack) => ({ packId: pack.packId, version: pack.version })) } : {}),
  };

  return { bundleVersion: "vevb-1", manifest, files };
}

/**
 * Serializes a full {@link ExportBundle} into its single-file container form:
 * the canonical JSON of the entire bundle. Routing through {@link canonicalJson}
 * (rather than `JSON.stringify`) keeps the container bytes deterministic and
 * key-sorted, so the same bundle always produces identical container text and a
 * downstream signature or hash over the container is stable.
 */
export function serializeExportBundle(bundle: ExportBundle): string {
  return canonicalJson(bundle);
}

/**
 * Parses a single-file container string back into an {@link ExportBundle}.
 *
 * This performs only the structural checks needed to trust the container shape,
 * not deep schema or integrity validation (the verifier owns that). It rejects,
 * with a sanitized `Error`, text that is not valid JSON or not a JSON object
 * (`'export bundle: invalid JSON container'`, never leaking the raw parser
 * message), any `bundleVersion` other than `'vevb-1'`
 * (`'export bundle: unsupported bundleVersion …'`), and a container whose
 * `manifest` or `files` is missing or not an object
 * (`'export bundle: missing manifest or files'`).
 */
export function parseExportBundle(text: string): ExportBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("export bundle: invalid JSON container");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("export bundle: invalid JSON container");
  }

  const container = parsed as Record<string, unknown>;

  if (container.bundleVersion !== "vevb-1") {
    throw new Error(`export bundle: unsupported bundleVersion ${JSON.stringify(container.bundleVersion)}`);
  }

  if (
    typeof container.manifest !== "object" ||
    container.manifest === null ||
    typeof container.files !== "object" ||
    container.files === null
  ) {
    throw new Error("export bundle: missing manifest or files");
  }

  return parsed as ExportBundle;
}

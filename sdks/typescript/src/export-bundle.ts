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

import { canonicalJson, sha256Hex } from "./export-bundle-deps";

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

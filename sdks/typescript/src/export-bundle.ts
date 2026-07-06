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

/**
 * The result of {@link verifyExportBundle}: an offline verdict over a vevb-1
 * bundle. `valid` is the single fail-closed answer a consumer trusts; it is true
 * only when every check holds. `checks` breaks the verdict into the four
 * independent gates — `structure` (manifest↔files shape and required paths),
 * `integrity` (per-file and root-hash recomputation), `chains` (record hash
 * chains re-verified and matched against the embedded report), and `signature`
 * (`'absent'` until Task 5 wires real detached-signature verification). `issues`
 * carries sanitized, static failure descriptions — a path or packId may be
 * embedded, but never raw error text or record content.
 */
export interface ExportBundleVerificationReport {
  valid: boolean;
  checks: {
    structure: boolean;
    integrity: boolean;
    chains: boolean;
    signature: "valid" | "invalid" | "absent" | "skipped";
  };
  issues: string[];
}

/** The three fixed record files that carry hash-chained evidence. */
const RECORD_PATHS = ["records/audit-events.jsonl", "records/evidence-edges.jsonl", "records/commits.jsonl"] as const;

/** Every path a well-formed manifest must list, independent of optional annex. */
const REQUIRED_PATHS = [...RECORD_PATHS, "verification.json"] as const;

/** Narrows a value to a non-null, non-array plain object before inspection. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Splits a `.jsonl` payload into its record lines. Records are `\n`-joined with a
 * single trailing newline (see {@link serializeRecords}), so the one empty
 * segment the trailing newline produces is dropped. An empty payload is zero
 * records, matching the zero-record file rule.
 */
function splitRecordLines(payload: string): string[] {
  if (payload === "") return [];
  const lines = payload.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * Fail-closed offline verifier for a vevb-1 export bundle.
 *
 * Runs four independent gates over a bundle without any network or authority
 * call, so a recipient can trust an export purely from its bytes:
 *
 * - **structure** — `manifest` and `files` must be real objects and
 *   `manifest.files` a real array (the container parser's guards are shallow and
 *   deliberately let arrays through, so they are caught here); manifest paths and
 *   `files` keys must map 1:1 with no duplicates; and the three `records/*.jsonl`
 *   files plus `verification.json` must be present.
 * - **integrity** — every file's SHA-256 is recomputed from its bytes and
 *   compared to the manifest entry, `rootHash` is recomputed via
 *   {@link computeRootHash}, and each record file's line count is matched to its
 *   declared `records` count.
 * - **chains** — each record file is parsed back and re-run through the shim
 *   chain verifiers, whose `valid` verdicts must equal the embedded
 *   `verification.json`.
 * - **signature** — always `'absent'` in this task; when
 *   `opts.requireSignature` is set and no signature is present the bundle is
 *   invalid. Task 5 extends only this branch with real signature verification.
 *
 * Content problems never throw — they land in the report as sanitized issue
 * strings and drive `valid` to false. The function throws only for programmer
 * misuse: a `bundle` that is not an object.
 */
export async function verifyExportBundle(
  bundle: ExportBundle,
  opts?: { publicKey?: CryptoKey; requireSignature?: boolean },
): Promise<ExportBundleVerificationReport> {
  if (!isPlainObject(bundle)) {
    throw new TypeError("verifyExportBundle: expected an ExportBundle object");
  }

  const issues: string[] = [];
  const manifest = (bundle as ExportBundle).manifest;
  const files = (bundle as ExportBundle).files;

  // Signature: this task never verifies a signature, so the verdict is always
  // 'absent' and `signatureSatisfied` is the single gate the overall verdict
  // reads. Only a required-but-missing signature fails it here; Task 5 extends
  // this branch to set `signature` to 'valid'/'invalid'/'skipped' and drive
  // `signatureSatisfied` from real detached-signature verification.
  const signature: ExportBundleVerificationReport["checks"]["signature"] = "absent";
  const hasSignature = isPlainObject((bundle as ExportBundle).signature);
  let signatureSatisfied = true;
  if (opts?.requireSignature && !hasSignature) {
    signatureSatisfied = false;
    issues.push("signature required but absent");
  }

  // Structure: prove the shape is safe to iterate before any hashing runs.
  let structure = true;
  const manifestOk = isPlainObject(manifest);
  const filesOk = isPlainObject(files);
  const manifestFilesOk = manifestOk && Array.isArray(manifest.files);

  if (!manifestOk) {
    structure = false;
    issues.push("manifest is not an object");
  }
  if (!filesOk) {
    structure = false;
    issues.push("files is not an object");
  }
  if (manifestOk && !Array.isArray(manifest.files)) {
    structure = false;
    issues.push("manifest.files is not an array");
  }

  const canInspect = filesOk && manifestFilesOk;
  if (!canInspect) {
    return {
      valid: false,
      checks: { structure: false, integrity: false, chains: false, signature },
      issues,
    };
  }

  const manifestFiles = manifest.files;
  const fileKeys = Object.keys(files);
  const manifestPaths: string[] = [];
  for (const entry of manifestFiles) {
    if (!isPlainObject(entry) || typeof entry.path !== "string") {
      structure = false;
      issues.push("manifest.files entry is malformed");
      continue;
    }
    if (manifestPaths.includes(entry.path)) {
      structure = false;
      issues.push(`duplicate manifest path ${entry.path}`);
    }
    manifestPaths.push(entry.path);
  }
  for (const path of manifestPaths) {
    if (!fileKeys.includes(path)) {
      structure = false;
      issues.push(`missing file payload for ${path}`);
    }
  }
  for (const key of fileKeys) {
    if (!manifestPaths.includes(key)) {
      structure = false;
      issues.push(`file key ${key} not listed in manifest`);
    }
  }
  for (const required of REQUIRED_PATHS) {
    if (!manifestPaths.includes(required)) {
      structure = false;
      issues.push(`required path missing: ${required}`);
    }
  }

  // Integrity: recompute every per-file hash and the binding rootHash, and match
  // each record file's declared count to its actual line count.
  let integrity = true;
  // computeRootHash sorts and canonicalizes the raw manifest entries, so a
  // malformed entry (e.g. a null in an otherwise array-shaped files list) can
  // throw. Contain it here — a crafted bundle must fail closed, never escape.
  try {
    const recomputedRoot = await computeRootHash(manifestFiles);
    if (recomputedRoot !== manifest.rootHash) {
      integrity = false;
      issues.push("rootHash does not bind the manifest files");
    }
  } catch {
    integrity = false;
    issues.push("rootHash could not be computed");
  }
  for (const entry of manifestFiles) {
    if (!isPlainObject(entry) || typeof entry.path !== "string") continue;
    const payload = files[entry.path];
    if (typeof payload !== "string") {
      integrity = false;
      issues.push(`missing payload for ${entry.path}`);
      continue;
    }
    if ((await sha256Hex(payload)) !== entry.sha256) {
      integrity = false;
      issues.push(`sha256 mismatch for ${entry.path}`);
    }
    if ((RECORD_PATHS as readonly string[]).includes(entry.path)) {
      if (entry.records !== splitRecordLines(payload).length) {
        integrity = false;
        issues.push(`record count mismatch for ${entry.path}`);
      }
    }
  }

  // Chains: parse each record file back and re-verify it, then confirm the fresh
  // verdicts agree with the embedded verification report.
  let chains = true;
  const parsedRecords: Record<string, unknown[]> = {};
  let allRecordsParsed = true;
  for (const path of RECORD_PATHS) {
    const payload = files[path];
    if (typeof payload !== "string") {
      chains = false;
      allRecordsParsed = false;
      issues.push(`unparseable record line in ${path}`);
      parsedRecords[path] = [];
      continue;
    }
    const records: unknown[] = [];
    let parsedOk = true;
    for (const line of splitRecordLines(payload)) {
      try {
        records.push(JSON.parse(line));
      } catch {
        chains = false;
        allRecordsParsed = false;
        parsedOk = false;
        issues.push(`unparseable record line in ${path}`);
        break;
      }
    }
    parsedRecords[path] = records;
    if (!parsedOk) continue;
  }

  if (allRecordsParsed) {
    const auditVerdict = verifyAuditChain(parsedRecords["records/audit-events.jsonl"] ?? []);
    const edgeVerdict = verifyEdgeChain(parsedRecords["records/evidence-edges.jsonl"] ?? []);
    const commitVerdict = verifyCommitChain(parsedRecords["records/commits.jsonl"] ?? []);

    let embedded: unknown;
    const embeddedPayload = files["verification.json"];
    if (typeof embeddedPayload === "string") {
      try {
        embedded = JSON.parse(embeddedPayload);
      } catch {
        embedded = undefined;
      }
    }

    if (
      !isPlainObject(embedded) ||
      !isPlainObject(embedded.audit) ||
      !isPlainObject(embedded.edges) ||
      !isPlainObject(embedded.commits)
    ) {
      chains = false;
      issues.push("embedded verification report unreadable");
    } else if (
      auditVerdict.valid !== embedded.audit.valid ||
      edgeVerdict.valid !== embedded.edges.valid ||
      commitVerdict.valid !== embedded.commits.valid
    ) {
      chains = false;
      issues.push("embedded verification report disagrees");
    }
  }

  const valid = structure && integrity && chains && signatureSatisfied;

  return {
    valid,
    checks: { structure, integrity, chains, signature },
    issues,
  };
}

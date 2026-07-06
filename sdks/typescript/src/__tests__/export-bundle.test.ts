import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ExportBundle } from "../export-bundle";
import {
  buildExportBundle,
  computeRootHash,
  parseExportBundle,
  serializeExportBundle,
  signExportBundle,
  verifyExportBundle,
} from "../export-bundle";
import { canonicalJson, sha256Hex } from "../export-bundle-deps";

test("shim: canonical json is key-sorted and stable", () => {
  expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
});

test("shim: sha256Hex known vector", async () => {
  const digest = await sha256Hex("veritio");
  expect(digest).toMatch(/^[0-9a-f]{64}$/);
  expect(digest).toBe("52697555d7348e7b9fac530bb016338c1e471022818d61c1282e637bd9e1a393");
});

test("rootHash is order-insensitive over file entries", async () => {
  const a = { path: "records/audit-events.jsonl", sha256: "aa".repeat(32), records: 2 };
  const b = { path: "records/evidence-edges.jsonl", sha256: "bb".repeat(32), records: 1 };
  expect(await computeRootHash([a, b])).toBe(await computeRootHash([b, a]));
  expect(await computeRootHash([a, b])).toMatch(/^[0-9a-f]{64}$/);
});

const buildInput = {
  scope: { tenantId: "ten_1" },
  range: { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" },
  producer: { authority: "veritio", kind: "principal" as const, type: "service" as const, id: "svc_test" },
  createdAt: "2026-07-06T00:00:00Z",
  events: [
    { id: "evt_1", n: 1 },
    { id: "evt_2", n: 2 },
  ],
  edges: [{ id: "edge_1" }],
};

test("build is deterministic and lists all fixed paths", async () => {
  const one = await buildExportBundle(buildInput);
  const two = await buildExportBundle(buildInput);
  expect(one).toEqual(two);
  const paths = one.manifest.files.map((f) => f.path);
  expect(paths).toContain("records/audit-events.jsonl");
  expect(paths).toContain("records/evidence-edges.jsonl");
  expect(paths).toContain("records/commits.jsonl");
  expect(paths).toContain("verification.json");
  expect(one.files["records/audit-events.jsonl"].endsWith("\n")).toBe(true);
  expect(one.manifest.files.find((f) => f.path === "records/audit-events.jsonl")?.records).toBe(2);
});

test("annex files join manifest.files and files keys map 1:1", async () => {
  const bundle = await buildExportBundle({
    ...buildInput,
    annex: [
      { packId: "pack_b", version: "1", entries: [{ dutyId: "duty_1", recordIds: ["r1"] }] },
      {
        packId: "pack_a",
        version: "2",
        entries: [
          { dutyId: "duty_2", recordIds: ["r2", "r3"] },
          { dutyId: "duty_3", recordIds: ["r4"] },
        ],
      },
    ],
  });

  const annexEntry = bundle.manifest.files.find((f) => f.path === "annex/pack_a.json");
  expect(annexEntry).toBeDefined();
  expect(annexEntry?.records).toBe(2);
  expect(annexEntry?.sha256).toMatch(/^[0-9a-f]{64}$/);

  // manifest.annex stays a { packId, version } summary, sorted by packId.
  expect(bundle.manifest.annex).toEqual([
    { packId: "pack_a", version: "2" },
    { packId: "pack_b", version: "1" },
  ]);

  // Every manifest path has exactly one file entry, and vice versa (1:1).
  const manifestPaths = bundle.manifest.files.map((f) => f.path).sort();
  const fileKeys = Object.keys(bundle.files).sort();
  expect(fileKeys).toEqual(manifestPaths);
  expect(manifestPaths).toContain("annex/pack_a.json");
  expect(manifestPaths).toContain("annex/pack_b.json");
});

test("duplicate annex packId fails closed", async () => {
  await expect(
    buildExportBundle({
      ...buildInput,
      annex: [
        { packId: "pack_dup", version: "1", entries: [{ dutyId: "duty_1", recordIds: ["r1"] }] },
        { packId: "pack_dup", version: "2", entries: [{ dutyId: "duty_2", recordIds: ["r2"] }] },
      ],
    }),
  ).rejects.toThrow(/duplicate annex packId/);
});

test("non-ASCII annex packId fails closed", async () => {
  await expect(
    buildExportBundle({
      ...buildInput,
      annex: [{ packId: "pack_é", version: "1", entries: [{ dutyId: "duty_1", recordIds: ["r1"] }] }],
    }),
  ).rejects.toThrow(/annex packId must be printable ASCII/);
});

test("serialize/parse round-trips a built bundle", async () => {
  const built = await buildExportBundle(buildInput);
  expect(parseExportBundle(serializeExportBundle(built))).toEqual(built);
});

test("serialize emits canonical JSON of the whole container", async () => {
  const built = await buildExportBundle(buildInput);
  expect(serializeExportBundle(built)).toBe(canonicalJson(built));
});

test("parse rejects unknown bundleVersion", () => {
  expect(() => parseExportBundle(JSON.stringify({ bundleVersion: "vevb-9", manifest: {}, files: {} }))).toThrow(
    /unsupported bundleVersion/,
  );
});

test("parse rejects invalid JSON container", () => {
  expect(() => parseExportBundle("not json")).toThrow("export bundle: invalid JSON container");
});

test("parse rejects a non-object container", () => {
  expect(() => parseExportBundle("42")).toThrow("export bundle: invalid JSON container");
});

test("parse rejects a container missing manifest or files", () => {
  expect(() => parseExportBundle(JSON.stringify({ bundleVersion: "vevb-1", files: {} }))).toThrow(
    "export bundle: missing manifest or files",
  );
  expect(() => parseExportBundle(JSON.stringify({ bundleVersion: "vevb-1", manifest: {} }))).toThrow(
    "export bundle: missing manifest or files",
  );
});

test("a built bundle verifies with every check passing", async () => {
  const bundle = await buildExportBundle(buildInput);
  const report = await verifyExportBundle(bundle);
  expect(report.valid).toBe(true);
  expect(report.checks).toEqual({ structure: true, integrity: true, chains: true, signature: "absent" });
  expect(report.issues).toEqual([]);
});

test("tampering one record byte fails integrity", async () => {
  const bundle = await buildExportBundle(buildInput);
  bundle.files["records/audit-events.jsonl"] = bundle.files["records/audit-events.jsonl"].replace('"n":1', '"n":9');
  const report = await verifyExportBundle(bundle);
  expect(report.valid).toBe(false);
  expect(report.checks.integrity).toBe(false);
});

test("an extra files key with no manifest entry fails structure only", async () => {
  const bundle = await buildExportBundle(buildInput);
  bundle.files["records/extra.jsonl"] = "x\n";
  const report = await verifyExportBundle(bundle);
  expect(report.checks.structure).toBe(false);
  // The manifest is untouched, so integrity still recomputes cleanly.
  expect(report.checks.integrity).toBe(true);
  expect(report.valid).toBe(false);
});

test("a removed manifest.files entry fails structure", async () => {
  const bundle = await buildExportBundle(buildInput);
  bundle.manifest.files = bundle.manifest.files.filter((f) => f.path !== "records/commits.jsonl");
  const report = await verifyExportBundle(bundle);
  expect(report.checks.structure).toBe(false);
  expect(report.valid).toBe(false);
});

test("a rootHash that does not bind the files fails integrity", async () => {
  const bundle = await buildExportBundle(buildInput);
  bundle.manifest.rootHash = "deadbeef".repeat(8);
  const report = await verifyExportBundle(bundle);
  expect(report.checks.integrity).toBe(false);
  // Paths are intact, so structure stays true — this isolates integrity.
  expect(report.checks.structure).toBe(true);
  expect(report.valid).toBe(false);
});

test("an unparseable record line fails chains only", async () => {
  const bundle = await buildExportBundle(buildInput);
  const badPayload = "not json\n";
  bundle.files["records/evidence-edges.jsonl"] = badPayload;
  const entry = bundle.manifest.files.find((f) => f.path === "records/evidence-edges.jsonl");
  if (!entry) throw new Error("missing edges entry");
  entry.sha256 = await sha256Hex(badPayload);
  entry.records = 1;
  bundle.manifest.rootHash = await computeRootHash(bundle.manifest.files);
  const report = await verifyExportBundle(bundle);
  expect(report.checks.integrity).toBe(true);
  expect(report.checks.chains).toBe(false);
  expect(report.valid).toBe(false);
  expect(report.issues).toContain("unparseable record line in records/evidence-edges.jsonl");
});

test("an embedded verification report that disagrees fails chains", async () => {
  const bundle = await buildExportBundle(buildInput);
  const embedded = JSON.parse(bundle.files["verification.json"]);
  embedded.audit.valid = !embedded.audit.valid;
  const newContent = canonicalJson(embedded);
  bundle.files["verification.json"] = newContent;
  const entry = bundle.manifest.files.find((f) => f.path === "verification.json");
  if (!entry) throw new Error("missing verification entry");
  entry.sha256 = await sha256Hex(newContent);
  bundle.manifest.rootHash = await computeRootHash(bundle.manifest.files);
  const report = await verifyExportBundle(bundle);
  expect(report.checks.integrity).toBe(true);
  expect(report.checks.chains).toBe(false);
  expect(report.issues).toContain("embedded verification report disagrees");
});

test("requireSignature on an unsigned bundle is invalid", async () => {
  const bundle = await buildExportBundle(buildInput);
  const report = await verifyExportBundle(bundle, { requireSignature: true });
  expect(report.valid).toBe(false);
  expect(report.checks.signature).toBe("absent");
  expect(report.issues).toContain("signature required but absent");
});

test("a signed bundle verifies as 'valid' with the matching public key", async () => {
  const bundle = await buildExportBundle(buildInput);
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const signed = await signExportBundle(bundle, keyPair.privateKey, keyPair.publicKey);

  expect(signed.signature?.algorithm).toBe("ed25519");
  expect(signed.manifest.signaturePublicKeyFingerprint).toBe(signed.signature?.publicKeyFingerprint);

  const report = await verifyExportBundle(signed, { publicKey: keyPair.publicKey });
  expect(report.checks.signature).toBe("valid");
  expect(report.valid).toBe(true);
});

test("a flipped signature byte verifies as 'invalid'", async () => {
  const bundle = await buildExportBundle(buildInput);
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const signed = await signExportBundle(bundle, keyPair.privateKey, keyPair.publicKey);

  const original = signed.signature?.signature ?? "";
  const flipped = original[0] === "A" ? `B${original.slice(1)}` : `A${original.slice(1)}`;
  signed.signature = { ...signed.signature!, signature: flipped };

  const report = await verifyExportBundle(signed, { publicKey: keyPair.publicKey });
  expect(report.checks.signature).toBe("invalid");
  expect(report.valid).toBe(false);
});

test("tampering the manifest after signing verifies as 'invalid'", async () => {
  const bundle = await buildExportBundle(buildInput);
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const signed = await signExportBundle(bundle, keyPair.privateKey, keyPair.publicKey);

  signed.manifest.createdAt = "2099-01-01T00:00:00Z";

  const report = await verifyExportBundle(signed, { publicKey: keyPair.publicKey });
  expect(report.checks.signature).toBe("invalid");
  expect(report.valid).toBe(false);
});

test("a signed bundle verified without a public key is 'skipped' and valid", async () => {
  const bundle = await buildExportBundle(buildInput);
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const signed = await signExportBundle(bundle, keyPair.privateKey, keyPair.publicKey);

  const report = await verifyExportBundle(signed);
  expect(report.checks.signature).toBe("skipped");
  expect(report.valid).toBe(true);
});

test("a fingerprint mismatch verifies as 'invalid'", async () => {
  const bundle = await buildExportBundle(buildInput);
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const otherPair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const signed = await signExportBundle(bundle, keyPair.privateKey, keyPair.publicKey);

  const report = await verifyExportBundle(signed, { publicKey: otherPair.publicKey });
  expect(report.checks.signature).toBe("invalid");
  expect(report.issues).toContain("signature public key fingerprint mismatch");
});

test("an unsupported signature algorithm verifies as 'invalid'", async () => {
  const bundle = await buildExportBundle(buildInput);
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const signed = await signExportBundle(bundle, keyPair.privateKey, keyPair.publicKey);
  signed.signature = { ...signed.signature!, algorithm: "rsa-pss" as never };

  const report = await verifyExportBundle(signed, { publicKey: keyPair.publicKey });
  expect(report.checks.signature).toBe("invalid");
  expect(report.issues).toContain("unsupported signature algorithm");
});

test("signExportBundle does not mutate its input bundle", async () => {
  const bundle = await buildExportBundle(buildInput);
  const snapshot = JSON.parse(JSON.stringify(bundle));
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  await signExportBundle(bundle, keyPair.privateKey, keyPair.publicKey);

  expect(bundle.signature).toBeUndefined();
  expect(bundle.manifest.signaturePublicKeyFingerprint).toBeUndefined();
  expect(bundle).toEqual(snapshot);
});

test("a non-object bundle is programmer misuse and throws", async () => {
  await expect(verifyExportBundle(null as never)).rejects.toThrow(/expected an ExportBundle/);
  await expect(verifyExportBundle([] as never)).rejects.toThrow(/expected an ExportBundle/);
});

test("a nullish manifest.files entry fails closed instead of throwing", async () => {
  const bundle = await buildExportBundle(buildInput);
  // A crafted manifest whose files array holds a null entry passes Array.isArray
  // but makes computeRootHash's comparator dereference `.path` on null.
  bundle.manifest.files = [...bundle.manifest.files, null as never];
  const report = await verifyExportBundle(bundle);
  expect(report.valid).toBe(false);
  expect(report.checks.integrity).toBe(false);
  expect(report.issues).toContain("rootHash could not be computed");
});

// Pinned cross-implementation conformance: the golden and tampered fixtures in
// spec/conformance are committed bytes (never regenerated in CI). The golden
// bundle is a complete SIGNED vevb-1 container over real record envelopes; the
// tampered fixture is the same bytes with a single record byte flipped. Both
// carry the RAW verifying public key as hex (never the private key) so any
// implementation can reproduce the verdict offline.
const CONFORMANCE_DIR = join(import.meta.dir, "../../../../spec/conformance");

interface ExportBundleConformanceFixture {
  publicKeyHex: string;
  bundle: ExportBundle;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function importFixturePublicKey(hex: string): Promise<CryptoKey> {
  const bytes = hexToBytes(hex);
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return crypto.subtle.importKey("raw", buffer, "Ed25519", true, ["verify"]);
}

async function loadExportBundleFixture(fileName: string): Promise<ExportBundleConformanceFixture> {
  return (await Bun.file(join(CONFORMANCE_DIR, fileName)).json()) as ExportBundleConformanceFixture;
}

test("conformance: golden bundle parses and verifies as signed + valid", async () => {
  const fixture = await loadExportBundleFixture("export-bundle-golden.json");
  // Prove the pinned bundle survives the container parser, then verify it against
  // the fixture's own public key imported from raw hex.
  const bundle = parseExportBundle(serializeExportBundle(fixture.bundle));
  expect(bundle).toEqual(fixture.bundle);

  const publicKey = await importFixturePublicKey(fixture.publicKeyHex);
  const report = await verifyExportBundle(bundle, { publicKey });
  expect(report.checks.signature).toBe("valid");
  expect(report.valid).toBe(true);
});

test("conformance: tampered bundle fails verification", async () => {
  const fixture = await loadExportBundleFixture("export-bundle-tampered.json");
  const publicKey = await importFixturePublicKey(fixture.publicKeyHex);
  const report = await verifyExportBundle(fixture.bundle, { publicKey });
  expect(report.valid).toBe(false);
  expect(report.checks.signature).toBe("valid");
  expect(report.checks.integrity).toBe(false);
  expect(report.checks.chains).toBe(false);
});

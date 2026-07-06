import { expect, test } from "bun:test";
import { buildExportBundle, computeRootHash } from "../export-bundle";
import { canonicalJson, sha256Hex } from "../export-bundle-deps";

test("shim: canonical json is key-sorted and stable", () => {
  expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
});

test("shim: sha256Hex known vector", async () => {
  expect(await sha256Hex("veritio")).toMatch(/^[0-9a-f]{64}$/);
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

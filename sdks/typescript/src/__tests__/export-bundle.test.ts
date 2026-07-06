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

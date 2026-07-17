import { describe, expect, test } from "bun:test";
import type { AuditRecord, ExportBundle } from "../index";
import { buildExportBundle, parseExportBundle, verifyExportBundle } from "../index";

/**
 * Conformance coverage for vevb-1 chain scopes (spec/export-bundle.md § 6a),
 * pinned by the windowed/filtered fixtures. The fixtures are verified as
 * bytes-on-disk; the negative cases mutate copies to prove each scope still
 * fails closed on the tampering it claims to detect.
 */
async function loadFixture(
  name: string,
): Promise<{ expected: { valid: boolean; chainScope: string }; bundle: ExportBundle }> {
  return (await Bun.file(new URL(`../../../../spec/conformance/${name}.json`, import.meta.url).pathname).json()) as {
    expected: { valid: boolean; chainScope: string };
    bundle: ExportBundle;
  };
}

/** Deep-copies a fixture bundle so mutations never leak between tests. */
function clone(bundle: ExportBundle): ExportBundle {
  return JSON.parse(JSON.stringify(bundle)) as ExportBundle;
}

/** Parses a bundle's audit records for targeted tampering. */
function auditRecords(bundle: ExportBundle): AuditRecord[] {
  return bundle.files["records/audit-events.jsonl"]!.split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AuditRecord);
}

describe("windowed chain scope", () => {
  test("the pinned windowed fixture verifies valid with chainScope 'windowed'", async () => {
    const fixture = await loadFixture("export-bundle-windowed");
    const report = await verifyExportBundle(fixture.bundle);
    expect(report.valid).toBe(true);
    expect(report.chainScope).toBe("windowed");
    expect(report.issues).toEqual([]);
  });

  test("the same mid-chain records fail closed under the strict full rule", async () => {
    const fixture = await loadFixture("export-bundle-windowed");
    const stripped = clone(fixture.bundle);
    delete (stripped.manifest as { chainScope?: string }).chainScope;
    const report = await verifyExportBundle(stripped);
    // Integrity necessarily breaks too (the manifest changed), but the chain
    // gate itself must reject a mid-chain start once the claim is 'full'.
    expect(report.valid).toBe(false);
    expect(report.checks.chains).toBe(false);
    expect(report.chainScope).toBe("full");
  });

  test("an interior gap inside a window is a removal, not a filter", async () => {
    const fixture = await loadFixture("export-bundle-windowed");
    const records = auditRecords(fixture.bundle);
    const gapped = await buildExportBundle({
      scope: fixture.bundle.manifest.scope,
      range: fixture.bundle.manifest.range,
      producer: fixture.bundle.manifest.producer,
      createdAt: fixture.bundle.manifest.createdAt,
      chainScope: "windowed",
      events: [records[0], records[2]],
      edges: [],
    });
    const report = await verifyExportBundle(gapped);
    expect(report.valid).toBe(false);
    expect(report.checks.chains).toBe(false);
  });
});

describe("filtered chain scope", () => {
  test("the pinned filtered fixture verifies valid with chainScope 'filtered'", async () => {
    const fixture = await loadFixture("export-bundle-filtered");
    const report = await verifyExportBundle(fixture.bundle);
    expect(report.valid).toBe(true);
    expect(report.chainScope).toBe("filtered");
    expect(report.issues).toEqual([]);
    expect(fixture.bundle.manifest.filters).toEqual({
      workspaceId: "wks_scoped_fixture",
      actionPrefixes: ["agent."],
    });
  });

  test("tampering a record byte still fails a filtered bundle", async () => {
    const fixture = await loadFixture("export-bundle-filtered");
    const records = auditRecords(fixture.bundle);
    (records[1]!.event.metadata as Record<string, unknown>).position = 999;
    const tampered = await buildExportBundle({
      scope: fixture.bundle.manifest.scope,
      range: fixture.bundle.manifest.range,
      producer: fixture.bundle.manifest.producer,
      createdAt: fixture.bundle.manifest.createdAt,
      chainScope: "filtered",
      filters: fixture.bundle.manifest.filters,
      events: records,
      edges: [],
    });
    const report = await verifyExportBundle(tampered);
    expect(report.valid).toBe(false);
    expect(report.checks.chains).toBe(false);
  });

  test("reordered sequences fail the strictly-increasing rule", async () => {
    const fixture = await loadFixture("export-bundle-filtered");
    const records = auditRecords(fixture.bundle);
    const reordered = await buildExportBundle({
      scope: fixture.bundle.manifest.scope,
      range: fixture.bundle.manifest.range,
      producer: fixture.bundle.manifest.producer,
      createdAt: fixture.bundle.manifest.createdAt,
      chainScope: "filtered",
      filters: fixture.bundle.manifest.filters,
      events: [records[1], records[0], records[2]],
      edges: [],
    });
    const report = await verifyExportBundle(reordered);
    expect(report.valid).toBe(false);
    expect(report.checks.chains).toBe(false);
  });
});

describe("scope declaration fail-closed rules", () => {
  test("build rejects filters without the filtered claim and vice versa", async () => {
    const fixture = await loadFixture("export-bundle-filtered");
    const base = {
      scope: fixture.bundle.manifest.scope,
      range: fixture.bundle.manifest.range,
      producer: fixture.bundle.manifest.producer,
      createdAt: fixture.bundle.manifest.createdAt,
      events: [] as unknown[],
      edges: [] as unknown[],
    };
    expect(buildExportBundle({ ...base, filters: { actionPrefixes: ["agent."] } })).rejects.toThrow(
      "filters require chainScope 'filtered'",
    );
    expect(buildExportBundle({ ...base, chainScope: "filtered" })).rejects.toThrow("requires a filters declaration");
  });

  test("verify rejects an unknown chainScope and undeclared filters as structure errors", async () => {
    const fixture = await loadFixture("export-bundle-windowed");
    const unknownScope = clone(fixture.bundle);
    (unknownScope.manifest as { chainScope?: string }).chainScope = "partial";
    const unknownReport = await verifyExportBundle(unknownScope);
    expect(unknownReport.valid).toBe(false);
    expect(unknownReport.checks.structure).toBe(false);

    const undeclared = clone(fixture.bundle);
    (undeclared.manifest as { filters?: unknown }).filters = { actionPrefixes: ["agent."] };
    const undeclaredReport = await verifyExportBundle(undeclared);
    expect(undeclaredReport.valid).toBe(false);
    expect(undeclaredReport.checks.structure).toBe(false);
  });

  test("fixture bytes round-trip through parseExportBundle", async () => {
    const fixture = await loadFixture("export-bundle-windowed");
    const parsed = parseExportBundle(JSON.stringify(fixture.bundle));
    expect((await verifyExportBundle(parsed)).valid).toBe(true);
  });
});

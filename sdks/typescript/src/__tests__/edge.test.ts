import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { EvidenceEdge, EvidenceEdgeInput } from "../index";
import {
  createEvidenceEdge,
  hashEvidenceEdge,
  hashEvidenceEdgeRecord,
  hashIdempotencyKey,
  verifyEvidenceEdgeRecords,
} from "../index";

const CONFORMANCE_DIR = join(import.meta.dir, "../../../../spec/conformance");

interface EdgeCreationFixture {
  cases: Array<{
    name: string;
    input: EvidenceEdgeInput;
    expected: EvidenceEdge;
  }>;
}

interface EdgeHashingFixture {
  cases: Array<{
    name: string;
    edge: EvidenceEdge;
    previousHash: string | null;
    expectedHash: string;
  }>;
}

interface EdgeRecordHashingFixture {
  cases: Array<{
    name: string;
    tenantId: string;
    idempotencyKey: string;
    expectedIdempotencyKeyHash: string;
    recordWithoutHash: Parameters<typeof hashEvidenceEdgeRecord>[0];
    expectedHash: string;
  }>;
}

interface RedactionFixture {
  cases: Array<{
    name: string;
    metadata: Record<string, unknown>;
    expectedMetadata: Record<string, unknown>;
  }>;
}

async function loadConformanceFixture<T>(fileName: string): Promise<T> {
  return (await Bun.file(join(CONFORMANCE_DIR, fileName)).json()) as T;
}

describe("evidence edge schema", () => {
  test("defines separate graph edge records without changing audit events", async () => {
    const schema = (await Bun.file("spec/edge.schema.json").json()) as {
      required: string[];
      properties: {
        schemaVersion: { const: string };
        from: { $ref: string };
        relation: { enum: string[] };
        to: { $ref: string };
      };
      $defs: {
        entity: {
          required: string[];
          properties: {
            type: { enum: string[] };
            id: { minLength: number };
          };
        };
      };
    };

    expect(schema.required).toEqual(["id", "schemaVersion", "occurredAt", "from", "relation", "to", "metadata"]);
    expect(schema.properties.schemaVersion.const).toBe("2026-06-13");
    expect(schema.properties.from.$ref).toBe("#/$defs/entity");
    expect(schema.properties.to.$ref).toBe("#/$defs/entity");
    expect(schema.properties.relation.enum).toContain("created");
    expect(schema.properties.relation.enum).toContain("deployed_as");
    expect(schema.$defs.entity.required).toEqual(["type", "id"]);
    expect(schema.$defs.entity.properties.type.enum).toContain("agent_session");
    expect(schema.$defs.entity.properties.type.enum).toContain("file");
    expect(schema.$defs.entity.properties.id.minLength).toBe(1);
  });

  test("defines a tenant-scoped graph edge record envelope", async () => {
    const schema = (await Bun.file("spec/edge-record.schema.json").json()) as {
      required: string[];
      properties: {
        edge: {
          allOf: [
            unknown,
            {
              required: string[];
              properties: {
                scope: {
                  required: string[];
                  properties: {
                    tenantId: {
                      minLength: number;
                    };
                  };
                };
              };
            },
          ];
        };
      };
    };

    expect(schema.required).toEqual([
      "edge",
      "sequence",
      "previousHash",
      "hash",
      "hashAlgorithm",
      "canonicalization",
      "appendedAt",
      "idempotencyKeyHash",
    ]);
    expect(schema.properties.edge.allOf[1].required).toContain("scope");
    expect(schema.properties.edge.allOf[1].properties.scope.required).toContain("tenantId");
    expect(schema.properties.edge.allOf[1].properties.scope.properties.tenantId.minLength).toBe(1);
  });
});

describe("createEvidenceEdge", () => {
  test("matches edge creation conformance fixtures", async () => {
    const fixture = await loadConformanceFixture<EdgeCreationFixture>("edge-creation.json");

    for (const conformanceCase of fixture.cases) {
      expect(createEvidenceEdge(conformanceCase.input)).toEqual(conformanceCase.expected);
    }
  });

  test("rejects unsupported edge relations", () => {
    expect(() =>
      createEvidenceEdge({
        id: "edge_invalid_relation",
        occurredAt: "2026-06-13T00:00:00.000Z",
        from: { type: "agent_session", id: "agt_sess_123" },
        relation: "linked_to" as never,
        to: { type: "file", id: "file_123" },
        metadata: {},
      }),
    ).toThrow("relation must be a supported evidence graph relation");
  });

  test("requires stable entity references", () => {
    expect(() =>
      createEvidenceEdge({
        id: "edge_missing_entity_id",
        occurredAt: "2026-06-13T00:00:00.000Z",
        from: { type: "agent_session", id: "" },
        relation: "created",
        to: { type: "file", id: "file_123" },
        metadata: {},
      }),
    ).toThrow("from.id is required");
  });

  test("accepts change-centric provenance entities and relations", () => {
    const edge = createEvidenceEdge({
      id: "edge_change_has_output_revision",
      occurredAt: "2026-06-23T10:18:04.000Z",
      scope: { tenantId: "org_acme_123", environment: "test" },
      from: { type: "change", id: "chg_project_estimate_91", resourceType: "project.estimate.recalculation" },
      relation: "has_output",
      to: { type: "revision", id: "rev_project_estimate_19", resourceType: "project_estimate" },
      metadata: {},
    });

    expect(edge.from.type).toBe("change");
    expect(edge.relation).toBe("has_output");
    expect(edge.to.type).toBe("revision");
  });

  test("matches redaction conformance fixtures for edge metadata", async () => {
    const fixture = await loadConformanceFixture<RedactionFixture>("redaction.json");

    for (const conformanceCase of fixture.cases) {
      const edge = createEvidenceEdge({
        id: "edge_redaction_fixture",
        occurredAt: "2026-06-23T10:18:04.000Z",
        from: { type: "change", id: "chg_redaction_fixture" },
        relation: "has_output",
        to: { type: "revision", id: "rev_redaction_fixture" },
        metadata: conformanceCase.metadata,
      });

      expect(edge.metadata).toEqual(conformanceCase.expectedMetadata);
    }
  });
});

describe("hashEvidenceEdge", () => {
  test("matches conformance fixtures", async () => {
    const fixture = await loadConformanceFixture<EdgeHashingFixture>("edge-hashing.json");

    for (const conformanceCase of fixture.cases) {
      expect(hashEvidenceEdge(conformanceCase.edge, conformanceCase.previousHash)).toBe(conformanceCase.expectedHash);
    }
  });
});

describe("hashEvidenceEdgeRecord", () => {
  test("matches edge record hashing and idempotency conformance fixtures", async () => {
    const fixture = await loadConformanceFixture<EdgeRecordHashingFixture>("edge-record-hashing.json");

    for (const conformanceCase of fixture.cases) {
      expect(hashIdempotencyKey(conformanceCase.tenantId, conformanceCase.idempotencyKey)).toBe(
        conformanceCase.expectedIdempotencyKeyHash,
      );
      expect(hashEvidenceEdgeRecord(conformanceCase.recordWithoutHash)).toBe(conformanceCase.expectedHash);
    }
  });
});

describe("verifyEvidenceEdgeRecords", () => {
  test("verifies tenant-scoped edge records and detects tampering", async () => {
    const fixture = await loadConformanceFixture<EdgeRecordHashingFixture>("edge-record-hashing.json");
    const record = {
      ...fixture.cases[0].recordWithoutHash,
      hash: fixture.cases[0].expectedHash,
    };

    expect(verifyEvidenceEdgeRecords([record])).toEqual({ ok: true });

    const tampered = [
      {
        ...record,
        edge: {
          ...record.edge,
          relation: "modified",
        },
      },
    ];

    expect(verifyEvidenceEdgeRecords(tampered)).toEqual({
      ok: false,
      index: 0,
      reason: "hash_mismatch",
    });
  });
});

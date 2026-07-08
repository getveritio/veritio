import { describe, expect, test } from "bun:test";
import {
  createAuditEvent,
  createGovernedActionDraft,
  createGovernedChangeDraft,
  defineEntity,
  type EvidenceRef,
  hashIdempotencyKey,
  governedRevisionId,
  mergeVeritioMetadata,
  refKey,
} from "../index";

const scope = { tenantId: "org_acme_123", workspaceId: "wks_security_456", environment: "test" };
const producer: EvidenceRef = {
  authority: "acme.billing",
  kind: "principal",
  type: "service",
  id: "billing-api",
};
const initiatedBy: EvidenceRef = {
  authority: "auth.acme.internal",
  kind: "principal",
  type: "user",
  id: "usr_123",
};

describe("authority-qualified evidence refs", () => {
  test("formats stable ref keys without dropping authority", () => {
    expect(refKey({ authority: "acme.billing", kind: "entity", type: "project_entry", id: "42" })).toBe(
      "acme.billing:entity:project_entry:42",
    );
  });
});

describe("mergeVeritioMetadata", () => {
  test("prevents caller metadata from shadowing reserved context keys", () => {
    expect(() =>
      mergeVeritioMetadata(
        { changeId: "caller_supplied", safe: true },
        { changeId: "chg_project_estimate_91", traceId: "trc_01jz_estimate" },
      ),
    ).toThrow("metadata.changeId is reserved by Veritio");

    expect(
      mergeVeritioMetadata(
        { optional: null, safe: true },
        {
          authSessionId: "ses_123",
          authContextId: "authctx_123_v4",
          activityEpisodeId: "episode_20260623_1000_usr_admin",
          traceId: "trc_01jz_estimate",
          correlationId: "workflow_project_estimate",
          causationEventId: "evt_previous_trigger",
          changeId: "chg_project_estimate_91",
          capturePolicyId: "cap_project_changes",
          collectionSource: "governed-change-test",
        },
      ),
    ).toEqual({
      activityEpisodeId: "episode_20260623_1000_usr_admin",
      authContextId: "authctx_123_v4",
      authSessionId: "ses_123",
      capturePolicyId: "cap_project_changes",
      causationEventId: "evt_previous_trigger",
      changeId: "chg_project_estimate_91",
      collectionSource: "governed-change-test",
      correlationId: "workflow_project_estimate",
      safe: true,
      traceId: "trc_01jz_estimate",
    });
  });
});

describe("createGovernedChangeDraft", () => {
  test("derives minimized revision evidence and change relations with current protocol records", () => {
    const projectEntry = defineEntity<{
      id: string;
      quantity: number;
      monthlyPrice: number;
      updatedAt: Date;
      customerEmail: string;
      temporaryCache: string;
    }>({
      authority: "acme.billing",
      type: "project_entry",
      schemaRef: "acme.billing/project_entry@3",
      fieldSetRef: "project-entry-governed-fields@2",
      identity: (row) => row.id,
      fields: {
        quantity: { capture: "full" },
        monthlyPrice: { capture: "full" },
        updatedAt: { capture: "full" },
        customerEmail: { capture: "keyed_digest" },
        temporaryCache: { capture: "omit" },
      },
    });

    const draft = createGovernedChangeDraft({
      scope,
      entity: projectEntry,
      before: {
        id: "42",
        quantity: 10,
        monthlyPrice: 142800,
        updatedAt: new Date("2026-06-23T10:17:00.000Z"),
        customerEmail: "buyer@example.com",
        temporaryCache: "hot",
      },
      after: {
        id: "42",
        quantity: 11,
        monthlyPrice: 148220,
        updatedAt: new Date("2026-06-23T10:18:00.000Z"),
        customerEmail: "buyer@example.com",
        temporaryCache: "warm",
      },
      changedPaths: ["/quantity", "/monthlyPrice"],
      change: {
        id: "chg_project_estimate_91",
        type: "project.estimate.recalculation",
        initiatedBy,
      },
      activity: {
        id: "act_calculation_91",
        type: "computation.project_cost_estimate",
        performedBy: { authority: "acme.ai", kind: "principal", type: "ai_agent", id: "cost_agent_7" },
      },
      producer,
      occurredAt: "2026-06-23T10:18:00.000Z",
      idempotencyKeyHash: "sha256:governed-change-test",
      context: { changeId: "chg_project_estimate_91", traceId: "trc_01jz_estimate", collectionSource: "test" },
      capturePolicyRef: { id: "cap_project_changes", version: "3" },
      digestKeys: { keyedDigest: { keyVersion: "tenant-key-7", secret: "test-hmac-secret" } },
    });

    expect(draft.outboxEntry.mutationBinding).toBe("not_transaction_bound");
    // An update with no caller-supplied parent leaves lineage open — no synthetic
    // `rev_..._previous` parent is fabricated.
    expect(draft.outboxEntry.expectedParentRevisionRef).toBeUndefined();
    expect(draft.revision.parents).toEqual([]);
    expect(draft.events[0]?.metadata.captureAssurance).toEqual({
      captureMethod: "transactional_outbox",
      mutationBinding: "not_transaction_bound",
    });
    expect(draft.outboxEntry.records.map((record) => record.action)).toEqual([
      "change.declared",
      "activity.recorded",
      "entity.revision.created",
    ]);
    expect(draft.revision.stateCommitment.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(draft.revision.stateCommitment.fields).toEqual({
      customerEmail: {
        algorithm: "hmac-sha256",
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        keyVersion: "tenant-key-7",
      },
      monthlyPrice: 148220,
      quantity: 11,
      updatedAt: "2026-06-23T10:18:00.000Z",
    });
    expect(JSON.stringify(draft.revision.stateCommitment.fields)).not.toContain("temporaryCache");
    expect(JSON.stringify(draft.revision.stateCommitment.fields)).not.toContain("buyer@example.com");
    expect(JSON.stringify(draft.revision.stateCommitment.fields)).not.toContain("test-hmac-secret");
    expect(draft.edges.map((edge) => edge.relation)).toEqual([
      "has_activity",
      "has_output",
      "performed_by",
      "generated",
    ]);

    const revisionEvent = createAuditEvent(draft.events[2]);
    const storedRevision = (revisionEvent.metadata.veritio as { revision: typeof draft.revision }).revision;
    expect(storedRevision.stateCommitment.fields.customerEmail).toEqual(
      draft.revision.stateCommitment.fields.customerEmail,
    );
  });

  test("links a parent + derived_from edge only when a parent revision is supplied", () => {
    const entry = defineEntity<{ id: string; quantity: number }>({
      authority: "acme.billing",
      type: "project_entry",
      schemaRef: "acme.billing/project_entry@3",
      fieldSetRef: "project-entry-governed-fields@2",
      identity: (row) => row.id,
      fields: { quantity: { capture: "full" } },
    });
    const expectedParentRevisionRef: EvidenceRef = {
      authority: "veritio",
      kind: "revision",
      type: "project_entry",
      id: "rev_project_entry_42_0a1b2c3d4e5f",
    };
    const draft = createGovernedChangeDraft({
      scope,
      entity: entry,
      before: { id: "42", quantity: 10 },
      after: { id: "42", quantity: 11 },
      changedPaths: ["/quantity"],
      change: { id: "chg_supplied", type: "project.estimate.recalculation", initiatedBy },
      activity: { id: "act_supplied", type: "computation.project_cost_estimate", performedBy: producer },
      producer,
      occurredAt: "2026-06-23T10:18:00.000Z",
      idempotencyKeyHash: "sha256:supplied-parent",
      expectedParentRevisionRef,
    });

    expect(draft.revision.parents).toEqual([expectedParentRevisionRef]);
    expect(draft.outboxEntry.expectedParentRevisionRef).toEqual(expectedParentRevisionRef);
    const derivedFrom = draft.edges.find((edge) => edge.relation === "derived_from");
    expect(derivedFrom?.metadata?.toRef).toEqual(expectedParentRevisionRef);
  });

  test("a create (no before) has no parent and no derived_from edge", () => {
    const entry = defineEntity<{ id: string; quantity: number }>({
      authority: "acme.billing",
      type: "project_entry",
      schemaRef: "acme.billing/project_entry@3",
      fieldSetRef: "project-entry-governed-fields@2",
      identity: (row) => row.id,
      fields: { quantity: { capture: "full" } },
    });
    const draft = createGovernedChangeDraft({
      scope,
      entity: entry,
      after: { id: "42", quantity: 11 },
      changedPaths: ["/quantity"],
      change: { id: "chg_create", type: "project.estimate.created", initiatedBy },
      activity: { id: "act_create", type: "computation.project_cost_estimate", performedBy: producer },
      producer,
      occurredAt: "2026-06-23T10:18:00.000Z",
      idempotencyKeyHash: "sha256:create",
    });

    expect(draft.revision.parents).toEqual([]);
    expect(draft.outboxEntry.expectedParentRevisionRef).toBeUndefined();
    expect(draft.edges.some((edge) => edge.relation === "derived_from")).toBe(false);
  });

  test("threads activityEpisodeId onto change.declared, activity.recorded, and entity.revision.created", () => {
    const entry = defineEntity<{ id: string; quantity: number }>({
      authority: "acme.billing",
      type: "project_entry",
      schemaRef: "acme.billing/project_entry@3",
      fieldSetRef: "project-entry-governed-fields@2",
      identity: (row) => row.id,
      fields: { quantity: { capture: "full" } },
    });

    const draft = createGovernedChangeDraft({
      scope,
      entity: entry,
      after: { id: "42", quantity: 11 },
      changedPaths: ["/quantity"],
      change: { id: "chg_ep", type: "project.estimate.created", initiatedBy },
      activity: { id: "act_ep", type: "computation.project_cost_estimate", performedBy: producer },
      producer,
      occurredAt: "2026-06-23T10:18:00.000Z",
      idempotencyKeyHash: "sha256:ep",
      context: { activityEpisodeId: "ep_gov_001" },
    });

    expect(draft.events.map((event) => event.action)).toEqual([
      "change.declared",
      "activity.recorded",
      "entity.revision.created",
    ]);
    expect(draft.events.map((event) => event.metadata.activityEpisodeId)).toEqual([
      "ep_gov_001",
      "ep_gov_001",
      "ep_gov_001",
    ]);
  });

  test("rejects invalid governed-change timestamps", () => {
    const projectEntry = defineEntity<{ id: string }>({
      authority: "acme.billing",
      type: "project_entry",
      schemaRef: "acme.billing/project_entry@3",
      fieldSetRef: "project-entry-governed-fields@2",
      identity: (row) => row.id,
      fields: {},
    });

    expect(() =>
      createGovernedChangeDraft({
        scope,
        entity: projectEntry,
        after: { id: "42" },
        changedPaths: [],
        change: { id: "chg_invalid_date", type: "project.invalid", initiatedBy },
        activity: { id: "act_invalid_date", type: "project.invalid", performedBy: producer },
        producer,
        occurredAt: "not-a-date",
        idempotencyKeyHash: "sha256:invalid-date",
      }),
    ).toThrow("occurredAt must be a valid date");
  });

  test("fails closed for capture modes the current draft helper cannot implement", () => {
    const projectEntry = defineEntity<{ id: string; sensitiveRef: string }>({
      authority: "acme.billing",
      type: "project_entry",
      schemaRef: "acme.billing/project_entry@3",
      fieldSetRef: "project-entry-governed-fields@2",
      identity: (row) => row.id,
      fields: { sensitiveRef: { capture: "reference" } },
    });

    expect(() =>
      createGovernedChangeDraft({
        scope,
        entity: projectEntry,
        after: { id: "42", sensitiveRef: "external-secret-ref" },
        changedPaths: ["/sensitiveRef"],
        change: { id: "chg_unsupported_capture", type: "project.unsupported_capture", initiatedBy },
        activity: { id: "act_unsupported_capture", type: "project.unsupported_capture", performedBy: producer },
        producer,
        occurredAt: "2026-06-23T10:18:00.000Z",
        idempotencyKeyHash: "sha256:unsupported-capture",
      }),
    ).toThrow("capture mode reference is not supported by the current governed-change draft helper");
  });
});

describe("createGovernedActionDraft", () => {
  const projectEntry = defineEntity<{
    id: string;
    quantity: number;
    status: string;
    customerEmail: string;
    temporaryCache?: string;
  }>({
    authority: "acme.billing",
    type: "project_entry",
    schemaRef: "acme.billing/project_entry@3",
    fieldSetRef: "project-entry-governed-fields@2",
    identity: (row) => row.id,
    fields: {
      quantity: { capture: "full" },
      status: { capture: "full" },
      customerEmail: { capture: "keyed_digest" },
      temporaryCache: { capture: "omit" },
    },
  });

  test("derives ids, idempotency hash, and changed paths before delegating", () => {
    const draft = createGovernedActionDraft({
      scope,
      entity: projectEntry,
      before: { id: "42", quantity: 10, status: "active", customerEmail: "buyer@example.com" },
      after: { id: "42", quantity: 11, status: "archived", customerEmail: "buyer@example.com" },
      actionType: "project.updated",
      activityType: "project.update",
      initiatedBy,
      performedBy: producer,
      producer,
      occurredAt: "2026-06-23T10:18:00.000Z",
      idempotencyKey: "project:42:v2",
      metadata: { surface: "api" },
      digestKeys: { keyedDigest: { keyVersion: "tenant-key-7", secret: "test-hmac-secret" } },
    });

    expect(draft.changeRef.id).toMatch(/^chg_project_entry_42_[a-f0-9]{16}$/);
    expect(draft.activityRef.id).toBe(draft.changeRef.id.replace(/^chg_/, "act_"));
    expect(draft.revision.changedPaths).toEqual(["/quantity", "/status"]);
    expect(draft.events[0]?.metadata.idempotencyKeyHash).toBe(hashIdempotencyKey(scope.tenantId, "project:42:v2"));
    expect(JSON.stringify(draft.outboxEntry)).not.toContain("buyer@example.com");
    expect(JSON.stringify(draft.outboxEntry)).not.toContain("test-hmac-secret");
  });

  test("tracks missing-to-null governed fields as updates", () => {
    const draft = createGovernedActionDraft({
      scope,
      entity: projectEntry,
      before: { id: "42", quantity: 10 },
      after: { id: "42", quantity: 10, status: null },
      actionType: "project.updated",
      activityType: "project.update",
      initiatedBy,
      performedBy: producer,
      producer,
      idempotencyKey: "project:42:null-status",
    });

    expect(draft.revision.changedPaths).toEqual(["/status"]);
    expect(draft.revision.stateCommitment.fields.status).toBeNull();
  });

  test("fails closed when an update changes no governed fields", () => {
    expect(() =>
      createGovernedActionDraft({
        scope,
        entity: projectEntry,
        before: { id: "42", quantity: 10, status: "active", customerEmail: "buyer@example.com" },
        after: { id: "42", quantity: 10, status: "active", customerEmail: "buyer@example.com" },
        actionType: "project.updated",
        activityType: "project.update",
        initiatedBy,
        performedBy: producer,
        producer,
        idempotencyKey: "project:42:no-op",
        digestKeys: { keyedDigest: { keyVersion: "tenant-key-7", secret: "test-hmac-secret" } },
      }),
    ).toThrow("at least one governed field must change");
  });

  test("honors explicit changed paths for host-defined derived mutations", () => {
    const draft = createGovernedActionDraft({
      scope,
      entity: projectEntry,
      before: { id: "42", quantity: 10, status: "active", customerEmail: "buyer@example.com" },
      after: { id: "42", quantity: 10, status: "active", customerEmail: "buyer@example.com" },
      changedPaths: ["/derivedEstimate"],
      actionType: "project.estimate.recalculated",
      activityType: "project.estimate.recalculation",
      initiatedBy,
      performedBy: producer,
      producer,
      idempotencyKey: "project:42:derived",
      digestKeys: { keyedDigest: { keyVersion: "tenant-key-7", secret: "test-hmac-secret" } },
    });

    expect(draft.revision.changedPaths).toEqual(["/derivedEstimate"]);
  });

  test("matches the cross-language governed action conformance fixture", async () => {
    const fixture = (await Bun.file(
      new URL("../../../../spec/conformance/governed-action-draft.json", import.meta.url).pathname,
    ).json()) as {
      cases: {
        name: string;
        input: {
          scope: typeof scope;
          entity: {
            authority: string;
            type: string;
            schemaRef: string;
            fieldSetRef: string;
            identityField: string;
            fields: Record<string, { capture: "full" | "keyed_digest" | "omit" | "content_digest" }>;
          };
          before?: Record<string, unknown>;
          after: Record<string, unknown>;
          actionType: string;
          activityType: string;
          initiatedBy: EvidenceRef;
          performedBy: EvidenceRef;
          producer: EvidenceRef;
          occurredAt: string;
          idempotencyKey: string;
          metadata?: Record<string, unknown>;
          context?: Record<string, string>;
          digestKeys?: { keyedDigest?: { keyVersion: string; secret: string } };
        };
        expected: {
          changeId: string;
          activityId: string;
          changedPaths: string[];
          idempotencyKeyHash: string;
          eventActions: string[];
          edgeRelations: string[];
        };
      }[];
    };

    for (const conformanceCase of fixture.cases) {
      const entity = defineEntity<Record<string, unknown>>({
        authority: conformanceCase.input.entity.authority,
        type: conformanceCase.input.entity.type,
        schemaRef: conformanceCase.input.entity.schemaRef,
        fieldSetRef: conformanceCase.input.entity.fieldSetRef,
        identity: (row) => String(row[conformanceCase.input.entity.identityField]),
        fields: conformanceCase.input.entity.fields,
      });
      const draft = createGovernedActionDraft({
        ...conformanceCase.input,
        entity,
      });
      expect(draft.changeRef.id).toBe(conformanceCase.expected.changeId);
      expect(draft.activityRef.id).toBe(conformanceCase.expected.activityId);
      expect(draft.revision.changedPaths).toEqual(conformanceCase.expected.changedPaths);
      expect(draft.events[0]?.metadata.idempotencyKeyHash).toBe(conformanceCase.expected.idempotencyKeyHash);
      expect(draft.events.map((event) => event.action)).toEqual(conformanceCase.expected.eventActions);
      expect(draft.edges.map((edge) => edge.relation)).toEqual(conformanceCase.expected.edgeRelations);
    }
  });
});

describe("governed revision id derivation", () => {
  test("matches the cross-language conformance fixture", async () => {
    const fixture = (await Bun.file(
      new URL("../../../../spec/conformance/governed-revision-id.json", import.meta.url).pathname,
    ).json()) as {
      cases: {
        name: string;
        entityType: string;
        entityId: string;
        stateDigest: string;
        changeId: string;
        expected: string;
      }[];
    };
    for (const conformanceCase of fixture.cases) {
      expect(
        governedRevisionId(
          conformanceCase.entityType,
          conformanceCase.entityId,
          conformanceCase.stateDigest,
          conformanceCase.changeId,
        ),
      ).toBe(conformanceCase.expected);
    }
  });

  test("a rollback to an identical state yields a distinct id; replaying the same change does not", () => {
    const entry = defineEntity<{ id: string; quantity: number }>({
      authority: "acme.billing",
      type: "project_entry",
      schemaRef: "acme.billing/project_entry@3",
      fieldSetRef: "project-entry-governed-fields@2",
      identity: (row) => row.id,
      fields: { quantity: { capture: "full" } },
    });
    const baseInput = {
      scope,
      entity: entry,
      before: { id: "42", quantity: 10 },
      after: { id: "42", quantity: 11 },
      changedPaths: ["/quantity"],
      activity: { id: "act_roll", type: "computation.project_cost_estimate", performedBy: producer },
      producer,
      occurredAt: "2026-06-23T10:18:00.000Z",
      idempotencyKeyHash: "sha256:rollback-test",
    };
    const change = (id: string) => ({ id, type: "project.estimate.recalculation", initiatedBy });

    const first = createGovernedChangeDraft({ ...baseInput, change: change("chg_a") });
    const rollback = createGovernedChangeDraft({ ...baseInput, change: change("chg_b") });
    const replay = createGovernedChangeDraft({ ...baseInput, change: change("chg_a") });

    // Identical governed state (same commitment digest) …
    expect(rollback.revision.stateCommitment.digest).toBe(first.revision.stateCommitment.digest);
    // … but a DIFFERENT change must never merge into the same revision node.
    expect(rollback.revision.ref.id).not.toBe(first.revision.ref.id);
    // Replaying the same change stays idempotent.
    expect(replay.revision.ref.id).toBe(first.revision.ref.id);
  });
});

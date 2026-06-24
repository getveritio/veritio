import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createNextVeritioAdapter, type NextVeritioContext } from "@veritio/next";
import {
  HASH_ALGORITHM,
  MemoryAuditStore,
  auditLogClassificationMetadata,
  authSessionCreatedTemplate,
  canonicalJson,
  consentGrantedTemplate,
  createAuditRecorder,
  createEvidenceEdge,
  createGovernedChangeDraft,
  dataSubjectRequestCreatedTemplate,
  defineEntity,
  exportBundleCreatedTemplate,
  hashEvidenceEdgeRecord,
  hashIdempotencyKey,
  organizationCreatedTemplate,
  organizationMemberInvitedTemplate,
  organizationMemberJoinedTemplate,
  retentionPolicyAppliedTemplate,
  verifyAuditRecords,
  verifyEvidenceEdgeRecords,
  type AuditEventInput,
  type AuditRecorder,
  type AuditRecord,
  type EvidenceEdgeRecord,
  type EvidenceEdgeRelation,
  type EvidenceRef,
  type GovernedChangeDraft,
  type JsonObject,
  type VerificationResult,
} from "@veritio/core";

const auditStore = getReferenceAuditStore();
const edgeRecords = getReferenceEdgeRecords();
const projects = getReferenceProjectStore();
const referenceSession = Object.freeze({
  tenantId: "tenant_demo",
  actorUserId: "user_demo",
});

export const auditRecorder: AuditRecorder = createAuditRecorder({
  store: auditStore,
});

export const nextAudit = createNextVeritioAdapter({
  recorder: auditRecorder,
  environment: "reference",
  async resolveContext() {
    return referenceSessionToNextContext(await resolveReferenceSession());
  },
});

export interface ReferenceSession {
  tenantId: string;
  actorUserId: string;
}

export interface ReferenceAuditTrail {
  session: ReferenceSession;
  records: AuditRecord[];
  verification: VerificationResult;
}

export interface ReferenceProject {
  id: string;
  name: string;
  status: "active" | "archived" | "deleted";
  updatedAt: string;
}

export interface ReferenceEvidenceTrail extends ReferenceAuditTrail {
  edgeRecords: EvidenceEdgeRecord[];
  edgeVerification: VerificationResult;
  projects: ReferenceProject[];
}

export interface ReferenceChangeView {
  id: string;
  title: string;
  occurredAt: string;
  activityIds: string[];
  outputRevisionIds: string[];
  supportingRecordIds: string[];
}

export interface ReferenceEntityTimeline {
  entityType: string;
  entityId: string;
  revisions: Array<{
    id: string;
    occurredAt: string;
    changedPaths: string[];
    stateCommitment: JsonObject;
  }>;
}

export interface ReferenceExplainResult {
  changeId: string;
  activityIds: string[];
  outputRevisionIds: string[];
  knownCoverage: string[];
  notCaptured: string[];
}

export interface ReferenceRevisionDiff {
  revisionId: string;
  changedPaths: string[];
  after: JsonObject;
}

export interface ReferenceGovernedProvenance {
  changes: ReferenceChangeView[];
  entityTimeline: ReferenceEntityTimeline;
  explain: ReferenceExplainResult | null;
  diff: ReferenceRevisionDiff | null;
}

export type ProjectMutationKind = "create" | "update" | "delete";

export interface ProjectMutationInput {
  kind: ProjectMutationKind;
  session: ReferenceSession;
  projectId: string;
  name?: string;
  status?: "active" | "archived";
  requestId?: string;
  source: string;
}

export interface ScenarioRunResult {
  scenario: string;
  canonicalPlanHash: string;
  eventCount: number;
  edgeCount: number;
  auditVerification: VerificationResult;
  edgeVerification: VerificationResult;
}

export interface GovernedChangeScenarioRunResult extends ScenarioRunResult, ReferenceGovernedProvenance {}

/**
 * Reference-only server boundary. Host apps must replace this with a Better Auth
 * session lookup plus tenant or organization membership lookup. Do not accept
 * tenantId or actorUserId from form fields, query params, or browser storage.
 */
export async function resolveReferenceSession(_input?: unknown): Promise<ReferenceSession> {
  return { ...referenceSession };
}

/**
 * Converts a server-resolved reference session into the Next adapter context
 * expected by the Veritio audit recorder.
 */
export function referenceSessionToNextContext(
  session: ReferenceSession,
  requestId?: string,
): NextVeritioContext {
  const context: NextVeritioContext = {
    tenantId: session.tenantId,
    actor: { type: "user", id: session.actorUserId },
    environment: "reference",
  };
  if (requestId) {
    context.requestId = requestId;
  }
  return context;
}

/**
 * Lists audit records only for the server-resolved tenant in the reference
 * example.
 */
export async function listAuditTrailForTenant(input: {
  tenantId: string;
  limit?: number;
}): Promise<AuditRecord[]> {
  return auditStore.list({ tenantId: input.tenantId }, { limit: input.limit ?? 50 });
}

/**
 * Returns the example session, tenant-scoped records, and verification status for
 * the reference UI.
 */
export async function getReferenceAuditTrail(limit = 50): Promise<ReferenceAuditTrail> {
  const session = await resolveReferenceSession();
  const records = await listAuditTrailForTenant({ tenantId: session.tenantId, limit });
  return {
    session,
    records,
    verification: verifyAuditRecords(records),
  };
}

/**
 * Applies local project CRUD state and records both audit-event and graph-edge
 * evidence from the Next server boundary.
 */
export async function recordProjectMutation(input: ProjectMutationInput) {
  const now = new Date().toISOString();
  const project = applyProjectMutation(input, now);
  const action = projectActionFor(input.kind);
  const relation = edgeRelationFor(input.kind);
  const requestId = input.requestId ?? `req_${Date.now()}`;
  const idempotencyKey = `project:${input.kind}:${input.session.tenantId}:${input.projectId}:${requestId}`;

  const record = await auditRecorder.record(
    {
      actor: { type: "user", id: input.session.actorUserId },
      action,
      target: { type: "project", id: input.projectId },
      scope: { tenantId: input.session.tenantId, environment: "reference" },
      requestId,
      purpose: "account_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: { source: input.source, project_status: project.status },
    },
    { idempotencyKey },
  );

  const edgeRecord = appendEvidenceEdgeRecord({
    session: input.session,
    project,
    relation,
    source: input.source,
    idempotencyKey,
  });

  return { project, record, edgeRecord };
}

/**
 * Returns the example session, event chain, graph chain, and verification status
 * for the local governed CRUD UI and API routes.
 */
export async function getReferenceEvidenceTrail(limit = 50): Promise<ReferenceEvidenceTrail> {
  const trail = await getReferenceAuditTrail(limit);
  const tenantEdges = edgeRecords
    .filter((record) => record.edge.scope?.tenantId === trail.session.tenantId)
    .slice(0, limit);
  return {
    ...trail,
    edgeRecords: tenantEdges,
    edgeVerification: verifyEvidenceEdgeRecords(tenantEdges),
    projects: [...projects.values()],
  };
}

/**
 * Returns rebuildable Change, entity timeline, Explain, and Diff projections
 * derived from the current v1 audit and edge records.
 */
export async function getReferenceGovernedProvenance(): Promise<ReferenceGovernedProvenance> {
  const trail = await getReferenceEvidenceTrail(10_000);
  const changes = projectChanges(trail.records, trail.edgeRecords);
  const entityTimeline = projectEntityTimeline(trail.records, "project_entry", "42");
  const explain = explainChange("chg_project_entry_price_01", trail.records, trail.edgeRecords);
  const firstOutput = explain?.outputRevisionIds[0];
  const diff = firstOutput ? diffRevision(firstOutput, trail.records) : null;
  return { changes, entityTimeline, explain, diff };
}

/**
 * Records a larger governed-system workflow with auth, organization, consent,
 * subject-request, export, retention, and processor-transfer evidence. SDK
 * templates own event semantics while this host example owns graph assembly.
 */
export async function runGovernedLifecycleScenario(session?: ReferenceSession): Promise<ScenarioRunResult> {
  const resolvedSession = session ?? (await resolveReferenceSession());
  const scope = { tenantId: resolvedSession.tenantId, environment: "reference" };
  const actor = { type: "user" as const, id: resolvedSession.actorUserId };
  const service = { type: "system" as const, id: "system_exports" };
  const runId = randomUUID();
  const canonicalPlanHash = stableHash(
    canonicalJson({
      scenario: "governed_lifecycle",
      tenantId: resolvedSession.tenantId,
      subjectId: "subject_demo",
      country: "US",
      region: "CA",
      steps: [
        "auth_session",
        "organization_bootstrap",
        "membership",
        "consent",
        "subject_request",
        "export",
        "retention",
        "processor_transfer",
      ],
    }),
  );
  const externalApi = auditLogClassificationMetadata({ visibility: "external", surface: "api" });
  const internalApp = auditLogClassificationMetadata({ visibility: "internal", surface: "app" });
  const systemWorker = auditLogClassificationMetadata({ visibility: "system", surface: "worker" });
  const eventInputs: AuditEventInput[] = [
    authSessionCreatedTemplate({
      userId: resolvedSession.actorUserId,
      sessionId: "session_demo_us_ca",
      scope,
      requestId: "scenario:auth-session",
      securityContext: {
        ipAddressHash: stableHash("203.0.113.42"),
        userAgentHash: stableHash("demo-browser"),
        location: { country: "US", region: "CA" },
        method: "password",
        provider: "better-auth",
        riskScore: 0.21,
      },
      metadata: { ...externalApi, canonicalPlanHash },
    }),
    organizationCreatedTemplate({
      organizationId: resolvedSession.tenantId,
      organizationDisplay: "Demo Tenant",
      actor,
      scope,
      requestId: "scenario:org-created",
      metadata: externalApi,
    }),
    organizationMemberInvitedTemplate({
      organizationId: resolvedSession.tenantId,
      invitationId: "invite_ops_reviewer",
      inviter: actor,
      role: ["admin", "privacy_reviewer"],
      scope,
      requestId: "scenario:member-invited",
      metadata: internalApp,
    }),
    organizationMemberJoinedTemplate({
      organizationId: resolvedSession.tenantId,
      memberId: "member_ops_reviewer",
      actor,
      role: ["admin", "privacy_reviewer"],
      scope,
      requestId: "scenario:member-joined",
      metadata: internalApp,
    }),
    consentGrantedTemplate({
      actor,
      consentId: "consent_marketing_demo",
      subjectId: "subject_demo",
      purposeId: "purpose_product_updates",
      scope,
      requestId: "scenario:consent-granted",
      dataCategories: ["account", "preferences", "usage"],
      metadata: externalApi,
    }),
    dataSubjectRequestCreatedTemplate({
      actor,
      subjectRequestId: "dsr_export_demo",
      requestType: "access_export",
      subjectId: "subject_demo",
      scope,
      requestId: "scenario:subject-request",
      metadata: externalApi,
    }),
    exportBundleCreatedTemplate({
      actor: service,
      exportBundleId: "export_bundle_demo",
      format: "jsonl",
      scope,
      requestId: "scenario:export-created",
      metadata: { ...externalApi, canonicalPlanHash },
    }),
    retentionPolicyAppliedTemplate({
      actor: service,
      policyId: "policy_security_1y",
      resourceId: "project_demo",
      scope,
      requestId: "scenario:retention-applied",
      metadata: systemWorker,
    }),
  ];

  const firstEventCount = (await listAuditTrailForTenant({ tenantId: resolvedSession.tenantId, limit: 10_000 })).length;
  for (const input of eventInputs) {
    await auditRecorder.record(input, {
      idempotencyKey: `scenario:${runId}:event:${resolvedSession.tenantId}:${input.action}:${input.target.id}`,
    });
  }

  const edgeInputs = [
    scenarioEdge(scope, "actor", resolvedSession.actorUserId, "created", "resource", resolvedSession.tenantId, "organization", canonicalPlanHash),
    scenarioEdge(scope, "actor", resolvedSession.actorUserId, "created", "consent", "consent_marketing_demo", undefined, canonicalPlanHash),
    scenarioEdge(scope, "consent", "consent_marketing_demo", "subject_of", "data_subject", "subject_demo", undefined, canonicalPlanHash),
    scenarioEdge(scope, "data_subject", "subject_demo", "processed_for", "purpose", "purpose_product_updates", undefined, canonicalPlanHash),
    scenarioEdge(scope, "resource", "project_demo", "retained_under", "policy", "policy_security_1y", undefined, canonicalPlanHash),
    scenarioEdge(scope, "subject_request", "dsr_export_demo", "subject_of", "data_subject", "subject_demo", undefined, canonicalPlanHash),
    scenarioEdge(scope, "export_bundle", "export_bundle_demo", "exports", "subject_request", "dsr_export_demo", undefined, canonicalPlanHash),
    scenarioEdge(scope, "export_bundle", "export_bundle_demo", "sent_to", "processor", "processor_secure_mail", undefined, canonicalPlanHash),
    scenarioEdge(scope, "system", "system_exports", "attests_to", "export_bundle", "export_bundle_demo", undefined, canonicalPlanHash),
    scenarioEdge(scope, "resource", "project_demo", "part_of", "resource", resolvedSession.tenantId, "organization", canonicalPlanHash),
  ] as const;
  for (const input of edgeInputs) {
    appendScenarioEdgeRecord(resolvedSession, input, `scenario:${runId}:edge:${input.relation}:${input.to.id}`);
  }

  const trail = await getReferenceEvidenceTrail(10_000);
  return {
    scenario: "governed_lifecycle",
    canonicalPlanHash,
    eventCount: trail.records.length - firstEventCount,
    edgeCount: edgeInputs.length,
    auditVerification: trail.verification,
    edgeVerification: trail.edgeVerification,
  };
}

/**
 * Runs a governed project-entry change, price recalculation, and rollback. This
 * uses current AuditEvent and EvidenceEdge records only, so the example does not
 * claim EvidenceCommit atomicity or independent state verification.
 */
export async function runGovernedChangeScenario(session?: ReferenceSession): Promise<GovernedChangeScenarioRunResult> {
  const resolvedSession = session ?? (await resolveReferenceSession());
  const scope = { tenantId: resolvedSession.tenantId, workspaceId: "workspace_estimates", environment: "reference" };
  const producer: EvidenceRef = { authority: "acme.billing", kind: "principal", type: "service", id: "billing-api" };
  const user: EvidenceRef = { authority: "auth.acme.internal", kind: "principal", type: "user", id: resolvedSession.actorUserId };
  const agent: EvidenceRef = { authority: "acme.ai", kind: "principal", type: "ai_agent", id: "cost_agent_7" };
  const projectEntry = defineEntity<{
    id: string;
    quantity: number;
    monthlyPrice: number;
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
      customerEmail: { capture: "keyed_digest" },
      temporaryCache: { capture: "omit" },
    },
  });

  const firstEventCount = (await listAuditTrailForTenant({ tenantId: resolvedSession.tenantId, limit: 10_000 })).length;
  await appendGovernedChangeDraft(
    resolvedSession,
    createGovernedChangeDraft({
      scope,
      entity: projectEntry,
      before: { id: "42", quantity: 10, monthlyPrice: 142800, customerEmail: "buyer@example.com", temporaryCache: "hot" },
      after: { id: "42", quantity: 11, monthlyPrice: 148220, customerEmail: "buyer@example.com", temporaryCache: "warm" },
      changedPaths: ["/quantity", "/monthlyPrice"],
      change: { id: "chg_project_entry_price_01", type: "project.entry.price_recalculation", initiatedBy: user },
      activity: { id: "act_project_entry_price_01", type: "computation.project_cost_estimate", performedBy: agent },
      producer,
      occurredAt: "2026-06-23T10:18:00.000Z",
      idempotencyKeyHash: "sha256:price-change",
      context: { changeId: "chg_project_entry_price_01", traceId: "trc_project_entry_price", collectionSource: "nextjs-example" },
      capturePolicyRef: { id: "cap_project_changes", version: "3" },
      digestKeys: { keyedDigest: { keyVersion: "tenant-key-7", secret: "next-example-hmac-secret" } },
    }),
  );
  await appendGovernedChangeDraft(
    resolvedSession,
    createGovernedChangeDraft({
      scope,
      entity: projectEntry,
      before: { id: "42", quantity: 11, monthlyPrice: 148220, customerEmail: "buyer@example.com", temporaryCache: "warm" },
      after: { id: "42", quantity: 10, monthlyPrice: 142800, customerEmail: "buyer@example.com", temporaryCache: "restored" },
      changedPaths: ["/quantity", "/monthlyPrice"],
      change: { id: "chg_project_entry_revert_01", type: "project.entry.rollback", initiatedBy: user },
      activity: { id: "act_project_entry_revert_01", type: "project.entry.rollback", performedBy: user },
      producer,
      occurredAt: "2026-06-23T10:24:00.000Z",
      idempotencyKeyHash: "sha256:rollback-change",
      context: { changeId: "chg_project_entry_revert_01", traceId: "trc_project_entry_revert", collectionSource: "nextjs-example" },
      capturePolicyRef: { id: "cap_project_changes", version: "3" },
      digestKeys: { keyedDigest: { keyVersion: "tenant-key-7", secret: "next-example-hmac-secret" } },
    }),
  );

  const trail = await getReferenceEvidenceTrail(10_000);
  const projections = await getReferenceGovernedProvenance();
  return {
    scenario: "governed_change",
    canonicalPlanHash: stableHash("nextjs-governed-change"),
    eventCount: trail.records.length - firstEventCount,
    edgeCount: 10,
    auditVerification: trail.verification,
    edgeVerification: trail.edgeVerification,
    ...projections,
  };
}

/**
 * Reuses one MemoryAuditStore across Next dev reloads so the reference audit
 * trail remains visible during local testing.
 */
function getReferenceAuditStore(): MemoryAuditStore {
  const referenceGlobal = globalThis as typeof globalThis & {
    __veritioNextBetterAuthAuditStore?: MemoryAuditStore;
  };
  referenceGlobal.__veritioNextBetterAuthAuditStore ??= new MemoryAuditStore();
  return referenceGlobal.__veritioNextBetterAuthAuditStore;
}

/**
 * Reuses edge-chain state across Next dev reloads so the activity graph remains
 * visible during local example testing.
 */
function getReferenceEdgeRecords(): EvidenceEdgeRecord[] {
  const referenceGlobal = globalThis as typeof globalThis & {
    __veritioNextBetterAuthEdgeRecords?: EvidenceEdgeRecord[];
  };
  referenceGlobal.__veritioNextBetterAuthEdgeRecords ??= [];
  return referenceGlobal.__veritioNextBetterAuthEdgeRecords;
}

/**
 * Reuses local project state across Next dev reloads without implying
 * production durability or hosted Veritio storage.
 */
function getReferenceProjectStore(): Map<string, ReferenceProject> {
  const referenceGlobal = globalThis as typeof globalThis & {
    __veritioNextBetterAuthProjects?: Map<string, ReferenceProject>;
  };
  referenceGlobal.__veritioNextBetterAuthProjects ??= new Map<string, ReferenceProject>();
  return referenceGlobal.__veritioNextBetterAuthProjects;
}

/**
 * Mutates the example project store before evidence is emitted so returned
 * resource state and recorded evidence stay aligned.
 */
function applyProjectMutation(input: ProjectMutationInput, updatedAt: string): ReferenceProject {
  if (input.kind === "delete") {
    const existing = projects.get(input.projectId) ?? {
      id: input.projectId,
      name: input.name ?? input.projectId,
      status: "active" as const,
      updatedAt,
    };
    const project: ReferenceProject = { ...existing, status: "deleted", updatedAt };
    projects.set(project.id, project);
    return project;
  }

  const existing = projects.get(input.projectId);
  const project: ReferenceProject = {
    id: input.projectId,
    name: input.name ?? existing?.name ?? "Governed Project",
    status: input.status ?? existing?.status ?? "active",
    updatedAt,
  };
  projects.set(project.id, project);
  return project;
}

/**
 * Appends a tenant-scoped graph record with deterministic envelope hashing so
 * edge-chain integrity can be verified separately from audit events.
 */
function appendEvidenceEdgeRecord(input: {
  session: ReferenceSession;
  project: ReferenceProject;
  relation: EvidenceEdgeRelation;
  source: string;
  idempotencyKey: string;
}): EvidenceEdgeRecord {
  const previous = edgeRecords
    .filter((record) => record.edge.scope?.tenantId === input.session.tenantId)
    .at(-1);
  const edge = createEvidenceEdge({
    scope: { tenantId: input.session.tenantId, environment: "reference" },
    from: { type: "actor", id: input.session.actorUserId, actorType: "user" },
    relation: input.relation,
    to: { type: "resource", id: input.project.id, resourceType: "project" },
    metadata: { source: input.source, project_status: input.project.status },
  });
  const recordWithoutHash: Omit<EvidenceEdgeRecord, "hash"> = {
    edge,
    sequence: (previous?.sequence ?? 0) + 1,
    previousHash: previous?.hash ?? null,
    hashAlgorithm: HASH_ALGORITHM,
    canonicalization: "veritio-json-v1",
    appendedAt: new Date().toISOString(),
    idempotencyKeyHash: hashIdempotencyKey(input.session.tenantId, input.idempotencyKey),
  };
  const record: EvidenceEdgeRecord = {
    ...recordWithoutHash,
    hash: hashEvidenceEdgeRecord(recordWithoutHash),
  };
  edgeRecords.push(record);
  return record;
}

/**
 * Maps CRUD verbs to shared audit action names used across Better Auth
 * governed CRUD examples.
 */
function projectActionFor(kind: ProjectMutationKind): "project.created" | "project.updated" | "project.deleted" {
  if (kind === "create") return "project.created";
  if (kind === "update") return "project.updated";
  return "project.deleted";
}

/**
 * Maps CRUD verbs to supported evidence graph relations without extending the
 * protocol for a framework-specific example.
 */
function edgeRelationFor(kind: ProjectMutationKind): EvidenceEdgeRelation {
  if (kind === "create") return "created";
  if (kind === "update") return "modified";
  return "deleted";
}

/**
 * Appends a scenario edge record after SDK validation so complex example graphs
 * use the same deterministic envelope as CRUD edges.
 */
function appendScenarioEdgeRecord(
  session: ReferenceSession,
  input: ReturnType<typeof scenarioEdge>,
  idempotencyKey: string,
): EvidenceEdgeRecord {
  const previous = edgeRecords
    .filter((record) => record.edge.scope?.tenantId === session.tenantId)
    .at(-1);
  const edge = createEvidenceEdge(input);
  const recordWithoutHash: Omit<EvidenceEdgeRecord, "hash"> = {
    edge,
    sequence: (previous?.sequence ?? 0) + 1,
    previousHash: previous?.hash ?? null,
    hashAlgorithm: HASH_ALGORITHM,
    canonicalization: "veritio-json-v1",
    appendedAt: new Date().toISOString(),
    idempotencyKeyHash: hashIdempotencyKey(session.tenantId, idempotencyKey),
  };
  const record: EvidenceEdgeRecord = {
    ...recordWithoutHash,
    hash: hashEvidenceEdgeRecord(recordWithoutHash),
  };
  edgeRecords.push(record);
  return record;
}

/**
 * Appends a governed-change draft through existing v1 audit and graph chains.
 * Sequential append is sufficient for this reference UI and intentionally does
 * not claim EvidenceCommit atomicity.
 */
async function appendGovernedChangeDraft(session: ReferenceSession, draft: GovernedChangeDraft): Promise<void> {
  for (const event of draft.events) {
    await auditRecorder.record(event, { idempotencyKey: `governed:${session.tenantId}:event:${event.id}` });
  }
  for (const edge of draft.edges) {
    appendEvidenceEdgeInputRecord(session, edge, `governed:${session.tenantId}:edge:${edge.id}`);
  }
}

/**
 * Appends an already-built edge input with the same tenant-scoped envelope as
 * other example graph records.
 */
function appendEvidenceEdgeInputRecord(
  session: ReferenceSession,
  input: ReturnType<typeof createEvidenceEdge> | Parameters<typeof createEvidenceEdge>[0],
  idempotencyKey: string,
): EvidenceEdgeRecord {
  const previous = edgeRecords
    .filter((record) => record.edge.scope?.tenantId === session.tenantId)
    .at(-1);
  const edge = createEvidenceEdge(input);
  const recordWithoutHash: Omit<EvidenceEdgeRecord, "hash"> = {
    edge,
    sequence: (previous?.sequence ?? 0) + 1,
    previousHash: previous?.hash ?? null,
    hashAlgorithm: HASH_ALGORITHM,
    canonicalization: "veritio-json-v1",
    appendedAt: new Date().toISOString(),
    idempotencyKeyHash: hashIdempotencyKey(session.tenantId, idempotencyKey),
  };
  const record: EvidenceEdgeRecord = {
    ...recordWithoutHash,
    hash: hashEvidenceEdgeRecord(recordWithoutHash),
  };
  edgeRecords.push(record);
  return record;
}

/**
 * Rebuilds Change list rows from current protocol evidence.
 */
function projectChanges(records: AuditRecord[], edges: EvidenceEdgeRecord[]): ReferenceChangeView[] {
  return records
    .filter((record) => record.event.action === "change.declared")
    .map((record) => {
      const relatedEdges = edges.filter((edgeRecord) => edgeRecord.edge.from.id === record.event.target.id);
      return {
        id: record.event.target.id,
        title: stringFromJson(record.event.metadata.changeType) ?? record.event.action,
        occurredAt: record.event.occurredAt,
        activityIds: uniqueInOrder(relatedEdges.filter((edgeRecord) => edgeRecord.edge.relation === "has_activity").map((edgeRecord) => edgeRecord.edge.to.id)),
        outputRevisionIds: uniqueInOrder(relatedEdges.filter((edgeRecord) => edgeRecord.edge.relation === "has_output").map((edgeRecord) => edgeRecord.edge.to.id)),
        supportingRecordIds: [record.event.id, ...relatedEdges.map((edgeRecord) => edgeRecord.edge.id)],
      };
    })
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

/**
 * Rebuilds the project-entry entity timeline from revision compatibility events.
 */
function projectEntityTimeline(records: AuditRecord[], entityType: string, entityId: string): ReferenceEntityTimeline {
  const revisions = records
    .filter((record) => {
      return (
        record.event.action === "entity.revision.created" &&
        record.event.target.type === entityType &&
        record.event.target.id === entityId
      );
    })
    .map((record) => {
      const revision = revisionPayload(record);
      return {
        id: revision.ref.id,
        occurredAt: record.event.occurredAt,
        changedPaths: Array.isArray(revision.changedPaths) ? revision.changedPaths.map(String) : [],
        stateCommitment: revision.stateCommitment as JsonObject,
      };
    })
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return { entityType, entityId, revisions };
}

/**
 * Explains one Change through its declared event, relation edges, and explicit
 * current-protocol evidence gaps.
 */
function explainChange(
  changeId: string,
  records: AuditRecord[],
  edges: EvidenceEdgeRecord[],
): ReferenceExplainResult | null {
  const record = records.find((candidate) => candidate.event.action === "change.declared" && candidate.event.target.id === changeId);
  if (!record) {
    return null;
  }
  const outgoing = edges.filter((edgeRecord) => edgeRecord.edge.from.id === changeId);
  return {
    changeId,
    activityIds: uniqueInOrder(outgoing.filter((edgeRecord) => edgeRecord.edge.relation === "has_activity").map((edgeRecord) => edgeRecord.edge.to.id)),
    outputRevisionIds: uniqueInOrder(outgoing.filter((edgeRecord) => edgeRecord.edge.relation === "has_output").map((edgeRecord) => edgeRecord.edge.to.id)),
    knownCoverage: ["change", "activity", "revision", "relations", "audit_records"],
    notCaptured: ["raw full row", "business transaction proof", "independent state verification"],
  };
}

/**
 * Deduplicates projection labels without sorting so repeated scenario runs keep
 * their first-observed provenance order and do not produce duplicate UI keys.
 */
function uniqueInOrder(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Presents the captured governed-field state for one revision; digest-only
 * fields stay digest metadata.
 */
function diffRevision(revisionId: string, records: AuditRecord[]): ReferenceRevisionDiff | null {
  for (const record of records) {
    if (record.event.action !== "entity.revision.created") {
      continue;
    }
    const revision = revisionPayload(record);
    if (revision.ref.id === revisionId) {
      return {
        revisionId,
        changedPaths: Array.isArray(revision.changedPaths) ? revision.changedPaths.map(String) : [],
        after: revision.stateCommitment.fields as JsonObject,
      };
    }
  }
  return null;
}

/**
 * Reads the current v1 revision compatibility encoding from event metadata.
 */
function revisionPayload(record: AuditRecord): Record<string, any> {
  const metadata = record.event.metadata as Record<string, any>;
  const revision = metadata.veritio?.revision;
  if (!revision || typeof revision !== "object") {
    throw new TypeError("revision metadata is missing");
  }
  return revision as Record<string, any>;
}

/**
 * Reads a display string from metadata without coercing objects.
 */
function stringFromJson(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Builds one scenario graph edge input with stable metadata and the SDK's
 * existing language-neutral entity and relation vocabulary.
 */
function scenarioEdge(
  scope: { tenantId: string; environment: string },
  fromType: ReturnType<typeof createEvidenceEdge>["from"]["type"],
  fromId: string,
  relation: EvidenceEdgeRelation,
  toType: ReturnType<typeof createEvidenceEdge>["to"]["type"],
  toId: string,
  resourceType: string | undefined,
  canonicalPlanHash: string,
) {
  return {
    scope,
    from: { type: fromType, id: fromId },
    relation,
    to: { type: toType, id: toId, ...(resourceType ? { resourceType } : {}) },
    metadata: {
      source: "nextjs-governed-lifecycle",
      canonicalPlanHash,
    },
  };
}

/**
 * Hashes canonical scenario JSON or display text before it enters metadata.
 */
function stableHash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

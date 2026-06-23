import { createHash, randomUUID } from "node:crypto";
import {
  HASH_ALGORITHM,
  MemoryAuditStore,
  auditLogClassificationMetadata,
  authSessionCreatedTemplate,
  canonicalJson,
  consentGrantedTemplate,
  createAuditRecorder,
  createEvidenceEdge,
  dataSubjectRequestCreatedTemplate,
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
  type VerificationResult,
} from "@veritio/core";

const auditStore = new MemoryAuditStore();
const edgeRecords: EvidenceEdgeRecord[] = [];
const projects = new Map<string, ReferenceProject>();

export const auditRecorder: AuditRecorder = createAuditRecorder({
  store: auditStore,
});

export interface ReferenceSession {
  tenantId: string;
  actorUserId: string;
}

export interface ReferenceProject {
  id: string;
  name: string;
  status: "active" | "archived" | "deleted";
  updatedAt: string;
}

export interface ReferenceEvidenceTrail {
  records: AuditRecord[];
  edgeRecords: EvidenceEdgeRecord[];
  auditVerification: VerificationResult;
  edgeVerification: VerificationResult;
  projects: ReferenceProject[];
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

/**
 * Reference-only server boundary. Replace this with Better Auth session and
 * organization membership lookup; never trust browser-supplied tenant ids.
 */
export async function resolveReferenceSession(_event: unknown): Promise<ReferenceSession> {
  return {
    tenantId: "tenant_demo",
    actorUserId: "user_demo",
  };
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
 * Applies local project CRUD state and emits both a Veritio audit event and a
 * graph edge from the SvelteKit server boundary.
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
 * Returns audit records, graph edges, and independent verification results for
 * the server-resolved tenant.
 */
export async function getReferenceEvidenceTrail(input: {
  tenantId: string;
  limit?: number;
}): Promise<ReferenceEvidenceTrail> {
  const records = await listAuditTrailForTenant({ tenantId: input.tenantId, limit: input.limit ?? 100 });
  const tenantEdges = edgeRecords
    .filter((record) => record.edge.scope?.tenantId === input.tenantId)
    .slice(0, input.limit ?? 100);

  return {
    records,
    edgeRecords: tenantEdges,
    auditVerification: verifyAuditRecords(records),
    edgeVerification: verifyEvidenceEdgeRecords(tenantEdges),
    projects: [...projects.values()],
  };
}

/**
 * Records a larger governed-system workflow with auth, organization, consent,
 * subject-request, export, retention, and processor-transfer evidence. SDK
 * templates own event semantics while this host example owns graph assembly.
 */
export async function runGovernedLifecycleScenario(session: ReferenceSession): Promise<ScenarioRunResult> {
  const scope = { tenantId: session.tenantId, environment: "reference" };
  const actor = { type: "user" as const, id: session.actorUserId };
  const service = { type: "system" as const, id: "system_exports" };
  const runId = randomUUID();
  const canonicalPlanHash = stableHash(
    canonicalJson({
      scenario: "governed_lifecycle",
      tenantId: session.tenantId,
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
      userId: session.actorUserId,
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
      organizationId: session.tenantId,
      organizationDisplay: "Demo Tenant",
      actor,
      scope,
      requestId: "scenario:org-created",
      metadata: externalApi,
    }),
    organizationMemberInvitedTemplate({
      organizationId: session.tenantId,
      invitationId: "invite_ops_reviewer",
      inviter: actor,
      role: ["admin", "privacy_reviewer"],
      scope,
      requestId: "scenario:member-invited",
      metadata: internalApp,
    }),
    organizationMemberJoinedTemplate({
      organizationId: session.tenantId,
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

  const firstEventCount = (await listAuditTrailForTenant({ tenantId: session.tenantId, limit: 10_000 })).length;
  for (const input of eventInputs) {
    await auditRecorder.record(input, {
      idempotencyKey: `scenario:${runId}:event:${session.tenantId}:${input.action}:${input.target.id}`,
    });
  }

  const edgeInputs = [
    scenarioEdge(scope, "actor", session.actorUserId, "created", "resource", session.tenantId, "organization", canonicalPlanHash),
    scenarioEdge(scope, "actor", session.actorUserId, "created", "consent", "consent_marketing_demo", undefined, canonicalPlanHash),
    scenarioEdge(scope, "consent", "consent_marketing_demo", "subject_of", "data_subject", "subject_demo", undefined, canonicalPlanHash),
    scenarioEdge(scope, "data_subject", "subject_demo", "processed_for", "purpose", "purpose_product_updates", undefined, canonicalPlanHash),
    scenarioEdge(scope, "resource", "project_demo", "retained_under", "policy", "policy_security_1y", undefined, canonicalPlanHash),
    scenarioEdge(scope, "subject_request", "dsr_export_demo", "subject_of", "data_subject", "subject_demo", undefined, canonicalPlanHash),
    scenarioEdge(scope, "export_bundle", "export_bundle_demo", "exports", "subject_request", "dsr_export_demo", undefined, canonicalPlanHash),
    scenarioEdge(scope, "export_bundle", "export_bundle_demo", "sent_to", "processor", "processor_secure_mail", undefined, canonicalPlanHash),
    scenarioEdge(scope, "system", "system_exports", "attests_to", "export_bundle", "export_bundle_demo", undefined, canonicalPlanHash),
    scenarioEdge(scope, "resource", "project_demo", "part_of", "resource", session.tenantId, "organization", canonicalPlanHash),
  ] as const;
  for (const input of edgeInputs) {
    appendScenarioEdgeRecord(session, input, `scenario:${runId}:edge:${input.relation}:${input.to.id}`);
  }

  const trail = await getReferenceEvidenceTrail({ tenantId: session.tenantId, limit: 10_000 });
  return {
    scenario: "governed_lifecycle",
    canonicalPlanHash,
    eventCount: trail.records.length - firstEventCount,
    edgeCount: edgeInputs.length,
    auditVerification: trail.auditVerification,
    edgeVerification: trail.edgeVerification,
  };
}

/**
 * Mutates the example project store before recording evidence so API responses
 * and Veritio records describe the same resource state.
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
 * Appends a tenant-scoped edge record with deterministic envelope hashing for
 * local graph verification.
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
 * Maps CRUD verbs to shared audit action names.
 */
function projectActionFor(kind: ProjectMutationKind): "project.created" | "project.updated" | "project.deleted" {
  if (kind === "create") return "project.created";
  if (kind === "update") return "project.updated";
  return "project.deleted";
}

/**
 * Maps CRUD verbs to supported evidence graph relations.
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
      source: "sveltekit-governed-lifecycle",
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

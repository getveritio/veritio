import { createHash, randomUUID } from "node:crypto";
import {
  auditLogClassificationMetadata,
  auditLogSurfaceValues,
  auditLogVisibilityValues,
  authPasswordResetRequestedTemplate,
  authSessionCreatedTemplate,
  authSessionRevokedTemplate,
  authUserCreatedTemplate,
  canonicalJson,
  consentGrantedTemplate,
  consentRevokedTemplate,
  createEvidenceEdge,
  dataSubjectRequestCreatedTemplate,
  exportBundleCreatedTemplate,
  organizationCreatedTemplate,
  organizationMemberInvitedTemplate,
  organizationMemberJoinedTemplate,
  organizationMemberRemovedTemplate,
  organizationMemberRoleChangedTemplate,
  retentionPolicyAppliedTemplate,
  type AuditEventInput,
  type EvidenceEdge,
  type EvidenceEdgeRelation,
  type EvidenceScope,
  type Principal,
} from "@veritio/core";

export const sdkGovernanceTemplateActions = [
  "auth.user.created",
  "auth.session.created",
  "auth.session.revoked",
  "auth.password.reset.requested",
  "org.created",
  "org.member.invited",
  "org.member.joined",
  "org.member.role.changed",
  "org.member.removed",
  "consent.granted",
  "consent.revoked",
  "data.subject.request.created",
  "export.bundle.created",
  "retention.policy.applied",
] as const;

export const hostedCloudActions = [
  "project.created",
  "project.updated",
  "scoped.key.created",
  "evidence.ingest.accepted",
  "evidence.read.events",
  "evidence.read.edges",
  "evidence.read.graph",
  "audit.log.read",
  "retention.sweep.completed",
] as const;

export const hostedCloudAuthorities = ["ingest", "read", "export", "admin", "billing", "mcp"] as const;

export const fullGovernanceActions = [
  ...sdkGovernanceTemplateActions,
  ...hostedCloudActions,
] as const;

export const fullGovernanceRelations = [
  "caused_by",
  "part_of",
  "read",
  "modified",
  "created",
  "deleted",
  "derived_from",
  "attests_to",
  "exports",
  "satisfies_policy",
  "violates_policy",
  "subject_of",
  "processed_for",
  "retained_under",
  "sent_to",
] as const satisfies readonly EvidenceEdgeRelation[];

export interface FullGovernanceScenarioInput {
  tenantId: string;
  environment?: string;
  runId?: string;
  actorId?: string;
}

export interface FullGovernanceScenario {
  runId: string;
  tenantId: string;
  canonicalPlanHash: string;
  events: AuditEventInput[];
  edges: EvidenceEdge[];
}

/**
 * Builds the canonical non-agent/non-code governance scenario used for local
 * SDK coverage and deployed hosted-ingest smoke tests. Cloudflare deployment
 * configuration remains owned by veritio-cloud, not this portable payload
 * harness.
 */
export function buildFullGovernanceScenario(input: FullGovernanceScenarioInput): FullGovernanceScenario {
  const runId = input.runId ?? randomUUID();
  const tenantId = input.tenantId;
  const scope: EvidenceScope = { tenantId, environment: input.environment ?? "reference" };
  const actor: Principal = { type: "user", id: input.actorId ?? "sdk_poc_operator" };
  const service: Principal = { type: "system", id: "sdk_poc_policy_worker" };
  const ids = scenarioIds(runId, tenantId);
  const canonicalPlanHash = stableHash(
    canonicalJson({
      scenario: "full_governance_without_code_or_agent",
      runId,
      tenantId,
      country: "US",
      region: "CA",
      actions: fullGovernanceActions,
      relations: fullGovernanceRelations,
    }),
  );
  const externalApi = auditLogClassificationMetadata({ visibility: "external", surface: "api" });
  const internalApp = auditLogClassificationMetadata({ visibility: "internal", surface: "app" });
  const systemWorker = auditLogClassificationMetadata({ visibility: "system", surface: "worker" });
  const partnerWebhook = auditLogClassificationMetadata({ visibility: "partner", surface: "webhook" });
  const internalCli = auditLogClassificationMetadata({ visibility: "internal", surface: "cli" });
  const securityContext = {
    ipAddressHash: stableHash("203.0.113.42"),
    userAgentHash: stableHash("full-governance-poc-browser"),
    location: { country: "US", region: "CA" },
    method: "password",
    provider: "better-auth",
    riskScore: 0.18,
  };

  const sdkEvents: AuditEventInput[] = [
    authUserCreatedTemplate({
      userId: actor.id,
      actor,
      scope,
      requestId: `full-governance:${runId}:user-created`,
      metadata: { ...externalApi, canonicalPlanHash, fullGovernanceRunId: runId },
    }),
    authSessionCreatedTemplate({
      userId: actor.id,
      sessionId: ids.session,
      actor,
      scope,
      requestId: `full-governance:${runId}:session-created`,
      securityContext,
      metadata: { ...externalApi, canonicalPlanHash, fullGovernanceRunId: runId },
    }),
    authSessionRevokedTemplate({
      userId: actor.id,
      sessionId: ids.session,
      actor,
      scope,
      requestId: `full-governance:${runId}:session-revoked`,
      securityContext,
      metadata: { ...externalApi, reason: "operator_logout" },
    }),
    authPasswordResetRequestedTemplate({
      userId: actor.id,
      resetRequestId: ids.passwordReset,
      actor,
      scope,
      requestId: `full-governance:${runId}:password-reset`,
      metadata: externalApi,
    }),
    organizationCreatedTemplate({
      organizationId: tenantId,
      organizationDisplay: "Full Governance Tenant",
      actor,
      scope,
      requestId: `full-governance:${runId}:org-created`,
      metadata: { ...externalApi, canonicalPlanHash },
    }),
    organizationMemberInvitedTemplate({
      organizationId: tenantId,
      invitationId: ids.invite,
      inviter: actor,
      role: ["admin", "privacy_reviewer"],
      scope,
      requestId: `full-governance:${runId}:member-invited`,
      metadata: internalApp,
    }),
    organizationMemberJoinedTemplate({
      organizationId: tenantId,
      memberId: ids.member,
      actor,
      role: ["admin", "privacy_reviewer"],
      scope,
      requestId: `full-governance:${runId}:member-joined`,
      metadata: internalApp,
    }),
    organizationMemberRoleChangedTemplate({
      organizationId: tenantId,
      memberId: ids.member,
      actor,
      role: ["privacy_reviewer"],
      scope,
      requestId: `full-governance:${runId}:member-role-changed`,
      metadata: { ...internalApp, previousRoleHash: stableHash("admin") },
    }),
    organizationMemberRemovedTemplate({
      organizationId: tenantId,
      memberId: ids.member,
      actor,
      role: ["privacy_reviewer"],
      scope,
      requestId: `full-governance:${runId}:member-removed`,
      metadata: { ...internalApp, reason: "offboarded" },
    }),
    consentGrantedTemplate({
      actor,
      consentId: ids.consent,
      subjectId: ids.subject,
      purposeId: ids.purpose,
      scope,
      requestId: `full-governance:${runId}:consent-granted`,
      dataCategories: ["account", "preferences", "usage"],
      metadata: externalApi,
    }),
    consentRevokedTemplate({
      actor,
      consentId: ids.consent,
      subjectId: ids.subject,
      purposeId: ids.purpose,
      scope,
      requestId: `full-governance:${runId}:consent-revoked`,
      dataCategories: ["preferences", "usage"],
      metadata: externalApi,
    }),
    dataSubjectRequestCreatedTemplate({
      actor,
      subjectRequestId: ids.subjectRequest,
      requestType: "access_export",
      subjectId: ids.subject,
      scope,
      requestId: `full-governance:${runId}:subject-request`,
      metadata: externalApi,
    }),
    exportBundleCreatedTemplate({
      actor: service,
      exportBundleId: ids.exportBundle,
      format: "jsonl",
      scope,
      requestId: `full-governance:${runId}:export-created`,
      metadata: { ...externalApi, canonicalPlanHash },
    }),
    retentionPolicyAppliedTemplate({
      actor: service,
      policyId: ids.policy,
      resourceId: tenantId,
      scope,
      requestId: `full-governance:${runId}:retention-applied`,
      metadata: systemWorker,
    }),
  ];

  const cloudEvents = hostedCloudEvents({
    scope,
    actor,
    service,
    tenantId,
    runId,
    canonicalPlanHash,
    classifiers: { externalApi, internalApp, systemWorker, partnerWebhook, internalCli },
  });
  const events = [...sdkEvents, ...cloudEvents];
  const edges = fullGovernanceEdges(scope, actor, service, ids, canonicalPlanHash, runId);
  return { runId, tenantId, canonicalPlanHash, events, edges };
}

/**
 * Builds hosted-compatible control-plane and machine-use events as ordinary SDK
 * audit inputs. These are host-defined action names, not new protocol template
 * semantics, and they cover project, key authority, ingest, read, audit-log,
 * export/billing/MCP authority, and retention-sweep surfaces.
 */
function hostedCloudEvents(input: {
  scope: EvidenceScope;
  actor: Principal;
  service: Principal;
  tenantId: string;
  runId: string;
  canonicalPlanHash: string;
  classifiers: {
    externalApi: Record<string, string>;
    internalApp: Record<string, string>;
    systemWorker: Record<string, string>;
    partnerWebhook: Record<string, string>;
    internalCli: Record<string, string>;
  };
}): AuditEventInput[] {
  const cloudMetadata = {
    canonicalPlanHash: input.canonicalPlanHash,
    fullGovernanceRunId: input.runId,
  };
  const keyEvents = hostedCloudAuthorities.map((authority): AuditEventInput => ({
    actor: input.actor,
    action: "scoped.key.created",
    target: { type: "tenant_scoped_key", id: `key_${authority}_${input.runId}` },
    scope: input.scope,
    requestId: `full-governance:${input.runId}:scoped-key:${authority}`,
    purpose: "access_management",
    lawfulBasis: "contract",
    retention: "security_1y",
    metadata: {
      ...input.classifiers.internalApp,
      ...cloudMetadata,
      authority,
      hostedAuditAction: "scoped_key.created",
      projectId: input.tenantId,
      keyPrefix: `vrt_${authority.slice(0, 3)}_demo`,
    },
  }));

  return [
    {
      actor: input.actor,
      action: "project.created",
      target: { type: "tenant_project", id: input.tenantId },
      scope: input.scope,
      requestId: `full-governance:${input.runId}:project-created`,
      purpose: "account_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: { ...input.classifiers.internalApp, ...cloudMetadata, slugHash: stableHash(input.tenantId) },
    },
    {
      actor: input.actor,
      action: "project.updated",
      target: { type: "tenant_project", id: input.tenantId },
      scope: input.scope,
      requestId: `full-governance:${input.runId}:project-updated`,
      purpose: "account_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: { ...input.classifiers.internalCli, ...cloudMetadata, field: "display_name" },
    },
    ...keyEvents,
    {
      actor: { type: "service", id: "cloud_ingest_api" },
      action: "evidence.ingest.accepted",
      target: { type: "tenant_project", id: input.tenantId },
      scope: input.scope,
      requestId: `full-governance:${input.runId}:ingest-accepted`,
      purpose: "audit_trail",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: { ...input.classifiers.partnerWebhook, ...cloudMetadata, acceptedEvents: 14, acceptedEdges: 15 },
    },
    {
      actor: input.service,
      action: "evidence.read.events",
      target: { type: "tenant_project", id: input.tenantId },
      scope: input.scope,
      requestId: `full-governance:${input.runId}:read-events`,
      purpose: "audit_trail",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: { ...input.classifiers.externalApi, ...cloudMetadata, projection: "events" },
    },
    {
      actor: input.service,
      action: "evidence.read.edges",
      target: { type: "tenant_project", id: input.tenantId },
      scope: input.scope,
      requestId: `full-governance:${input.runId}:read-edges`,
      purpose: "audit_trail",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: { ...input.classifiers.externalApi, ...cloudMetadata, projection: "edges" },
    },
    {
      actor: input.service,
      action: "evidence.read.graph",
      target: { type: "tenant_project", id: input.tenantId },
      scope: input.scope,
      requestId: `full-governance:${input.runId}:read-graph`,
      purpose: "audit_trail",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: { ...input.classifiers.externalApi, ...cloudMetadata, projection: "graph" },
    },
    {
      actor: input.actor,
      action: "audit.log.read",
      target: { type: "tenant_cloud_audit_log", id: `audit_${input.runId}` },
      scope: input.scope,
      requestId: `full-governance:${input.runId}:audit-log-read`,
      purpose: "security_audit",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: {
        ...input.classifiers.internalApp,
        ...cloudMetadata,
        visibilityValues: auditLogVisibilityValues,
        surfaceValues: auditLogSurfaceValues,
      },
    },
    {
      actor: input.service,
      action: "retention.sweep.completed",
      target: { type: "policy", id: `cloud_audit_retention_${input.runId}` },
      scope: input.scope,
      requestId: `full-governance:${input.runId}:retention-sweep`,
      purpose: "retention_management",
      lawfulBasis: "legal_obligation",
      retention: "retention_audit_7y",
      metadata: { ...input.classifiers.systemWorker, ...cloudMetadata, purgedRows: 0 },
    },
  ];
}

/**
 * Builds a relation-wide graph without using code-change or agent-session
 * entities, so hosted deployments can ingest it as ordinary governed app
 * evidence.
 */
function fullGovernanceEdges(
  scope: EvidenceScope,
  actor: Principal,
  service: Principal,
  ids: ReturnType<typeof scenarioIds>,
  canonicalPlanHash: string,
  runId: string,
): EvidenceEdge[] {
  const metadata = { source: "cloud-full-governance-poc", canonicalPlanHash, fullGovernanceRunId: runId };
  const actorEntity = { type: "actor" as const, id: actor.id, actorType: "user" as const };
  const systemEntity = { type: "system" as const, id: service.id };
  const user = { type: "resource" as const, id: actor.id, resourceType: "user" };
  const session = { type: "resource" as const, id: ids.session, resourceType: "session" };
  const organization = { type: "resource" as const, id: ids.tenantId, resourceType: "organization" };
  const member = { type: "resource" as const, id: ids.member, resourceType: "organization_member" };
  const reset = { type: "resource" as const, id: ids.passwordReset, resourceType: "password_reset_request" };
  const consent = { type: "consent" as const, id: ids.consent };
  const subject = { type: "data_subject" as const, id: ids.subject };
  const purpose = { type: "purpose" as const, id: ids.purpose };
  const policy = { type: "policy" as const, id: ids.policy };
  const subjectRequest = { type: "subject_request" as const, id: ids.subjectRequest };
  const exportBundle = { type: "export_bundle" as const, id: ids.exportBundle };
  const processor = { type: "processor" as const, id: ids.processor };
  const archive = { type: "artifact" as const, id: ids.archive };

  return [
    edge(scope, actorEntity, "created", user, metadata),
    edge(scope, session, "caused_by", actorEntity, metadata),
    edge(scope, reset, "read", user, metadata),
    edge(scope, member, "modified", organization, metadata),
    edge(scope, member, "deleted", organization, metadata),
    edge(scope, exportBundle, "derived_from", subjectRequest, metadata),
    edge(scope, systemEntity, "attests_to", exportBundle, metadata),
    edge(scope, exportBundle, "exports", subjectRequest, metadata),
    edge(scope, policy, "satisfies_policy", exportBundle, metadata),
    edge(scope, consent, "violates_policy", policy, metadata),
    edge(scope, consent, "subject_of", subject, metadata),
    edge(scope, subject, "processed_for", purpose, metadata),
    edge(scope, organization, "retained_under", policy, metadata),
    edge(scope, exportBundle, "sent_to", processor, metadata),
    edge(scope, archive, "part_of", exportBundle, metadata),
  ];
}

/**
 * Validates each edge through the core SDK before the scenario can be posted to
 * hosted deployments, preserving protocol-owned entity/relation semantics.
 */
function edge(
  scope: EvidenceScope,
  from: Parameters<typeof createEvidenceEdge>[0]["from"],
  relation: EvidenceEdgeRelation,
  to: Parameters<typeof createEvidenceEdge>[0]["to"],
  metadata: Record<string, unknown>,
): EvidenceEdge {
  return createEvidenceEdge({ scope, from, relation, to, metadata });
}

/**
 * Names stable opaque resources for one run; no raw personal data or code paths
 * are embedded in evidence ids.
 */
function scenarioIds(runId: string, tenantId: string) {
  const suffix = runId.replaceAll("-", "_");
  return {
    tenantId,
    session: `session_${suffix}`,
    passwordReset: `password_reset_${suffix}`,
    invite: `invite_${suffix}`,
    member: `member_${suffix}`,
    consent: `consent_${suffix}`,
    subject: `subject_${suffix}`,
    purpose: `purpose_${suffix}`,
    subjectRequest: `dsr_${suffix}`,
    exportBundle: `export_${suffix}`,
    policy: `policy_${suffix}`,
    processor: `processor_${suffix}`,
    archive: `archive_${suffix}`,
  };
}

/**
 * Hashes canonical scenario JSON and demo strings before they enter metadata.
 */
function stableHash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

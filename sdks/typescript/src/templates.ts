import type { ActorType, AuditEventInput, EvidenceScope, LawfulBasis, Principal, Resource } from "./index";
import { withRiskSignals, type RiskSignals } from "./risk";

export type AuditTemplateSetName = "auth" | "organization" | "data" | "agent" | "code";

export const auditLogVisibilityValues = ["internal", "external", "partner", "system"] as const;
export const auditLogSurfaceValues = ["api", "app", "worker", "cli", "webhook"] as const;

export type AuditLogVisibility = (typeof auditLogVisibilityValues)[number];
export type AuditLogSurface = (typeof auditLogSurfaceValues)[number];

export interface AuditLogClassificationInput {
  visibility?: string | null;
  surface?: string | null;
}

export interface AuditLogClassifiers {
  visibility?: AuditLogVisibility;
  surface?: AuditLogSurface;
}

/**
 * Builds normalized metadata for hosted or self-hosted audit filters without
 * promoting visibility/surface classifications into core protocol fields.
 */
export function auditLogClassificationMetadata(input: AuditLogClassificationInput): {
  logVisibility?: AuditLogVisibility;
  logSurface?: AuditLogSurface;
} {
  const visibility = normalizeAuditLogVisibility(input.visibility);
  const surface = normalizeAuditLogSurface(input.surface);
  return {
    ...(visibility ? { logVisibility: visibility } : {}),
    ...(surface ? { logSurface: surface } : {}),
  };
}

/**
 * Detects audit-log visibility and surface classifiers from normalized SDK
 * metadata and common host aliases so Cloud facets can work with historic rows.
 */
export function detectAuditLogClassifiers(metadata: Record<string, unknown> | undefined): AuditLogClassifiers {
  if (!metadata) {
    return {};
  }
  const auditLog = metadataObject(metadata.auditLog);
  const audit = metadataObject(metadata.audit);
  const client = metadataObject(metadata.client);
  const request = metadataObject(metadata.request);
  const visibility = firstNormalized(
    [
      metadata.logVisibility,
      metadata.visibility,
      metadata.audience,
      metadata.exposure,
      auditLog?.visibility,
      auditLog?.audience,
      audit?.visibility,
      request?.visibility,
    ],
    normalizeAuditLogVisibility,
  );
  const surface = firstNormalized(
    [
      metadata.logSurface,
      metadata.surface,
      metadata.channel,
      auditLog?.surface,
      auditLog?.channel,
      audit?.surface,
      request?.surface,
      client?.surface,
      client?.type,
    ],
    normalizeAuditLogSurface,
  );
  return {
    ...(visibility ? { visibility } : {}),
    ...(surface ? { surface } : {}),
  };
}

/**
 * Canonicalizes log visibility labels used for filtering internal, external,
 * partner, and system-facing audit streams.
 */
export function normalizeAuditLogVisibility(value: unknown): AuditLogVisibility | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return AUDIT_LOG_VISIBILITY_ALIASES[normalizeClassifierLabel(value)];
}

/**
 * Canonicalizes log surface labels used for filtering API, app, worker, CLI,
 * and webhook audit streams.
 */
export function normalizeAuditLogSurface(value: unknown): AuditLogSurface | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return AUDIT_LOG_SURFACE_ALIASES[normalizeClassifierLabel(value)];
}

export const auditTemplateSets = {
  auth: ["auth.user.created", "auth.session.created", "auth.session.revoked", "auth.password.reset.requested"],
  organization: [
    "org.created",
    "org.member.invited",
    "org.member.joined",
    "org.member.removed",
    "org.member.role.changed",
  ],
  data: [
    "consent.granted",
    "consent.revoked",
    "data.subject.request.created",
    "export.bundle.created",
    "retention.policy.applied",
  ],
  agent: ["agent.session.started", "agent.prompt.recorded", "agent.tool.called"],
  code: [
    "change.proposal.created",
    "change.files.changed",
    "review.approval.recorded",
    "review.finding.created",
    "review.waiver.recorded",
    "ci.job.completed",
    "deploy.deployed",
    "audit.runtime.observed",
  ],
} as const satisfies Record<AuditTemplateSetName, readonly string[]>;

export interface AuditTemplateCommonInput {
  id?: string;
  occurredAt?: string | Date;
  scope?: EvidenceScope;
  requestId?: string;
  purpose?: string;
  lawfulBasis?: LawfulBasis;
  dataCategories?: string[];
  retention?: string;
  metadata?: Record<string, unknown>;
  activityEpisodeId?: string;
  riskSignals?: RiskSignals;
}

export interface UserAuditTemplateInput extends AuditTemplateCommonInput {
  userId: string;
  userDisplay?: string;
  actor?: Principal;
}

export interface SessionAuditTemplateInput extends AuditTemplateCommonInput {
  userId: string;
  sessionId: string;
  userDisplay?: string;
  actor?: Principal;
  securityContext?: SessionSecurityContext;
}

export interface SessionSecurityContext {
  ipAddressHash?: string;
  networkHash?: string;
  userAgentHash?: string;
  deviceId?: string;
  location?: {
    country?: string;
    region?: string;
  };
  method?: string;
  provider?: string;
}

export interface PasswordResetAuditTemplateInput extends AuditTemplateCommonInput {
  userId: string;
  resetRequestId: string;
  userDisplay?: string;
  actor?: Principal;
}

export interface OrganizationAuditTemplateInput extends AuditTemplateCommonInput {
  organizationId: string;
  organizationDisplay?: string;
  actor: Principal;
}

export interface OrganizationMemberAuditTemplateInput extends AuditTemplateCommonInput {
  organizationId: string;
  memberId: string;
  actor: Principal;
  role?: string | string[];
}

export interface OrganizationInvitationAuditTemplateInput extends AuditTemplateCommonInput {
  organizationId: string;
  invitationId: string;
  inviter: Principal;
  role?: string | string[];
}

export interface ConsentAuditTemplateInput extends AuditTemplateCommonInput {
  actor: Principal;
  consentId: string;
  subjectId?: string;
  purposeId?: string;
  dataCategories?: string[];
}

export interface SubjectRequestAuditTemplateInput extends AuditTemplateCommonInput {
  actor: Principal;
  subjectRequestId: string;
  requestType: string;
  subjectId?: string;
}

export interface ExportBundleAuditTemplateInput extends AuditTemplateCommonInput {
  actor: Principal;
  exportBundleId: string;
  format?: string;
}

export interface RetentionPolicyAuditTemplateInput extends AuditTemplateCommonInput {
  actor: Principal;
  policyId: string;
  resourceId?: string;
}

export interface AgentSessionAuditTemplateInput extends AuditTemplateCommonInput {
  sessionId: string;
  agentActor: Principal;
  initiatedBy?: Principal;
  agent?: { name: string; version?: string };
  model?: { provider: string; name: string };
}

export interface EpisodeStartedAuditTemplateInput extends AuditTemplateCommonInput {
  activityEpisodeId: string;
  actor: Principal;
  authSessionId?: string;
  authContextId?: string;
  domain?: string;
  startReason?: string;
}

export interface AgentPromptAuditTemplateInput extends AuditTemplateCommonInput {
  sessionId: string;
  promptId?: string;
  promptHash: string;
  agentActor: Principal;
}

export interface AgentToolAuditTemplateInput extends AuditTemplateCommonInput {
  sessionId: string;
  toolCallId: string;
  tool: string;
  status: string;
  agentActor: Principal;
  inputHash?: string;
  latencyMs?: number;
}

export interface ChangeProposalAuditTemplateInput extends AuditTemplateCommonInput {
  proposalId: string;
  actor: Principal;
  sessionId?: string;
  repositoryId?: string;
  branch?: string;
}

export interface FilesChangedAuditTemplateInput extends AuditTemplateCommonInput {
  sourceTreeId: string;
  actor: Principal;
  sessionId?: string;
  fileCount?: number;
  filePathHashes?: string[];
  changedById?: string;
}

export interface ReviewAuditTemplateInput extends AuditTemplateCommonInput {
  pullRequestId: string;
  reviewer: Principal;
  sessionId?: string;
  proposalId?: string;
  findingCount?: number;
  waiverCount?: number;
}

export interface CiJobAuditTemplateInput extends AuditTemplateCommonInput {
  ciRunId: string;
  service: Principal;
  status: string;
  sessionId?: string;
  artifactId?: string;
}

export interface DeploymentAuditTemplateInput extends AuditTemplateCommonInput {
  deploymentId: string;
  service: Principal;
  sessionId?: string;
  artifactId?: string;
  policyId?: string;
}

export interface RuntimeObservedAuditTemplateInput extends AuditTemplateCommonInput {
  runtimeEventId: string;
  actor: Principal;
  sessionId?: string;
  deploymentId?: string;
  observedOutcome?: string;
}

type AuditTemplateDefaults = {
  actor: Principal;
  action: string;
  target: Resource;
  purpose?: string | undefined;
  lawfulBasis?: LawfulBasis | undefined;
  dataCategories?: string[] | undefined;
  retention?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
};

/**
 * Builds a tenant-scoped account creation event without requiring users to know
 * the canonical auth action string. Raw email/profile details should stay out of
 * metadata; `createAuditEvent` still redacts sensitive keys if callers pass them.
 */
export function authUserCreatedTemplate(input: UserAuditTemplateInput): AuditEventInput {
  return buildTemplate(input, {
    actor: input.actor ?? principal("user", input.userId, input.userDisplay),
    action: "auth.user.created",
    target: resource("user", input.userId, input.userDisplay),
    purpose: "access_management",
    lawfulBasis: "contract",
    retention: "security_1y",
  });
}

/**
 * Builds a successful sign-in/session-created event. Client IP, coarse
 * location, or device context can be passed in metadata when the host has chosen
 * to retain it for authentication security audit trails.
 */
export function authSessionCreatedTemplate(input: SessionAuditTemplateInput): AuditEventInput {
  return buildTemplate(input, {
    actor: input.actor ?? principal("user", input.userId, input.userDisplay),
    action: "auth.session.created",
    target: resource("session", input.sessionId),
    purpose: "access_management",
    lawfulBasis: "contract",
    retention: "security_1y",
    metadata: compactMetadata({
      securityContext: compactSessionSecurityContext(input.securityContext),
    }),
  });
}

/**
 * Builds a logout/session-revocation event using the stable session id as the
 * target. Hosts should never include session tokens, cookies, or authorization
 * headers in metadata.
 */
export function authSessionRevokedTemplate(input: SessionAuditTemplateInput): AuditEventInput {
  return buildTemplate(input, {
    actor: input.actor ?? principal("user", input.userId, input.userDisplay),
    action: "auth.session.revoked",
    target: resource("session", input.sessionId),
    purpose: "access_management",
    lawfulBasis: "contract",
    retention: "security_1y",
    metadata: compactMetadata({
      securityContext: compactSessionSecurityContext(input.securityContext),
    }),
  });
}

/**
 * Builds a password reset request event without storing reset tokens. The reset
 * request id is a stable target id chosen by the host boundary.
 */
export function authPasswordResetRequestedTemplate(input: PasswordResetAuditTemplateInput): AuditEventInput {
  return buildTemplate(input, {
    actor: input.actor ?? principal("user", input.userId, input.userDisplay),
    action: "auth.password.reset.requested",
    target: resource("password_reset_request", input.resetRequestId),
    purpose: "access_management",
    lawfulBasis: "contract",
    retention: "security_1y",
  });
}

/**
 * Builds an organization-created event and defaults tenant scope to the
 * organization id, matching the common bootstrap case where org identity first
 * becomes available after account creation.
 */
export function organizationCreatedTemplate(input: OrganizationAuditTemplateInput): AuditEventInput {
  return buildTemplate(
    { ...input, scope: input.scope ?? { tenantId: input.organizationId } },
    {
      actor: input.actor,
      action: "org.created",
      target: resource("organization", input.organizationId, input.organizationDisplay),
      purpose: "access_management",
      lawfulBasis: "contract",
      retention: "security_1y",
    },
  );
}

/**
 * Builds an organization invitation event while preserving only stable invite
 * and role metadata, not the invited user's raw email address.
 */
export function organizationMemberInvitedTemplate(input: OrganizationInvitationAuditTemplateInput): AuditEventInput {
  return buildTemplate(
    { ...input, scope: input.scope ?? { tenantId: input.organizationId } },
    {
      actor: input.inviter,
      action: "org.member.invited",
      target: resource("organization_invitation", input.invitationId),
      purpose: "access_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: roleMetadata(input.role),
    },
  );
}

/**
 * Builds an organization member joined event for invitation acceptance or admin
 * membership creation. Role metadata is normalized and deduplicated.
 */
export function organizationMemberJoinedTemplate(input: OrganizationMemberAuditTemplateInput): AuditEventInput {
  return organizationMemberTemplate(input, "org.member.joined");
}

/**
 * Builds an organization member removed event using member id rather than raw
 * profile details, preserving tenant scope through organization id by default.
 */
export function organizationMemberRemovedTemplate(input: OrganizationMemberAuditTemplateInput): AuditEventInput {
  return organizationMemberTemplate(input, "org.member.removed");
}

/**
 * Builds an organization role-change event. Include previous/new role values in
 * metadata only when those role labels are non-sensitive and host-defined.
 */
export function organizationMemberRoleChangedTemplate(input: OrganizationMemberAuditTemplateInput): AuditEventInput {
  return organizationMemberTemplate(input, "org.member.role.changed");
}

/**
 * Builds a consent granted event for consent-history screens. The subject id
 * and purpose id are optional metadata so hosts can use stable opaque ids.
 */
export function consentGrantedTemplate(input: ConsentAuditTemplateInput): AuditEventInput {
  return consentTemplate(input, "consent.granted");
}

/**
 * Builds a consent revoked event using the same stable consent id as the grant
 * event, making consent-history timelines easy to group.
 */
export function consentRevokedTemplate(input: ConsentAuditTemplateInput): AuditEventInput {
  return consentTemplate(input, "consent.revoked");
}

/**
 * Builds a data-subject workflow request event. This is evidence support for a
 * workflow entry, not a claim that the workflow satisfies any regulation.
 */
export function dataSubjectRequestCreatedTemplate(input: SubjectRequestAuditTemplateInput): AuditEventInput {
  return buildTemplate(input, {
    actor: input.actor,
    action: "data.subject.request.created",
    target: resource("subject_request", input.subjectRequestId),
    purpose: input.purpose ?? "data_subject_workflow",
    lawfulBasis: input.lawfulBasis ?? "legal_obligation",
    retention: input.retention ?? "subject_request_3y",
    metadata: compactMetadata({
      requestType: input.requestType,
      subjectId: input.subjectId,
    }),
  });
}

/**
 * Builds an export bundle creation event for DSAR/export evidence. Bundle
 * contents should be represented by stable ids or hashes, not copied into metadata.
 */
export function exportBundleCreatedTemplate(input: ExportBundleAuditTemplateInput): AuditEventInput {
  return buildTemplate(input, {
    actor: input.actor,
    action: "export.bundle.created",
    target: resource("export_bundle", input.exportBundleId),
    purpose: input.purpose ?? "data_subject_workflow",
    lawfulBasis: input.lawfulBasis ?? "legal_obligation",
    retention: input.retention ?? "export_1y",
    metadata: compactMetadata({ format: input.format }),
  });
}

/**
 * Builds a retention policy applied event. The target remains the policy id;
 * affected resource ids can be supplied as metadata when they are stable.
 */
export function retentionPolicyAppliedTemplate(input: RetentionPolicyAuditTemplateInput): AuditEventInput {
  return buildTemplate(input, {
    actor: input.actor,
    action: "retention.policy.applied",
    target: resource("policy", input.policyId),
    purpose: input.purpose ?? "retention_management",
    lawfulBasis: input.lawfulBasis ?? "legal_obligation",
    retention: input.retention ?? "retention_audit_7y",
    metadata: compactMetadata({ resourceId: input.resourceId }),
  });
}

/**
 * Builds an agent session started event using the same action and metadata
 * conventions as the richer provenance recorder, without emitting graph edges.
 */
export function agentSessionStartedTemplate(input: AgentSessionAuditTemplateInput): AuditEventInput {
  return buildTemplate(
    input,
    {
      actor: input.agentActor,
      action: "agent.session.started",
      target: resource("agent_session", input.sessionId),
      purpose: input.purpose ?? "change_provenance",
      retention: input.retention ?? "security_1y",
      metadata: compactMetadata({
        sessionId: input.sessionId,
        initiatedBy: input.initiatedBy ? { type: input.initiatedBy.type, id: input.initiatedBy.id } : undefined,
        agent: input.agent,
        model: input.model,
      }),
    },
    { metadataPolicy: "block-raw-content" },
  );
}

/**
 * Builds an activity.episode.started event that opens a Layer-1 activity episode.
 * The episode id is the target and is threaded onto metadata.activityEpisodeId
 * (un-shadowably, via buildTemplate) so every downstream event sharing the episode
 * groups under the same chain key. No event.schema.json change is required: the
 * dotted-action pattern and open metadata already accept this event.
 */
export function episodeStartedTemplate(input: EpisodeStartedAuditTemplateInput): AuditEventInput {
  return buildTemplate(input, {
    actor: input.actor,
    action: "activity.episode.started",
    target: resource("activity_episode", input.activityEpisodeId),
    purpose: input.purpose ?? "change_provenance",
    retention: input.retention ?? "security_1y",
    metadata: compactMetadata({
      activityEpisodeId: input.activityEpisodeId,
      authSessionId: input.authSessionId,
      authContextId: input.authContextId,
      domain: input.domain,
      startReason: input.startReason,
    }),
  });
}

/**
 * Builds an agent prompt recorded event with a prompt hash only. Raw prompt text
 * must never be passed into metadata.
 */
export function agentPromptRecordedTemplate(input: AgentPromptAuditTemplateInput): AuditEventInput {
  return buildTemplate(
    input,
    {
      actor: input.agentActor,
      action: "agent.prompt.recorded",
      target: resource("agent_session", input.sessionId),
      purpose: input.purpose ?? "change_provenance",
      retention: input.retention ?? "security_1y",
      metadata: compactMetadata({
        sessionId: input.sessionId,
        promptId: input.promptId,
        promptHash: input.promptHash,
      }),
    },
    { metadataPolicy: "block-raw-content" },
  );
}

/**
 * Builds an agent tool call event. Inputs are represented by hashes and stable
 * ids; raw tool arguments or command output should stay outside metadata.
 */
export function agentToolCalledTemplate(input: AgentToolAuditTemplateInput): AuditEventInput {
  return buildTemplate(
    input,
    {
      actor: input.agentActor,
      action: "agent.tool.called",
      target: resource("tool_call", input.toolCallId),
      purpose: input.purpose ?? "change_provenance",
      retention: input.retention ?? "security_1y",
      metadata: compactMetadata({
        sessionId: input.sessionId,
        tool: input.tool,
        status: input.status,
        inputHash: input.inputHash,
        latencyMs: input.latencyMs,
      }),
    },
    { metadataPolicy: "block-raw-content" },
  );
}

/**
 * Builds a code change proposal event for pull-request or patch proposal flows.
 * The template captures ids and branch labels, not raw diffs.
 */
export function changeProposalCreatedTemplate(input: ChangeProposalAuditTemplateInput): AuditEventInput {
  return buildTemplate(
    input,
    {
      actor: input.actor,
      action: "change.proposal.created",
      target: resource("change_proposal", input.proposalId),
      purpose: input.purpose ?? "change_provenance",
      retention: input.retention ?? "security_1y",
      metadata: compactMetadata({
        sessionId: input.sessionId,
        repositoryId: input.repositoryId,
        branch: input.branch,
      }),
    },
    { metadataPolicy: "block-raw-content" },
  );
}

/**
 * Builds a files-changed event from stable source tree and file path-hash
 * metadata. Never include raw file paths, hunks, prompts, or diffs.
 */
export function filesChangedTemplate(input: FilesChangedAuditTemplateInput): AuditEventInput {
  return buildTemplate(
    input,
    {
      actor: input.actor,
      action: "change.files.changed",
      target: resource("source_tree", input.sourceTreeId),
      purpose: input.purpose ?? "change_provenance",
      retention: input.retention ?? "security_1y",
      metadata: compactMetadata({
        sessionId: input.sessionId,
        fileCount: input.fileCount,
        filePathHashes: input.filePathHashes,
        changedById: input.changedById,
      }),
    },
    { metadataPolicy: "block-raw-content" },
  );
}

/**
 * Builds a review approval event for code or configuration changes. Review
 * details should use finding ids or hashes instead of raw comments when sensitive.
 */
export function reviewApprovalRecordedTemplate(input: ReviewAuditTemplateInput): AuditEventInput {
  return reviewTemplate(input, "review.approval.recorded");
}

/**
 * Builds a review finding event for change review evidence without storing raw
 * review text by default.
 */
export function reviewFindingCreatedTemplate(input: ReviewAuditTemplateInput): AuditEventInput {
  return reviewTemplate(input, "review.finding.created");
}

/**
 * Builds a review waiver event for cases where a finding is explicitly waived.
 * Waiver rationale should be represented by ids or hashes, not copied in full.
 */
export function reviewWaiverRecordedTemplate(input: ReviewAuditTemplateInput): AuditEventInput {
  return reviewTemplate(input, "review.waiver.recorded");
}

/**
 * Builds a CI job completion event with status and optional artifact id. Logs,
 * environment values, and provider tokens should not be copied into metadata.
 */
export function ciJobCompletedTemplate(input: CiJobAuditTemplateInput): AuditEventInput {
  return buildTemplate(
    input,
    {
      actor: input.service,
      action: "ci.job.completed",
      target: resource("ci_run", input.ciRunId),
      purpose: input.purpose ?? "change_provenance",
      retention: input.retention ?? "security_1y",
      metadata: compactMetadata({
        sessionId: input.sessionId,
        status: input.status,
        artifactId: input.artifactId,
      }),
    },
    { metadataPolicy: "block-raw-content" },
  );
}

/**
 * Builds a deployment event from stable deployment/artifact/policy ids. This
 * supports evidence links without asserting compliance success.
 */
export function deploymentCreatedTemplate(input: DeploymentAuditTemplateInput): AuditEventInput {
  return buildTemplate(
    input,
    {
      actor: input.service,
      action: "deploy.deployed",
      target: resource("deployment", input.deploymentId),
      purpose: input.purpose ?? "change_provenance",
      retention: input.retention ?? "security_1y",
      metadata: compactMetadata({
        sessionId: input.sessionId,
        artifactId: input.artifactId,
        policyId: input.policyId,
      }),
    },
    { metadataPolicy: "block-raw-content" },
  );
}

/**
 * Builds a runtime observation event for production or preview behavior. Hosts
 * should pass route hashes, result ids, or aggregate outcomes rather than raw
 * request payloads.
 */
export function runtimeObservedTemplate(input: RuntimeObservedAuditTemplateInput): AuditEventInput {
  return buildTemplate(
    input,
    {
      actor: input.actor,
      action: "audit.runtime.observed",
      target: resource("runtime_event", input.runtimeEventId),
      purpose: input.purpose ?? "runtime_observation",
      retention: input.retention ?? "security_1y",
      metadata: compactMetadata({
        sessionId: input.sessionId,
        deploymentId: input.deploymentId,
        observedOutcome: input.observedOutcome,
      }),
    },
    { metadataPolicy: "block-raw-content" },
  );
}

/**
 * Groups the common audit template helpers by product area so application code
 * can discover the right builder without memorizing canonical action strings.
 */
export const auditTemplates = {
  auth: {
    userCreated: authUserCreatedTemplate,
    signedIn: authSessionCreatedTemplate,
    signedOut: authSessionRevokedTemplate,
    passwordResetRequested: authPasswordResetRequestedTemplate,
  },
  organization: {
    created: organizationCreatedTemplate,
    memberInvited: organizationMemberInvitedTemplate,
    memberJoined: organizationMemberJoinedTemplate,
    memberRemoved: organizationMemberRemovedTemplate,
    memberRoleChanged: organizationMemberRoleChangedTemplate,
  },
  data: {
    consentGranted: consentGrantedTemplate,
    consentRevoked: consentRevokedTemplate,
    subjectRequestCreated: dataSubjectRequestCreatedTemplate,
    exportBundleCreated: exportBundleCreatedTemplate,
    retentionPolicyApplied: retentionPolicyAppliedTemplate,
  },
  agent: {
    sessionStarted: agentSessionStartedTemplate,
    promptRecorded: agentPromptRecordedTemplate,
    toolCalled: agentToolCalledTemplate,
  },
  code: {
    changeProposalCreated: changeProposalCreatedTemplate,
    filesChanged: filesChangedTemplate,
    reviewApprovalRecorded: reviewApprovalRecordedTemplate,
    reviewFindingCreated: reviewFindingCreatedTemplate,
    reviewWaiverRecorded: reviewWaiverRecordedTemplate,
    ciJobCompleted: ciJobCompletedTemplate,
    deploymentCreated: deploymentCreatedTemplate,
    runtimeObserved: runtimeObservedTemplate,
  },
} as const;

/**
 * Shared template constructor that applies caller overrides only through public
 * AuditEventInput fields, then merges metadata with template-reserved ids taking
 * precedence over caller metadata.
 */
function buildTemplate(
  input: AuditTemplateCommonInput,
  template: AuditTemplateDefaults,
  options: { metadataPolicy?: "block-raw-content" } = {},
): AuditEventInput {
  if (options.metadataPolicy === "block-raw-content") {
    assertMetadataDoesNotContainRawContent(input.metadata);
  }
  let metadata = mergeMetadata(input.metadata, template.metadata);
  if (input.activityEpisodeId !== undefined) {
    // Stamped after caller + template metadata so it cannot be shadowed, mirroring
    // the un-shadowable Layer-1 chain key applied by mergeVeritioMetadata.
    metadata.activityEpisodeId = input.activityEpisodeId;
  }
  if (input.riskSignals !== undefined) {
    metadata = withRiskSignals(metadata, input.riskSignals);
  }
  const event: AuditEventInput = {
    actor: template.actor,
    action: template.action,
    target: template.target,
    metadata,
  };
  if (input.id) {
    event.id = input.id;
  }
  if (input.occurredAt) {
    event.occurredAt = input.occurredAt;
  }
  if (input.scope) {
    event.scope = input.scope;
  }
  if (input.requestId) {
    event.requestId = input.requestId;
  }
  const purpose = input.purpose ?? template.purpose;
  if (purpose) {
    event.purpose = purpose;
  }
  const lawfulBasis = input.lawfulBasis ?? template.lawfulBasis;
  if (lawfulBasis) {
    event.lawfulBasis = lawfulBasis;
  }
  const dataCategories = input.dataCategories ?? template.dataCategories;
  if (dataCategories) {
    event.dataCategories = dataCategories;
  }
  const retention = input.retention ?? template.retention;
  if (retention) {
    event.retention = retention;
  }
  return event;
}

/**
 * Builds organization-member events with normalized role metadata and tenant
 * scope defaulted from organization id.
 */
function organizationMemberTemplate(
  input: OrganizationMemberAuditTemplateInput,
  action: "org.member.joined" | "org.member.removed" | "org.member.role.changed",
): AuditEventInput {
  return buildTemplate(
    { ...input, scope: input.scope ?? { tenantId: input.organizationId } },
    {
      actor: input.actor,
      action,
      target: resource("organization_member", input.memberId),
      purpose: "access_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: roleMetadata(input.role),
    },
  );
}

/**
 * Builds consent lifecycle events with stable subject/purpose ids available for
 * consent-history grouping without requiring raw subject identifiers.
 */
function consentTemplate(
  input: ConsentAuditTemplateInput,
  action: "consent.granted" | "consent.revoked",
): AuditEventInput {
  return buildTemplate(input, {
    actor: input.actor,
    action,
    target: resource("consent", input.consentId),
    purpose: input.purpose ?? "consent_management",
    lawfulBasis: input.lawfulBasis ?? "consent",
    dataCategories: input.dataCategories,
    retention: input.retention ?? "consent_7y",
    metadata: compactMetadata({
      subjectId: input.subjectId,
      purposeId: input.purposeId,
    }),
  });
}

/**
 * Builds review lifecycle events while keeping proposal/finding counts as
 * bounded metadata rather than raw review content.
 */
function reviewTemplate(
  input: ReviewAuditTemplateInput,
  action: "review.approval.recorded" | "review.finding.created" | "review.waiver.recorded",
): AuditEventInput {
  return buildTemplate(
    input,
    {
      actor: input.reviewer,
      action,
      target: resource("pull_request", input.pullRequestId),
      purpose: input.purpose ?? "change_provenance",
      retention: input.retention ?? "security_1y",
      metadata: compactMetadata({
        sessionId: input.sessionId,
        proposalId: input.proposalId,
        findingCount: input.findingCount,
        waiverCount: input.waiverCount,
      }),
    },
    { metadataPolicy: "block-raw-content" },
  );
}

/**
 * Creates a protocol principal while omitting display when the host did not
 * intentionally provide a non-sensitive label.
 */
function principal(type: ActorType, id: string, display?: string): Principal {
  return display ? { type, id, display } : { type, id };
}

/**
 * Creates a protocol resource while omitting display when the host did not
 * intentionally provide a non-sensitive label.
 */
function resource(type: string, id: string, display?: string): Resource {
  return display ? { type, id, display } : { type, id };
}

/**
 * Adds role metadata only when the role label is present, and sorts arrays so
 * template output stays deterministic before core redaction/hashing.
 */
function roleMetadata(role: string | string[] | undefined): Record<string, unknown> | undefined {
  if (typeof role === "string" && role.trim().length > 0) {
    return { role };
  }
  if (Array.isArray(role)) {
    const roles = [...new Set(role.filter((item) => item.trim().length > 0))].sort();
    return roles.length > 0 ? { role: roles } : undefined;
  }
  return undefined;
}

/**
 * Keeps session security context bounded to hashed or coarse fields so examples
 * do not nudge hosts toward unnecessary raw IP or user-agent storage.
 */
function compactSessionSecurityContext(input: SessionSecurityContext | undefined): Record<string, unknown> | undefined {
  if (!input) {
    return undefined;
  }
  return compactMetadata({
    ipAddressHash: input.ipAddressHash,
    networkHash: input.networkHash,
    userAgentHash: input.userAgentHash,
    deviceId: input.deviceId,
    location: input.location
      ? compactMetadata({
          country: input.location.country,
          region: input.location.region,
        })
      : undefined,
    method: input.method,
    provider: input.provider,
  });
}

/**
 * Removes absent optional values from template metadata without mutating caller
 * metadata objects.
 */
function compactMetadata(input: Record<string, unknown>): Record<string, unknown> | undefined {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) {
      output[key] = value;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

/**
 * Merges caller metadata with reserved template metadata, giving the template
 * final say over ids such as sessionId so grouping conventions cannot be
 * accidentally shadowed.
 */
function mergeMetadata(
  callerMetadata: Record<string, unknown> | undefined,
  templateMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...(callerMetadata ?? {}), ...(templateMetadata ?? {}) };
}

/**
 * Returns the first successfully normalized classifier candidate, skipping
 * unknown aliases so later explicit metadata fields can still match.
 */
function firstNormalized<T extends string>(
  values: unknown[],
  normalize: (value: unknown) => T | undefined,
): T | undefined {
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

/** Narrows nested metadata bags before classifier detectors read aliases. */
function metadataObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Normalizes classifier labels so `user-facing`, `User Facing`, and aliases match. */
function normalizeClassifierLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Fails closed for agent/code template escape-hatch metadata when callers try
 * to attach raw prompts, diffs, paths, logs, tool arguments, or credential-like
 * values that core key-name redaction would not reliably remove.
 */
function assertMetadataDoesNotContainRawContent(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) {
    return;
  }
  for (const [key, value] of Object.entries(metadata)) {
    assertMetadataValueDoesNotContainRawContent(key, value, `metadata.${key}`);
  }
}

/**
 * Recursively scans caller-owned metadata so nested raw-content keys cannot
 * bypass template minimization guards.
 */
function assertMetadataValueDoesNotContainRawContent(key: string, value: unknown, path: string): void {
  if (isRawContentMetadataKey(key)) {
    throw new TypeError(`${path} is not allowed in agent/code audit template metadata`);
  }
  if (typeof value === "string" && looksLikeRawContentValue(value)) {
    throw new TypeError(`${path} looks like raw content or credential material`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMetadataValueDoesNotContainRawContent(key, item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      assertMetadataValueDoesNotContainRawContent(nestedKey, nestedValue, `${path}.${nestedKey}`);
    }
  }
}

/**
 * Blocks key names that usually denote raw code, prompt, log, path, argument,
 * or credential material while allowing hashed/id/count/status conventions.
 */
function isRawContentMetadataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (
    normalized.endsWith("hash") ||
    normalized.endsWith("hashes") ||
    normalized.endsWith("id") ||
    normalized.endsWith("ids") ||
    normalized.endsWith("count") ||
    normalized.endsWith("status")
  ) {
    return false;
  }
  return [
    "prompt",
    "prompttext",
    "diff",
    "patch",
    "hunk",
    "filepath",
    "path",
    "stdout",
    "stderr",
    "output",
    "commandoutput",
    "toolargs",
    "arguments",
    "args",
    "raw",
    "log",
    "logs",
    "token",
    "authorization",
    "cookie",
    "secret",
    "password",
    "apikey",
  ].some((blocked) => normalized === blocked || normalized.endsWith(blocked));
}

/**
 * Catches common raw patch and bearer-token shapes even when the metadata key
 * itself is innocuous.
 */
function looksLikeRawContentValue(value: string): boolean {
  return (
    /(^|\n)diff --git /.test(value) ||
    /@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(value) ||
    /Bearer\s+[A-Za-z0-9._-]+/i.test(value)
  );
}

const AUDIT_LOG_VISIBILITY_ALIASES: Record<string, AuditLogVisibility> = {
  internal: "internal",
  private: "internal",
  staff: "internal",
  employee: "internal",
  admin: "internal",
  ops: "internal",
  backoffice: "internal",
  firstparty: "internal",
  external: "external",
  public: "external",
  customer: "external",
  user: "external",
  userfacing: "external",
  enduser: "external",
  partner: "partner",
  vendor: "partner",
  thirdparty: "partner",
  system: "system",
  service: "system",
  automation: "system",
  machine: "system",
};

const AUDIT_LOG_SURFACE_ALIASES: Record<string, AuditLogSurface> = {
  api: "api",
  rest: "api",
  graphql: "api",
  http: "api",
  https: "api",
  rpc: "api",
  trpc: "api",
  app: "app",
  application: "app",
  ui: "app",
  web: "app",
  browser: "app",
  dashboard: "app",
  frontend: "app",
  worker: "worker",
  job: "worker",
  cron: "worker",
  queue: "worker",
  background: "worker",
  scheduled: "worker",
  cli: "cli",
  terminal: "cli",
  commandline: "cli",
  command: "cli",
  webhook: "webhook",
  hook: "webhook",
  callback: "webhook",
};

package veritio

import (
	"errors"
	"regexp"
	"sort"
	"strings"
)

// AuditTemplateSets lists the canonical action names covered by the SDK helper
// templates without making those action strings new protocol fields.
var AuditTemplateSets = map[string][]string{
	"auth": {
		"auth.user.created",
		"auth.session.created",
		"auth.session.revoked",
		"auth.password.reset.requested",
	},
	"organization": {
		"org.created",
		"org.member.invited",
		"org.member.joined",
		"org.member.removed",
		"org.member.role.changed",
	},
	"data": {
		"consent.granted",
		"consent.revoked",
		"data.subject.request.created",
		"export.bundle.created",
		"retention.policy.applied",
	},
	"agent": {
		"agent.session.started",
		"agent.prompt.recorded",
		"agent.tool.called",
	},
	"code": {
		"change.proposal.created",
		"change.files.changed",
		"review.approval.recorded",
		"review.finding.created",
		"review.waiver.recorded",
		"ci.job.completed",
		"deploy.deployed",
		"audit.runtime.observed",
	},
}

// AuditLogVisibilityValues lists canonical visibility classifiers that hosts
// can store in metadata.logVisibility for portable filtering.
var AuditLogVisibilityValues = []string{"internal", "external", "partner", "system"}

// AuditLogSurfaceValues lists canonical surface classifiers that hosts can
// store in metadata.logSurface for portable filtering.
var AuditLogSurfaceValues = []string{"api", "app", "worker", "cli", "webhook"}

// AuditLogClassificationInput accepts host-facing visibility and surface labels
// before they are normalized into metadata filters.
type AuditLogClassificationInput struct {
	Visibility string
	Surface    string
}

// AuditLogClassifiers carries normalized visibility and surface detections for
// overview, audit-table, and export filters.
type AuditLogClassifiers struct {
	Visibility string
	Surface    string
}

// AuditLogClassificationMetadata builds normalized metadata for filtering audit
// streams without adding new core protocol fields.
func AuditLogClassificationMetadata(input AuditLogClassificationInput) map[string]any {
	output := map[string]any{}
	if visibility := NormalizeAuditLogVisibility(input.Visibility); visibility != "" {
		output["logVisibility"] = visibility
	}
	if surface := NormalizeAuditLogSurface(input.Surface); surface != "" {
		output["logSurface"] = surface
	}
	return output
}

// DetectAuditLogClassifiers reads normalized SDK metadata and common host
// aliases so filters can work across historic audit rows.
func DetectAuditLogClassifiers(metadata map[string]any) AuditLogClassifiers {
	if metadata == nil {
		return AuditLogClassifiers{}
	}
	auditLog := metadataObject(metadata["auditLog"])
	audit := metadataObject(metadata["audit"])
	client := metadataObject(metadata["client"])
	request := metadataObject(metadata["request"])
	return AuditLogClassifiers{
		Visibility: firstNormalizedClassifier(
			[]any{
				metadata["logVisibility"],
				metadata["visibility"],
				metadata["audience"],
				metadata["exposure"],
				auditLog["visibility"],
				auditLog["audience"],
				audit["visibility"],
				request["visibility"],
			},
			NormalizeAuditLogVisibility,
		),
		Surface: firstNormalizedClassifier(
			[]any{
				metadata["logSurface"],
				metadata["surface"],
				metadata["channel"],
				auditLog["surface"],
				auditLog["channel"],
				audit["surface"],
				request["surface"],
				client["surface"],
				client["type"],
			},
			NormalizeAuditLogSurface,
		),
	}
}

// NormalizeAuditLogVisibility canonicalizes labels used for internal,
// external, partner, and system-facing audit streams.
func NormalizeAuditLogVisibility(value any) string {
	typed, ok := value.(string)
	if !ok {
		return ""
	}
	return auditLogVisibilityAliases[normalizeClassifierLabel(typed)]
}

// NormalizeAuditLogSurface canonicalizes labels used for API, app, worker, CLI,
// and webhook audit streams.
func NormalizeAuditLogSurface(value any) string {
	typed, ok := value.(string)
	if !ok {
		return ""
	}
	return auditLogSurfaceAliases[normalizeClassifierLabel(typed)]
}

// AuditTemplateCommonInput carries the public AuditEventInput overrides shared
// by template helpers, keeping protocol normalization in CreateAuditEvent.
type AuditTemplateCommonInput struct {
	ID                string
	OccurredAt        string
	Scope             *EvidenceScope
	RequestID         string
	Purpose           string
	LawfulBasis       string
	DataCategories    []string
	Retention         string
	Metadata          map[string]any
	ActivityEpisodeID string
	RiskSignals       *RiskSignals
}

// SessionSecurityContext keeps auth security details to hashed or coarse fields
// so template examples do not encourage raw IP or user-agent storage.
type SessionSecurityContext struct {
	IPAddressHash string
	NetworkHash   string
	UserAgentHash string
	DeviceID      string
	Location      *SessionSecurityLocation
	Method        string
	Provider      string
}

// SessionSecurityLocation represents coarse authentication location context
// using country/region only, not precise city or address details.
type SessionSecurityLocation struct {
	Country string
	Region  string
}

// UserAuditTemplateInput identifies the account principal used by auth lifecycle
// templates without requiring raw profile fields.
type UserAuditTemplateInput struct {
	AuditTemplateCommonInput
	UserID      string
	UserDisplay string
	Actor       *Principal
}

// SessionAuditTemplateInput identifies a sign-in or logout session and optional
// hashed/coarse security context selected by the host application.
type SessionAuditTemplateInput struct {
	AuditTemplateCommonInput
	UserID          string
	SessionID       string
	UserDisplay     string
	Actor           *Principal
	SecurityContext *SessionSecurityContext
}

// PasswordResetAuditTemplateInput records password-reset request ids without
// accepting reset tokens or raw email addresses.
type PasswordResetAuditTemplateInput struct {
	AuditTemplateCommonInput
	UserID         string
	ResetRequestID string
	UserDisplay    string
	Actor          *Principal
}

// OrganizationAuditTemplateInput records tenant bootstrap after the first
// organization id exists and can become the tenant scope.
type OrganizationAuditTemplateInput struct {
	AuditTemplateCommonInput
	OrganizationID      string
	OrganizationDisplay string
	Actor               Principal
}

// OrganizationMemberAuditTemplateInput records membership changes with stable
// member ids and optional normalized role labels.
type OrganizationMemberAuditTemplateInput struct {
	AuditTemplateCommonInput
	OrganizationID string
	MemberID       string
	Actor          Principal
	Role           any
}

// OrganizationInvitationAuditTemplateInput records invitations by stable invite
// id instead of raw invitee email metadata.
type OrganizationInvitationAuditTemplateInput struct {
	AuditTemplateCommonInput
	OrganizationID string
	InvitationID   string
	Inviter        Principal
	Role           any
}

// ConsentAuditTemplateInput records consent lifecycle evidence using stable
// consent, subject, purpose, and data-category ids.
type ConsentAuditTemplateInput struct {
	AuditTemplateCommonInput
	Actor     Principal
	ConsentID string
	SubjectID string
	PurposeID string
}

// SubjectRequestAuditTemplateInput records data-subject workflow creation as
// evidence support, not a legal completion claim.
type SubjectRequestAuditTemplateInput struct {
	AuditTemplateCommonInput
	Actor            Principal
	SubjectRequestID string
	RequestType      string
	SubjectID        string
}

// ExportBundleAuditTemplateInput records export bundle creation by stable id
// and optional format, not by copying export contents.
type ExportBundleAuditTemplateInput struct {
	AuditTemplateCommonInput
	Actor          Principal
	ExportBundleID string
	Format         string
}

// RetentionPolicyAuditTemplateInput records retention-policy application with
// optional stable resource ids selected by the host.
type RetentionPolicyAuditTemplateInput struct {
	AuditTemplateCommonInput
	Actor      Principal
	PolicyID   string
	ResourceID string
}

// AgentSessionAuditTemplateInput records the start of an AI agent session using
// metadata.sessionId for grouping with downstream code evidence.
type AgentSessionAuditTemplateInput struct {
	AuditTemplateCommonInput
	SessionID   string
	AgentActor  Principal
	InitiatedBy *Principal
	Agent       map[string]any
	Model       map[string]any
}

// AgentPromptAuditTemplateInput records prompt evidence by prompt hash only so
// raw prompt text stays outside audit metadata.
type AgentPromptAuditTemplateInput struct {
	AuditTemplateCommonInput
	SessionID  string
	PromptID   string
	PromptHash string
	AgentActor Principal
}

// AgentToolAuditTemplateInput records tool-call evidence with optional input
// hashes and latency, never raw arguments or command output.
type AgentToolAuditTemplateInput struct {
	AuditTemplateCommonInput
	SessionID  string
	ToolCallID string
	Tool       string
	Status     string
	AgentActor Principal
	InputHash  string
	LatencyMs  *float64
}

// ChangeProposalAuditTemplateInput records proposed code/config changes by
// proposal, repository, branch, and session ids rather than raw diffs.
type ChangeProposalAuditTemplateInput struct {
	AuditTemplateCommonInput
	ProposalID   string
	Actor        Principal
	SessionID    string
	RepositoryID string
	Branch       string
}

// FilesChangedAuditTemplateInput records file-change evidence from source tree
// ids and path hashes rather than raw file paths or hunks.
type FilesChangedAuditTemplateInput struct {
	AuditTemplateCommonInput
	SourceTreeID   string
	Actor          Principal
	SessionID      string
	FileCount      *int
	FilePathHashes []string
	ChangedByID    string
}

// ReviewAuditTemplateInput records review lifecycle events with bounded counts
// and stable ids rather than raw review text.
type ReviewAuditTemplateInput struct {
	AuditTemplateCommonInput
	PullRequestID string
	Reviewer      Principal
	SessionID     string
	ProposalID    string
	FindingCount  *int
	WaiverCount   *int
}

// CiJobAuditTemplateInput records CI completion with status, session, and
// artifact ids while keeping logs and environment values outside metadata.
type CiJobAuditTemplateInput struct {
	AuditTemplateCommonInput
	CiRunID    string
	Service    Principal
	Status     string
	SessionID  string
	ArtifactID string
}

// DeploymentAuditTemplateInput records deployment evidence using stable
// deployment, artifact, policy, and session ids.
type DeploymentAuditTemplateInput struct {
	AuditTemplateCommonInput
	DeploymentID string
	Service      Principal
	SessionID    string
	ArtifactID   string
	PolicyID     string
}

// RuntimeObservedAuditTemplateInput records runtime observation evidence using
// aggregate outcomes or stable ids, not raw request/response payloads.
type RuntimeObservedAuditTemplateInput struct {
	AuditTemplateCommonInput
	RuntimeEventID  string
	Actor           Principal
	SessionID       string
	DeploymentID    string
	ObservedOutcome string
}

// AuthUserCreatedTemplate builds an account creation audit input without making
// callers memorize the canonical auth action string.
func AuthUserCreatedTemplate(input UserAuditTemplateInput) (AuditEventInput, error) {
	actor := templatePrincipal("user", input.UserID, input.UserDisplay)
	if input.Actor != nil {
		actor = *input.Actor
	}
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:       actor,
		Action:      "auth.user.created",
		Target:      templateResource("user", input.UserID, input.UserDisplay),
		Purpose:     "access_management",
		LawfulBasis: "contract",
		Retention:   "security_1y",
	}, false)
}

// AuthSessionCreatedTemplate builds a sign-in/session-created audit input with
// optional hashed or coarse session security context.
func AuthSessionCreatedTemplate(input SessionAuditTemplateInput) (AuditEventInput, error) {
	actor := templatePrincipal("user", input.UserID, input.UserDisplay)
	if input.Actor != nil {
		actor = *input.Actor
	}
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:       actor,
		Action:      "auth.session.created",
		Target:      templateResource("session", input.SessionID, ""),
		Purpose:     "access_management",
		LawfulBasis: "contract",
		Retention:   "security_1y",
		Metadata: compactMetadata(map[string]any{
			"securityContext": compactSessionSecurityContext(input.SecurityContext),
		}),
	}, false)
}

// AuthSessionRevokedTemplate builds a logout/session-revocation audit input
// using the stable session id as target.
func AuthSessionRevokedTemplate(input SessionAuditTemplateInput) (AuditEventInput, error) {
	actor := templatePrincipal("user", input.UserID, input.UserDisplay)
	if input.Actor != nil {
		actor = *input.Actor
	}
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:       actor,
		Action:      "auth.session.revoked",
		Target:      templateResource("session", input.SessionID, ""),
		Purpose:     "access_management",
		LawfulBasis: "contract",
		Retention:   "security_1y",
		Metadata: compactMetadata(map[string]any{
			"securityContext": compactSessionSecurityContext(input.SecurityContext),
		}),
	}, false)
}

// AuthPasswordResetRequestedTemplate builds a password reset request audit input
// while keeping reset tokens outside metadata.
func AuthPasswordResetRequestedTemplate(input PasswordResetAuditTemplateInput) (AuditEventInput, error) {
	actor := templatePrincipal("user", input.UserID, input.UserDisplay)
	if input.Actor != nil {
		actor = *input.Actor
	}
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:       actor,
		Action:      "auth.password.reset.requested",
		Target:      templateResource("password_reset_request", input.ResetRequestID, ""),
		Purpose:     "access_management",
		LawfulBasis: "contract",
		Retention:   "security_1y",
	}, false)
}

// OrganizationCreatedTemplate builds an organization-created audit input and
// defaults tenant scope to the organization id when omitted.
func OrganizationCreatedTemplate(input OrganizationAuditTemplateInput) (AuditEventInput, error) {
	common := input.AuditTemplateCommonInput
	if common.Scope == nil {
		common.Scope = &EvidenceScope{TenantID: input.OrganizationID}
	}
	return buildTemplate(common, AuditEventInput{
		Actor:       input.Actor,
		Action:      "org.created",
		Target:      templateResource("organization", input.OrganizationID, input.OrganizationDisplay),
		Purpose:     "access_management",
		LawfulBasis: "contract",
		Retention:   "security_1y",
	}, false)
}

// OrganizationMemberInvitedTemplate builds an invitation audit input without
// storing invitee raw email by default.
func OrganizationMemberInvitedTemplate(input OrganizationInvitationAuditTemplateInput) (AuditEventInput, error) {
	common := input.AuditTemplateCommonInput
	if common.Scope == nil {
		common.Scope = &EvidenceScope{TenantID: input.OrganizationID}
	}
	return buildTemplate(common, AuditEventInput{
		Actor:       input.Inviter,
		Action:      "org.member.invited",
		Target:      templateResource("organization_invitation", input.InvitationID, ""),
		Purpose:     "access_management",
		LawfulBasis: "contract",
		Retention:   "security_1y",
		Metadata:    roleMetadata(input.Role),
	}, false)
}

// OrganizationMemberJoinedTemplate builds a member joined audit input with role
// metadata normalized before core event hashing.
func OrganizationMemberJoinedTemplate(input OrganizationMemberAuditTemplateInput) (AuditEventInput, error) {
	return organizationMemberTemplate(input, "org.member.joined")
}

// OrganizationMemberRemovedTemplate builds a member removed audit input scoped
// to the organization tenant by default.
func OrganizationMemberRemovedTemplate(input OrganizationMemberAuditTemplateInput) (AuditEventInput, error) {
	return organizationMemberTemplate(input, "org.member.removed")
}

// OrganizationMemberRoleChangedTemplate builds a role-change audit input without
// making host role labels protocol semantics.
func OrganizationMemberRoleChangedTemplate(input OrganizationMemberAuditTemplateInput) (AuditEventInput, error) {
	return organizationMemberTemplate(input, "org.member.role.changed")
}

// ConsentGrantedTemplate builds a consent-granted audit input for consent
// history timelines grouped by stable consent id.
func ConsentGrantedTemplate(input ConsentAuditTemplateInput) (AuditEventInput, error) {
	return consentTemplate(input, "consent.granted")
}

// ConsentRevokedTemplate builds a consent-revoked audit input grouped with the
// original consent id.
func ConsentRevokedTemplate(input ConsentAuditTemplateInput) (AuditEventInput, error) {
	return consentTemplate(input, "consent.revoked")
}

// DataSubjectRequestCreatedTemplate builds a workflow entry audit input and
// does not assert any regulatory completion state.
func DataSubjectRequestCreatedTemplate(input SubjectRequestAuditTemplateInput) (AuditEventInput, error) {
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:       input.Actor,
		Action:      "data.subject.request.created",
		Target:      templateResource("subject_request", input.SubjectRequestID, ""),
		Purpose:     "data_subject_workflow",
		LawfulBasis: "legal_obligation",
		Retention:   "subject_request_3y",
		Metadata: compactMetadata(map[string]any{
			"requestType": input.RequestType,
			"subjectId":   input.SubjectID,
		}),
	}, false)
}

// ExportBundleCreatedTemplate builds an export bundle audit input that
// references export contents through ids or hashes.
func ExportBundleCreatedTemplate(input ExportBundleAuditTemplateInput) (AuditEventInput, error) {
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:       input.Actor,
		Action:      "export.bundle.created",
		Target:      templateResource("export_bundle", input.ExportBundleID, ""),
		Purpose:     "data_subject_workflow",
		LawfulBasis: "legal_obligation",
		Retention:   "export_1y",
		Metadata:    compactMetadata(map[string]any{"format": input.Format}),
	}, false)
}

// RetentionPolicyAppliedTemplate builds a retention policy audit input with
// optional stable resource metadata selected by the host.
func RetentionPolicyAppliedTemplate(input RetentionPolicyAuditTemplateInput) (AuditEventInput, error) {
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:       input.Actor,
		Action:      "retention.policy.applied",
		Target:      templateResource("policy", input.PolicyID, ""),
		Purpose:     "retention_management",
		LawfulBasis: "legal_obligation",
		Retention:   "retention_audit_7y",
		Metadata:    compactMetadata(map[string]any{"resourceId": input.ResourceID}),
	}, false)
}

// AgentSessionStartedTemplate builds an agent session audit input and stamps
// metadata.sessionId after caller metadata for stable grouping.
func AgentSessionStartedTemplate(input AgentSessionAuditTemplateInput) (AuditEventInput, error) {
	metadata := map[string]any{
		"sessionId": input.SessionID,
		"agent":     input.Agent,
		"model":     input.Model,
	}
	if input.InitiatedBy != nil {
		metadata["initiatedBy"] = map[string]any{"type": input.InitiatedBy.Type, "id": input.InitiatedBy.ID}
	}
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:     input.AgentActor,
		Action:    "agent.session.started",
		Target:    templateResource("agent_session", input.SessionID, ""),
		Purpose:   "change_provenance",
		Retention: "security_1y",
		Metadata:  compactMetadata(metadata),
	}, true)
}

// AgentPromptRecordedTemplate builds prompt evidence with a prompt hash rather
// than raw prompt text.
func AgentPromptRecordedTemplate(input AgentPromptAuditTemplateInput) (AuditEventInput, error) {
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:     input.AgentActor,
		Action:    "agent.prompt.recorded",
		Target:    templateResource("agent_session", input.SessionID, ""),
		Purpose:   "change_provenance",
		Retention: "security_1y",
		Metadata: compactMetadata(map[string]any{
			"sessionId":  input.SessionID,
			"promptId":   input.PromptID,
			"promptHash": input.PromptHash,
		}),
	}, true)
}

// AgentToolCalledTemplate builds tool-call evidence with stable ids, status,
// optional input hash, and latency instead of raw arguments or output.
func AgentToolCalledTemplate(input AgentToolAuditTemplateInput) (AuditEventInput, error) {
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:     input.AgentActor,
		Action:    "agent.tool.called",
		Target:    templateResource("tool_call", input.ToolCallID, ""),
		Purpose:   "change_provenance",
		Retention: "security_1y",
		Metadata: compactMetadata(map[string]any{
			"sessionId": input.SessionID,
			"tool":      input.Tool,
			"status":    input.Status,
			"inputHash": input.InputHash,
			"latencyMs": input.LatencyMs,
		}),
	}, true)
}

// ChangeProposalCreatedTemplate builds proposal evidence from stable ids and
// branch labels, not raw patches.
func ChangeProposalCreatedTemplate(input ChangeProposalAuditTemplateInput) (AuditEventInput, error) {
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:     input.Actor,
		Action:    "change.proposal.created",
		Target:    templateResource("change_proposal", input.ProposalID, ""),
		Purpose:   "change_provenance",
		Retention: "security_1y",
		Metadata: compactMetadata(map[string]any{
			"sessionId":    input.SessionID,
			"repositoryId": input.RepositoryID,
			"branch":       input.Branch,
		}),
	}, true)
}

// FilesChangedTemplate builds files-changed evidence from source tree ids and
// path hashes instead of raw file paths or hunks.
func FilesChangedTemplate(input FilesChangedAuditTemplateInput) (AuditEventInput, error) {
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:     input.Actor,
		Action:    "change.files.changed",
		Target:    templateResource("source_tree", input.SourceTreeID, ""),
		Purpose:   "change_provenance",
		Retention: "security_1y",
		Metadata: compactMetadata(map[string]any{
			"sessionId":      input.SessionID,
			"fileCount":      input.FileCount,
			"filePathHashes": input.FilePathHashes,
			"changedById":    input.ChangedByID,
		}),
	}, true)
}

// ReviewApprovalRecordedTemplate builds review approval evidence with bounded
// counts and ids rather than raw review content.
func ReviewApprovalRecordedTemplate(input ReviewAuditTemplateInput) (AuditEventInput, error) {
	return reviewTemplate(input, "review.approval.recorded")
}

// ReviewFindingCreatedTemplate builds review finding evidence without storing
// raw review text by default.
func ReviewFindingCreatedTemplate(input ReviewAuditTemplateInput) (AuditEventInput, error) {
	return reviewTemplate(input, "review.finding.created")
}

// ReviewWaiverRecordedTemplate builds review waiver evidence while keeping
// waiver rationale outside metadata unless represented by ids or hashes.
func ReviewWaiverRecordedTemplate(input ReviewAuditTemplateInput) (AuditEventInput, error) {
	return reviewTemplate(input, "review.waiver.recorded")
}

// CiJobCompletedTemplate builds CI completion evidence with status and stable
// session/artifact ids, not provider logs.
func CiJobCompletedTemplate(input CiJobAuditTemplateInput) (AuditEventInput, error) {
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:     input.Service,
		Action:    "ci.job.completed",
		Target:    templateResource("ci_run", input.CiRunID, ""),
		Purpose:   "change_provenance",
		Retention: "security_1y",
		Metadata: compactMetadata(map[string]any{
			"sessionId":  input.SessionID,
			"status":     input.Status,
			"artifactId": input.ArtifactID,
		}),
	}, true)
}

// DeploymentCreatedTemplate builds deployment evidence from deployment,
// artifact, policy, and session ids.
func DeploymentCreatedTemplate(input DeploymentAuditTemplateInput) (AuditEventInput, error) {
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:     input.Service,
		Action:    "deploy.deployed",
		Target:    templateResource("deployment", input.DeploymentID, ""),
		Purpose:   "change_provenance",
		Retention: "security_1y",
		Metadata: compactMetadata(map[string]any{
			"sessionId":  input.SessionID,
			"artifactId": input.ArtifactID,
			"policyId":   input.PolicyID,
		}),
	}, true)
}

// RuntimeObservedTemplate builds runtime observation evidence using aggregate
// outcomes or stable ids, not raw request/response data.
func RuntimeObservedTemplate(input RuntimeObservedAuditTemplateInput) (AuditEventInput, error) {
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:     input.Actor,
		Action:    "audit.runtime.observed",
		Target:    templateResource("runtime_event", input.RuntimeEventID, ""),
		Purpose:   "runtime_observation",
		Retention: "security_1y",
		Metadata: compactMetadata(map[string]any{
			"sessionId":       input.SessionID,
			"deploymentId":    input.DeploymentID,
			"observedOutcome": input.ObservedOutcome,
		}),
	}, true)
}

// buildTemplate merges caller-owned public AuditEventInput fields with template
// defaults, with template metadata taking precedence for reserved ids.
func buildTemplate(common AuditTemplateCommonInput, template AuditEventInput, blockRawContent bool) (AuditEventInput, error) {
	if blockRawContent {
		if err := assertMetadataDoesNotContainRawContent(common.Metadata); err != nil {
			return AuditEventInput{}, err
		}
	}
	event := AuditEventInput{
		Actor:    template.Actor,
		Action:   template.Action,
		Target:   template.Target,
		Metadata: mergeTemplateMetadata(common.Metadata, template.Metadata),
	}
	// Stamp normalized risk signals and the activity-episode id AFTER caller and
	// template metadata so a caller can never shadow normalized riskSignals or the
	// reserved activityEpisodeId join key.
	if common.RiskSignals != nil {
		normalized, err := NormalizeRiskSignals(*common.RiskSignals)
		if err != nil {
			return AuditEventInput{}, err
		}
		event.Metadata["riskSignals"] = riskSignalsMap(normalized)
	}
	if common.ActivityEpisodeID != "" {
		event.Metadata["activityEpisodeId"] = common.ActivityEpisodeID
	}
	if common.ID != "" {
		event.ID = common.ID
	}
	if common.OccurredAt != "" {
		event.OccurredAt = common.OccurredAt
	}
	if common.Scope != nil {
		event.Scope = common.Scope
	}
	if common.RequestID != "" {
		event.RequestID = common.RequestID
	}
	event.Purpose = firstNonEmpty(common.Purpose, template.Purpose)
	event.LawfulBasis = firstNonEmpty(common.LawfulBasis, template.LawfulBasis)
	if common.DataCategories != nil {
		event.DataCategories = common.DataCategories
	} else {
		event.DataCategories = template.DataCategories
	}
	event.Retention = firstNonEmpty(common.Retention, template.Retention)
	return event, nil
}

// organizationMemberTemplate builds membership lifecycle events with tenant
// scope derived from organization id when the caller omits scope.
func organizationMemberTemplate(input OrganizationMemberAuditTemplateInput, action string) (AuditEventInput, error) {
	common := input.AuditTemplateCommonInput
	if common.Scope == nil {
		common.Scope = &EvidenceScope{TenantID: input.OrganizationID}
	}
	return buildTemplate(common, AuditEventInput{
		Actor:       input.Actor,
		Action:      action,
		Target:      templateResource("organization_member", input.MemberID, ""),
		Purpose:     "access_management",
		LawfulBasis: "contract",
		Retention:   "security_1y",
		Metadata:    roleMetadata(input.Role),
	}, false)
}

// consentTemplate builds consent lifecycle events with stable subject/purpose
// ids while leaving legal interpretation to the host.
func consentTemplate(input ConsentAuditTemplateInput, action string) (AuditEventInput, error) {
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:          input.Actor,
		Action:         action,
		Target:         templateResource("consent", input.ConsentID, ""),
		Purpose:        "consent_management",
		LawfulBasis:    "consent",
		DataCategories: input.DataCategories,
		Retention:      "consent_7y",
		Metadata: compactMetadata(map[string]any{
			"subjectId": input.SubjectID,
			"purposeId": input.PurposeID,
		}),
	}, false)
}

// reviewTemplate builds review lifecycle events with bounded counts and stable
// ids while preserving metadata.sessionId for agent/code grouping.
func reviewTemplate(input ReviewAuditTemplateInput, action string) (AuditEventInput, error) {
	return buildTemplate(input.AuditTemplateCommonInput, AuditEventInput{
		Actor:     input.Reviewer,
		Action:    action,
		Target:    templateResource("pull_request", input.PullRequestID, ""),
		Purpose:   "change_provenance",
		Retention: "security_1y",
		Metadata: compactMetadata(map[string]any{
			"sessionId":    input.SessionID,
			"proposalId":   input.ProposalID,
			"findingCount": input.FindingCount,
			"waiverCount":  input.WaiverCount,
		}),
	}, true)
}

// templatePrincipal constructs a protocol principal and omits display unless
// the host intentionally provides a non-sensitive label.
func templatePrincipal(actorType string, id string, display string) Principal {
	if display == "" {
		return Principal{Type: actorType, ID: id}
	}
	return Principal{Type: actorType, ID: id, Display: display}
}

// templateResource constructs a protocol resource and omits display unless the
// host intentionally provides a non-sensitive label.
func templateResource(resourceType string, id string, display string) Resource {
	if display == "" {
		return Resource{Type: resourceType, ID: id}
	}
	return Resource{Type: resourceType, ID: id, Display: display}
}

// roleMetadata normalizes role strings and role slices so template output stays
// deterministic before core redaction and hashing.
func roleMetadata(role any) map[string]any {
	switch typed := role.(type) {
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		return map[string]any{"role": typed}
	case []string:
		values := make([]string, 0, len(typed))
		seen := map[string]struct{}{}
		for _, item := range typed {
			if strings.TrimSpace(item) == "" {
				continue
			}
			if _, ok := seen[item]; ok {
				continue
			}
			seen[item] = struct{}{}
			values = append(values, item)
		}
		sort.Strings(values)
		if len(values) == 0 {
			return nil
		}
		return map[string]any{"role": values}
	default:
		return nil
	}
}

// compactSessionSecurityContext keeps auth context to hashed or coarse values
// and omits empty nested fields.
func compactSessionSecurityContext(input *SessionSecurityContext) map[string]any {
	if input == nil {
		return nil
	}
	var location map[string]any
	if input.Location != nil {
		location = compactMetadata(map[string]any{
			"country": input.Location.Country,
			"region":  input.Location.Region,
		})
	}
	return compactMetadata(map[string]any{
		"ipAddressHash": input.IPAddressHash,
		"networkHash":   input.NetworkHash,
		"userAgentHash": input.UserAgentHash,
		"deviceId":      input.DeviceID,
		"location":      location,
		"method":        input.Method,
		"provider":      input.Provider,
	})
}

// compactMetadata removes nil and empty optional values without mutating
// caller-owned metadata maps.
func compactMetadata(input map[string]any) map[string]any {
	output := map[string]any{}
	for key, value := range input {
		normalized, ok := normalizeTemplateMetadataValue(value)
		if !ok {
			continue
		}
		output[key] = normalized
	}
	if len(output) == 0 {
		return nil
	}
	return output
}

// mergeTemplateMetadata gives template-reserved metadata such as sessionId final
// say over caller-provided metadata.
func mergeTemplateMetadata(caller map[string]any, template map[string]any) map[string]any {
	output := map[string]any{}
	for key, value := range caller {
		output[key] = value
	}
	for key, value := range template {
		output[key] = value
	}
	return output
}

// firstNormalizedClassifier returns the first recognized classifier candidate,
// skipping unknown aliases without widening filters.
func firstNormalizedClassifier(values []any, normalize func(any) string) string {
	for _, value := range values {
		if normalized := normalize(value); normalized != "" {
			return normalized
		}
	}
	return ""
}

// metadataObject narrows nested metadata values before reading classifier
// aliases from common host metadata shapes.
func metadataObject(value any) map[string]any {
	typed, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return typed
}

// normalizeClassifierLabel ignores case and separators in host-supplied
// classifier labels.
func normalizeClassifierLabel(value string) string {
	return rawContentKeyNormalizer.ReplaceAllString(strings.ToLower(strings.TrimSpace(value)), "")
}

// normalizeTemplateMetadataValue identifies absent optional fields while
// dereferencing numeric pointers before they reach core metadata redaction.
func normalizeTemplateMetadataValue(value any) (any, bool) {
	switch typed := value.(type) {
	case nil:
		return nil, false
	case string:
		if typed == "" {
			return nil, false
		}
		return typed, true
	case []string:
		if len(typed) == 0 {
			return nil, false
		}
		out := make([]any, len(typed))
		for index, item := range typed {
			out[index] = item
		}
		return out, true
	case map[string]any:
		if len(typed) == 0 {
			return nil, false
		}
		return typed, true
	case *int:
		if typed == nil {
			return nil, false
		}
		return *typed, true
	case *float64:
		if typed == nil {
			return nil, false
		}
		return *typed, true
	default:
		return value, true
	}
}

// assertMetadataDoesNotContainRawContent rejects raw prompt, diff, path, log,
// tool-argument, or credential-shaped caller metadata for agent/code templates.
func assertMetadataDoesNotContainRawContent(metadata map[string]any) error {
	for key, value := range metadata {
		if err := assertMetadataValueDoesNotContainRawContent(key, value, "metadata."+key); err != nil {
			return err
		}
	}
	return nil
}

// assertMetadataValueDoesNotContainRawContent recursively scans nested metadata
// so raw-content keys cannot bypass minimization through objects or arrays.
func assertMetadataValueDoesNotContainRawContent(key string, value any, path string) error {
	if isRawContentMetadataKey(key) {
		return errors.New(path + " is not allowed in agent/code audit template metadata")
	}
	if typed, ok := value.(string); ok && looksLikeRawContentValue(typed) {
		return errors.New(path + " looks like raw content or credential material")
	}
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			if err := assertMetadataValueDoesNotContainRawContent(key, item, path+"[]"); err != nil {
				return err
			}
		}
	case []string:
		for _, item := range typed {
			if err := assertMetadataValueDoesNotContainRawContent(key, item, path+"[]"); err != nil {
				return err
			}
		}
	case map[string]any:
		for nestedKey, nestedValue := range typed {
			if err := assertMetadataValueDoesNotContainRawContent(nestedKey, nestedValue, path+"."+nestedKey); err != nil {
				return err
			}
		}
	}
	return nil
}

// isRawContentMetadataKey blocks key names that usually denote raw code, prompt,
// log, path, tool argument, or credential material, while allowing ids/hashes.
func isRawContentMetadataKey(key string) bool {
	normalized := rawContentKeyNormalizer.ReplaceAllString(strings.ToLower(key), "")
	for _, suffix := range []string{"hash", "hashes", "id", "ids", "count", "status"} {
		if strings.HasSuffix(normalized, suffix) {
			return false
		}
	}
	for _, blocked := range []string{
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
	} {
		if normalized == blocked || strings.HasSuffix(normalized, blocked) {
			return true
		}
	}
	return false
}

// looksLikeRawContentValue catches common raw patch and bearer-token shapes even
// when callers use otherwise innocuous metadata keys.
func looksLikeRawContentValue(value string) bool {
	return rawDiffValuePattern.MatchString(value) ||
		rawHunkValuePattern.MatchString(value) ||
		bearerTokenValuePattern.MatchString(value)
}

// firstNonEmpty selects caller overrides when present without treating empty
// strings as intentional protocol values.
func firstNonEmpty(first string, second string) string {
	if first != "" {
		return first
	}
	return second
}

var rawContentKeyNormalizer = regexp.MustCompile(`[^a-z0-9]`)
var rawDiffValuePattern = regexp.MustCompile(`(?m)^diff --git `)
var rawHunkValuePattern = regexp.MustCompile(`@@ -\d+(,\d+)? \+\d+(,\d+)? @@`)
var bearerTokenValuePattern = regexp.MustCompile(`(?i)Bearer\s+[A-Za-z0-9._-]+`)

var auditLogVisibilityAliases = map[string]string{
	"internal":   "internal",
	"private":    "internal",
	"staff":      "internal",
	"employee":   "internal",
	"admin":      "internal",
	"ops":        "internal",
	"backoffice": "internal",
	"firstparty": "internal",
	"external":   "external",
	"public":     "external",
	"customer":   "external",
	"user":       "external",
	"userfacing": "external",
	"enduser":    "external",
	"partner":    "partner",
	"vendor":     "partner",
	"thirdparty": "partner",
	"system":     "system",
	"service":    "system",
	"automation": "system",
	"machine":    "system",
}

var auditLogSurfaceAliases = map[string]string{
	"api":         "api",
	"rest":        "api",
	"graphql":     "api",
	"http":        "api",
	"https":       "api",
	"rpc":         "api",
	"trpc":        "api",
	"app":         "app",
	"application": "app",
	"ui":          "app",
	"web":         "app",
	"browser":     "app",
	"dashboard":   "app",
	"frontend":    "app",
	"worker":      "worker",
	"job":         "worker",
	"cron":        "worker",
	"queue":       "worker",
	"background":  "worker",
	"scheduled":   "worker",
	"cli":         "cli",
	"terminal":    "cli",
	"commandline": "cli",
	"command":     "cli",
	"webhook":     "webhook",
	"hook":        "webhook",
	"callback":    "webhook",
}

// EpisodeStartedAuditTemplateInput records the opening of an activity episode so
// downstream change/review/ci/deploy/runtime/risk events can be threaded to it.
type EpisodeStartedAuditTemplateInput struct {
	AuditTemplateCommonInput
	ActivityEpisodeID string
	Actor             Principal
	AuthSessionID     string
	AuthContextID     string
	Domain            string
	StartReason       string
}

// EpisodeStartedTemplate builds an activity.episode.started audit input. The
// episode id is stamped un-shadowably at metadata.activityEpisodeId (via the
// shared template builder) and as the event target so every later event in the
// episode joins on the same key. This adds no new core protocol field: the action
// pattern and open metadata already accept it.
func EpisodeStartedTemplate(input EpisodeStartedAuditTemplateInput) (AuditEventInput, error) {
	common := input.AuditTemplateCommonInput
	common.ActivityEpisodeID = input.ActivityEpisodeID
	return buildTemplate(common, AuditEventInput{
		Actor:     input.Actor,
		Action:    "activity.episode.started",
		Target:    templateResource("activity_episode", input.ActivityEpisodeID, ""),
		Purpose:   "change_provenance",
		Retention: "security_1y",
		Metadata: compactMetadata(map[string]any{
			"authSessionId": input.AuthSessionID,
			"authContextId": input.AuthContextID,
			"domain":        input.Domain,
			"startReason":   input.StartReason,
		}),
	}, true)
}

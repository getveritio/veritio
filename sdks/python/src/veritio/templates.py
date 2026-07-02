from __future__ import annotations

import re
from typing import Any

from .risk import with_risk_signals

audit_template_sets = {
    "auth": [
        "auth.user.created",
        "auth.session.created",
        "auth.session.revoked",
        "auth.password.reset.requested",
    ],
    "organization": [
        "org.created",
        "org.member.invited",
        "org.member.joined",
        "org.member.removed",
        "org.member.role.changed",
    ],
    "data": [
        "consent.granted",
        "consent.revoked",
        "data.subject.request.created",
        "export.bundle.created",
        "retention.policy.applied",
    ],
    "agent": ["agent.session.started", "agent.prompt.recorded", "agent.tool.called"],
    "code": [
        "change.proposal.created",
        "change.files.changed",
        "review.approval.recorded",
        "review.finding.created",
        "review.waiver.recorded",
        "ci.job.completed",
        "deploy.deployed",
        "audit.runtime.observed",
    ],
}

audit_log_visibility_values = ["internal", "external", "partner", "system"]
audit_log_surface_values = ["api", "app", "worker", "cli", "webhook"]


def audit_log_classification_metadata(
    *,
    visibility: str | None = None,
    surface: str | None = None,
) -> dict[str, str]:
    """Build normalized metadata for filtering audit streams without changing protocol fields."""
    metadata: dict[str, str] = {}
    normalized_visibility = normalize_audit_log_visibility(visibility)
    normalized_surface = normalize_audit_log_surface(surface)
    if normalized_visibility is not None:
        metadata["logVisibility"] = normalized_visibility
    if normalized_surface is not None:
        metadata["logSurface"] = normalized_surface
    return metadata


def detect_audit_log_classifiers(metadata: dict[str, Any] | None) -> dict[str, str]:
    """Detect visibility/surface classifiers from SDK metadata and common host aliases."""
    if metadata is None:
        return {}
    audit_log = _metadata_object(metadata.get("auditLog"))
    audit = _metadata_object(metadata.get("audit"))
    client = _metadata_object(metadata.get("client"))
    request = _metadata_object(metadata.get("request"))
    visibility = _first_normalized(
        [
            metadata.get("logVisibility"),
            metadata.get("visibility"),
            metadata.get("audience"),
            metadata.get("exposure"),
            audit_log.get("visibility") if audit_log else None,
            audit_log.get("audience") if audit_log else None,
            audit.get("visibility") if audit else None,
            request.get("visibility") if request else None,
        ],
        normalize_audit_log_visibility,
    )
    surface = _first_normalized(
        [
            metadata.get("logSurface"),
            metadata.get("surface"),
            metadata.get("channel"),
            audit_log.get("surface") if audit_log else None,
            audit_log.get("channel") if audit_log else None,
            audit.get("surface") if audit else None,
            request.get("surface") if request else None,
            client.get("surface") if client else None,
            client.get("type") if client else None,
        ],
        normalize_audit_log_surface,
    )
    result: dict[str, str] = {}
    if visibility is not None:
        result["visibility"] = visibility
    if surface is not None:
        result["surface"] = surface
    return result


def normalize_audit_log_visibility(value: Any) -> str | None:
    """Canonicalize log visibility labels used by overview and audit filters."""
    if not isinstance(value, str):
        return None
    return _AUDIT_LOG_VISIBILITY_ALIASES.get(_normalize_classifier_label(value))


def normalize_audit_log_surface(value: Any) -> str | None:
    """Canonicalize log surface labels used by overview and audit filters."""
    if not isinstance(value, str):
        return None
    return _AUDIT_LOG_SURFACE_ALIASES.get(_normalize_classifier_label(value))


def auth_user_created_template(
    *,
    user_id: str,
    user_display: str | None = None,
    actor: dict[str, Any] | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build an account creation audit input without requiring the caller to know the auth action string."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": actor or _principal("user", user_id, user_display),
            "action": "auth.user.created",
            "target": _resource("user", user_id, user_display),
            "purpose": "access_management",
            "lawfulBasis": "contract",
            "retention": "security_1y",
        },
    )


def auth_session_created_template(
    *,
    user_id: str,
    session_id: str,
    user_display: str | None = None,
    actor: dict[str, Any] | None = None,
    security_context: dict[str, Any] | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a sign-in/session-created audit input with optional host-chosen security context metadata."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": actor or _principal("user", user_id, user_display),
            "action": "auth.session.created",
            "target": _resource("session", session_id),
            "purpose": "access_management",
            "lawfulBasis": "contract",
            "retention": "security_1y",
            "metadata": _compact_metadata({"securityContext": _compact_session_security_context(security_context)}),
        },
    )


def auth_session_revoked_template(
    *,
    user_id: str,
    session_id: str,
    user_display: str | None = None,
    actor: dict[str, Any] | None = None,
    security_context: dict[str, Any] | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a logout/session-revocation audit input that targets the stable session id."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": actor or _principal("user", user_id, user_display),
            "action": "auth.session.revoked",
            "target": _resource("session", session_id),
            "purpose": "access_management",
            "lawfulBasis": "contract",
            "retention": "security_1y",
            "metadata": _compact_metadata({"securityContext": _compact_session_security_context(security_context)}),
        },
    )


def auth_password_reset_requested_template(
    *,
    user_id: str,
    reset_request_id: str,
    user_display: str | None = None,
    actor: dict[str, Any] | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a password reset request audit input without encouraging storage of reset tokens."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": actor or _principal("user", user_id, user_display),
            "action": "auth.password.reset.requested",
            "target": _resource("password_reset_request", reset_request_id),
            "purpose": "access_management",
            "lawfulBasis": "contract",
            "retention": "security_1y",
        },
    )


def organization_created_template(
    *,
    organization_id: str,
    actor: dict[str, Any],
    organization_display: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build an organization-created audit input and default tenant scope to the new organization id."""
    return _build_template(
        _common_options(
            event_id,
            occurred_at,
            scope or {"tenantId": organization_id},
            request_id,
            purpose,
            lawful_basis,
            data_categories,
            retention,
            metadata,
            activity_episode_id,
            risk_signals,
        ),
        {
            "actor": actor,
            "action": "org.created",
            "target": _resource("organization", organization_id, organization_display),
            "purpose": "access_management",
            "lawfulBasis": "contract",
            "retention": "security_1y",
        },
    )


def organization_member_invited_template(
    *,
    organization_id: str,
    invitation_id: str,
    inviter: dict[str, Any],
    role: str | list[str] | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build an organization invitation audit input that keeps invitee email outside default metadata."""
    return _build_template(
        _common_options(
            event_id,
            occurred_at,
            scope or {"tenantId": organization_id},
            request_id,
            purpose,
            lawful_basis,
            data_categories,
            retention,
            metadata,
            activity_episode_id,
            risk_signals,
        ),
        {
            "actor": inviter,
            "action": "org.member.invited",
            "target": _resource("organization_invitation", invitation_id),
            "purpose": "access_management",
            "lawfulBasis": "contract",
            "retention": "security_1y",
            "metadata": _role_metadata(role),
        },
    )


def organization_member_joined_template(
    *,
    organization_id: str,
    member_id: str,
    actor: dict[str, Any],
    role: str | list[str] | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build an organization member joined audit input with normalized role metadata."""
    return _organization_member_template(
        "org.member.joined",
        organization_id,
        member_id,
        actor,
        role,
        event_id,
        occurred_at,
        scope,
        request_id,
        purpose,
        lawful_basis,
        data_categories,
        retention,
        metadata,
        activity_episode_id,
        risk_signals,
    )


def organization_member_removed_template(
    *,
    organization_id: str,
    member_id: str,
    actor: dict[str, Any],
    role: str | list[str] | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build an organization member removed audit input scoped to the organization tenant by default."""
    return _organization_member_template(
        "org.member.removed",
        organization_id,
        member_id,
        actor,
        role,
        event_id,
        occurred_at,
        scope,
        request_id,
        purpose,
        lawful_basis,
        data_categories,
        retention,
        metadata,
        activity_episode_id,
        risk_signals,
    )


def organization_member_role_changed_template(
    *,
    organization_id: str,
    member_id: str,
    actor: dict[str, Any],
    role: str | list[str] | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build an organization role-change audit input without assuming role labels are protocol semantics."""
    return _organization_member_template(
        "org.member.role.changed",
        organization_id,
        member_id,
        actor,
        role,
        event_id,
        occurred_at,
        scope,
        request_id,
        purpose,
        lawful_basis,
        data_categories,
        retention,
        metadata,
        activity_episode_id,
        risk_signals,
    )


def consent_granted_template(
    *,
    actor: dict[str, Any],
    consent_id: str,
    subject_id: str | None = None,
    purpose_id: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a consent-granted audit input using stable consent, subject, and purpose ids."""
    return _consent_template(
        "consent.granted",
        actor,
        consent_id,
        subject_id,
        purpose_id,
        event_id,
        occurred_at,
        scope,
        request_id,
        purpose,
        lawful_basis,
        data_categories,
        retention,
        metadata,
        activity_episode_id,
        risk_signals,
    )


def consent_revoked_template(
    *,
    actor: dict[str, Any],
    consent_id: str,
    subject_id: str | None = None,
    purpose_id: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a consent-revoked audit input that groups with the original consent id."""
    return _consent_template(
        "consent.revoked",
        actor,
        consent_id,
        subject_id,
        purpose_id,
        event_id,
        occurred_at,
        scope,
        request_id,
        purpose,
        lawful_basis,
        data_categories,
        retention,
        metadata,
        activity_episode_id,
        risk_signals,
    )


def data_subject_request_created_template(
    *,
    actor: dict[str, Any],
    subject_request_id: str,
    request_type: str,
    subject_id: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a data-subject workflow audit input without claiming regulatory completion."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": actor,
            "action": "data.subject.request.created",
            "target": _resource("subject_request", subject_request_id),
            "purpose": "data_subject_workflow",
            "lawfulBasis": "legal_obligation",
            "retention": "subject_request_3y",
            "metadata": _compact_metadata({"requestType": request_type, "subjectId": subject_id}),
        },
    )


def export_bundle_created_template(
    *,
    actor: dict[str, Any],
    export_bundle_id: str,
    format: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build an export bundle audit input that references bundle contents by ids or hashes only."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": actor,
            "action": "export.bundle.created",
            "target": _resource("export_bundle", export_bundle_id),
            "purpose": "data_subject_workflow",
            "lawfulBasis": "legal_obligation",
            "retention": "export_1y",
            "metadata": _compact_metadata({"format": format}),
        },
    )


def retention_policy_applied_template(
    *,
    actor: dict[str, Any],
    policy_id: str,
    resource_id: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a retention-policy applied audit input with stable resource metadata when available."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": actor,
            "action": "retention.policy.applied",
            "target": _resource("policy", policy_id),
            "purpose": "retention_management",
            "lawfulBasis": "legal_obligation",
            "retention": "retention_audit_7y",
            "metadata": _compact_metadata({"resourceId": resource_id}),
        },
    )


def agent_session_started_template(
    *,
    session_id: str,
    agent_actor: dict[str, Any],
    initiated_by: dict[str, Any] | None = None,
    agent: dict[str, Any] | None = None,
    model: dict[str, Any] | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build an agent-session audit input using the shared metadata.sessionId grouping convention."""
    initiated = {"type": initiated_by.get("type"), "id": initiated_by.get("id")} if initiated_by else None
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": agent_actor,
            "action": "agent.session.started",
            "target": _resource("agent_session", session_id),
            "purpose": "change_provenance",
            "retention": "security_1y",
            "metadata": _compact_metadata(
                {"sessionId": session_id, "initiatedBy": initiated, "agent": agent, "model": model}
            ),
        },
        block_raw_content=True,
    )


def activity_episode_started_template(
    *,
    activity_episode_id: str,
    actor: dict[str, Any],
    auth_session_id: str | None = None,
    auth_context_id: str | None = None,
    domain: str | None = None,
    start_reason: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Open an activity episode that groups downstream change/review/ci/deploy/runtime events.

    activityEpisodeId is the reserved, un-shadowable grouping key (stamped by the shared
    builder); authSessionId/authContextId are reserved context keys placed in reserved
    template metadata so callers cannot override them.
    """
    return _build_template(
        _common_options(
            event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals
        ),
        {
            "actor": actor,
            "action": "activity.episode.started",
            "target": _resource("activity_episode", activity_episode_id),
            "purpose": "change_provenance",
            "retention": "security_1y",
            "metadata": _compact_metadata(
                {
                    "authSessionId": auth_session_id,
                    "authContextId": auth_context_id,
                    "domain": domain,
                    "startReason": start_reason,
                }
            ),
        },
    )


def agent_prompt_recorded_template(
    *,
    session_id: str,
    prompt_hash: str,
    agent_actor: dict[str, Any],
    prompt_id: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build an agent prompt audit input with a prompt hash rather than raw prompt text."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": agent_actor,
            "action": "agent.prompt.recorded",
            "target": _resource("agent_session", session_id),
            "purpose": "change_provenance",
            "retention": "security_1y",
            "metadata": _compact_metadata({"sessionId": session_id, "promptId": prompt_id, "promptHash": prompt_hash}),
        },
        block_raw_content=True,
    )


def agent_tool_called_template(
    *,
    session_id: str,
    tool_call_id: str,
    tool: str,
    status: str,
    agent_actor: dict[str, Any],
    input_hash: str | None = None,
    latency_ms: int | float | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build an agent tool-call audit input while representing raw inputs by optional hashes."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": agent_actor,
            "action": "agent.tool.called",
            "target": _resource("tool_call", tool_call_id),
            "purpose": "change_provenance",
            "retention": "security_1y",
            "metadata": _compact_metadata(
                {"sessionId": session_id, "tool": tool, "status": status, "inputHash": input_hash, "latencyMs": latency_ms}
            ),
        },
        block_raw_content=True,
    )


def change_proposal_created_template(
    *,
    proposal_id: str,
    actor: dict[str, Any],
    session_id: str | None = None,
    repository_id: str | None = None,
    branch: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a change proposal audit input that captures stable ids and branch labels, not raw diffs."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": actor,
            "action": "change.proposal.created",
            "target": _resource("change_proposal", proposal_id),
            "purpose": "change_provenance",
            "retention": "security_1y",
            "metadata": _compact_metadata({"sessionId": session_id, "repositoryId": repository_id, "branch": branch}),
        },
        block_raw_content=True,
    )


def files_changed_template(
    *,
    source_tree_id: str,
    actor: dict[str, Any],
    session_id: str | None = None,
    file_count: int | None = None,
    file_path_hashes: list[str] | None = None,
    changed_by_id: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a files-changed audit input from path hashes and counts rather than raw file paths."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": actor,
            "action": "change.files.changed",
            "target": _resource("source_tree", source_tree_id),
            "purpose": "change_provenance",
            "retention": "security_1y",
            "metadata": _compact_metadata(
                {
                    "sessionId": session_id,
                    "fileCount": file_count,
                    "filePathHashes": file_path_hashes,
                    "changedById": changed_by_id,
                }
            ),
        },
        block_raw_content=True,
    )


def review_approval_recorded_template(
    *,
    pull_request_id: str,
    reviewer: dict[str, Any],
    session_id: str | None = None,
    proposal_id: str | None = None,
    finding_count: int | None = None,
    waiver_count: int | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a review approval audit input with bounded review metadata."""
    return _review_template(
        "review.approval.recorded",
        pull_request_id,
        reviewer,
        session_id,
        proposal_id,
        finding_count,
        waiver_count,
        event_id,
        occurred_at,
        scope,
        request_id,
        purpose,
        lawful_basis,
        data_categories,
        retention,
        metadata,
        activity_episode_id,
        risk_signals,
    )


def review_finding_created_template(
    *,
    pull_request_id: str,
    reviewer: dict[str, Any],
    session_id: str | None = None,
    proposal_id: str | None = None,
    finding_count: int | None = None,
    waiver_count: int | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a review finding audit input without defaulting to raw review text in metadata."""
    return _review_template(
        "review.finding.created",
        pull_request_id,
        reviewer,
        session_id,
        proposal_id,
        finding_count,
        waiver_count,
        event_id,
        occurred_at,
        scope,
        request_id,
        purpose,
        lawful_basis,
        data_categories,
        retention,
        metadata,
        activity_episode_id,
        risk_signals,
    )


def review_waiver_recorded_template(
    *,
    pull_request_id: str,
    reviewer: dict[str, Any],
    session_id: str | None = None,
    proposal_id: str | None = None,
    finding_count: int | None = None,
    waiver_count: int | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a review waiver audit input using ids or hashes rather than raw waiver rationale."""
    return _review_template(
        "review.waiver.recorded",
        pull_request_id,
        reviewer,
        session_id,
        proposal_id,
        finding_count,
        waiver_count,
        event_id,
        occurred_at,
        scope,
        request_id,
        purpose,
        lawful_basis,
        data_categories,
        retention,
        metadata,
        activity_episode_id,
        risk_signals,
    )


def ci_job_completed_template(
    *,
    ci_run_id: str,
    service: dict[str, Any],
    status: str,
    session_id: str | None = None,
    artifact_id: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a CI job completion audit input with status and optional artifact id only."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": service,
            "action": "ci.job.completed",
            "target": _resource("ci_run", ci_run_id),
            "purpose": "change_provenance",
            "retention": "security_1y",
            "metadata": _compact_metadata({"sessionId": session_id, "status": status, "artifactId": artifact_id}),
        },
        block_raw_content=True,
    )


def deployment_created_template(
    *,
    deployment_id: str,
    service: dict[str, Any],
    session_id: str | None = None,
    artifact_id: str | None = None,
    policy_id: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a deployment audit input from stable deployment, artifact, and policy ids."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": service,
            "action": "deploy.deployed",
            "target": _resource("deployment", deployment_id),
            "purpose": "change_provenance",
            "retention": "security_1y",
            "metadata": _compact_metadata({"sessionId": session_id, "artifactId": artifact_id, "policyId": policy_id}),
        },
        block_raw_content=True,
    )


def runtime_observed_template(
    *,
    runtime_event_id: str,
    actor: dict[str, Any],
    session_id: str | None = None,
    deployment_id: str | None = None,
    observed_outcome: str | None = None,
    event_id: str | None = None,
    occurred_at: str | None = None,
    scope: dict[str, Any] | None = None,
    request_id: str | None = None,
    purpose: str | None = None,
    lawful_basis: str | None = None,
    data_categories: list[str] | None = None,
    retention: str | None = None,
    metadata: dict[str, Any] | None = None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a runtime observation audit input from aggregate outcomes or ids, not raw payloads."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": actor,
            "action": "audit.runtime.observed",
            "target": _resource("runtime_event", runtime_event_id),
            "purpose": "runtime_observation",
            "retention": "security_1y",
            "metadata": _compact_metadata(
                {"sessionId": session_id, "deploymentId": deployment_id, "observedOutcome": observed_outcome}
            ),
        },
        block_raw_content=True,
    )


audit_templates = {
    "auth": {
        "user_created": auth_user_created_template,
        "signed_in": auth_session_created_template,
        "signed_out": auth_session_revoked_template,
        "password_reset_requested": auth_password_reset_requested_template,
    },
    "organization": {
        "created": organization_created_template,
        "member_invited": organization_member_invited_template,
        "member_joined": organization_member_joined_template,
        "member_removed": organization_member_removed_template,
        "member_role_changed": organization_member_role_changed_template,
    },
    "data": {
        "consent_granted": consent_granted_template,
        "consent_revoked": consent_revoked_template,
        "subject_request_created": data_subject_request_created_template,
        "export_bundle_created": export_bundle_created_template,
        "retention_policy_applied": retention_policy_applied_template,
    },
    "agent": {
        "session_started": agent_session_started_template,
        "episode_started": activity_episode_started_template,
        "prompt_recorded": agent_prompt_recorded_template,
        "tool_called": agent_tool_called_template,
    },
    "code": {
        "change_proposal_created": change_proposal_created_template,
        "files_changed": files_changed_template,
        "review_approval_recorded": review_approval_recorded_template,
        "review_finding_created": review_finding_created_template,
        "review_waiver_recorded": review_waiver_recorded_template,
        "ci_job_completed": ci_job_completed_template,
        "deployment_created": deployment_created_template,
        "runtime_observed": runtime_observed_template,
    },
}


def _organization_member_template(
    action: str,
    organization_id: str,
    member_id: str,
    actor: dict[str, Any],
    role: str | list[str] | None,
    event_id: str | None,
    occurred_at: str | None,
    scope: dict[str, Any] | None,
    request_id: str | None,
    purpose: str | None,
    lawful_basis: str | None,
    data_categories: list[str] | None,
    retention: str | None,
    metadata: dict[str, Any] | None,
    activity_episode_id: str | None,
    risk_signals: dict[str, Any] | None,
) -> dict[str, Any]:
    """Build organization-member templates with tenant scope derived from organization id when omitted."""
    return _build_template(
        _common_options(
            event_id,
            occurred_at,
            scope or {"tenantId": organization_id},
            request_id,
            purpose,
            lawful_basis,
            data_categories,
            retention,
            metadata,
            activity_episode_id,
            risk_signals,
        ),
        {
            "actor": actor,
            "action": action,
            "target": _resource("organization_member", member_id),
            "purpose": "access_management",
            "lawfulBasis": "contract",
            "retention": "security_1y",
            "metadata": _role_metadata(role),
        },
    )


def _consent_template(
    action: str,
    actor: dict[str, Any],
    consent_id: str,
    subject_id: str | None,
    purpose_id: str | None,
    event_id: str | None,
    occurred_at: str | None,
    scope: dict[str, Any] | None,
    request_id: str | None,
    purpose: str | None,
    lawful_basis: str | None,
    data_categories: list[str] | None,
    retention: str | None,
    metadata: dict[str, Any] | None,
    activity_episode_id: str | None,
    risk_signals: dict[str, Any] | None,
) -> dict[str, Any]:
    """Build consent lifecycle templates with stable optional subject and purpose grouping ids."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": actor,
            "action": action,
            "target": _resource("consent", consent_id),
            "purpose": "consent_management",
            "lawfulBasis": "consent",
            "dataCategories": data_categories,
            "retention": "consent_7y",
            "metadata": _compact_metadata({"subjectId": subject_id, "purposeId": purpose_id}),
        },
    )


def _review_template(
    action: str,
    pull_request_id: str,
    reviewer: dict[str, Any],
    session_id: str | None,
    proposal_id: str | None,
    finding_count: int | None,
    waiver_count: int | None,
    event_id: str | None,
    occurred_at: str | None,
    scope: dict[str, Any] | None,
    request_id: str | None,
    purpose: str | None,
    lawful_basis: str | None,
    data_categories: list[str] | None,
    retention: str | None,
    metadata: dict[str, Any] | None,
    activity_episode_id: str | None,
    risk_signals: dict[str, Any] | None,
) -> dict[str, Any]:
    """Build review lifecycle templates with bounded counts and ids instead of raw review content."""
    return _build_template(
        _common_options(event_id, occurred_at, scope, request_id, purpose, lawful_basis, data_categories, retention, metadata, activity_episode_id, risk_signals),
        {
            "actor": reviewer,
            "action": action,
            "target": _resource("pull_request", pull_request_id),
            "purpose": "change_provenance",
            "retention": "security_1y",
            "metadata": _compact_metadata(
                {
                    "sessionId": session_id,
                    "proposalId": proposal_id,
                    "findingCount": finding_count,
                    "waiverCount": waiver_count,
                }
            ),
        },
        block_raw_content=True,
    )


def _common_options(
    event_id: str | None,
    occurred_at: str | None,
    scope: dict[str, Any] | None,
    request_id: str | None,
    purpose: str | None,
    lawful_basis: str | None,
    data_categories: list[str] | None,
    retention: str | None,
    metadata: dict[str, Any] | None,
    activity_episode_id: str | None = None,
    risk_signals: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Collect optional audit-event fields plus episode/risk threading so templates expose only host-owned overrides."""
    return {
        "id": event_id,
        "occurredAt": occurred_at,
        "scope": scope,
        "requestId": request_id,
        "purpose": purpose,
        "lawfulBasis": lawful_basis,
        "dataCategories": data_categories,
        "retention": retention,
        "metadata": metadata,
        "activityEpisodeId": activity_episode_id,
        "riskSignals": risk_signals,
    }


def _build_template(
    common: dict[str, Any],
    template: dict[str, Any],
    *,
    block_raw_content: bool = False,
) -> dict[str, Any]:
    """Merge public audit fields with template defaults; risk signals and the reserved activityEpisodeId win over caller metadata."""
    if block_raw_content:
        _assert_metadata_does_not_contain_raw_content(common.get("metadata"))
    metadata = _merge_metadata(common.get("metadata"), template.get("metadata"))
    if common.get("riskSignals") is not None:
        metadata = with_risk_signals(metadata, common["riskSignals"])
    if common.get("activityEpisodeId") is not None:
        metadata = {**metadata, "activityEpisodeId": common["activityEpisodeId"]}
    event = {
        "actor": template["actor"],
        "action": template["action"],
        "target": template["target"],
        "metadata": metadata,
    }
    for common_key in ("id", "occurredAt", "scope", "requestId"):
        if common.get(common_key) is not None:
            event[common_key] = common[common_key]

    for template_key in ("purpose", "lawfulBasis", "dataCategories", "retention"):
        value = common.get(template_key) if common.get(template_key) is not None else template.get(template_key)
        if value is not None:
            event[template_key] = value
    return event


def _principal(actor_type: str, actor_id: str, display: str | None = None) -> dict[str, Any]:
    """Create a protocol principal while omitting display unless the host supplies it intentionally."""
    value = {"type": actor_type, "id": actor_id, "display": display}
    return _compact_metadata(value) or {}


def _resource(resource_type: str, resource_id: str, display: str | None = None) -> dict[str, Any]:
    """Create a protocol resource while omitting display unless the host supplies it intentionally."""
    value = {"type": resource_type, "id": resource_id, "display": display}
    return _compact_metadata(value) or {}


def _role_metadata(role: str | list[str] | None) -> dict[str, Any] | None:
    """Normalize optional role metadata so role arrays are deterministic before hashing."""
    if isinstance(role, str):
        return {"role": role} if role.strip() else None
    if isinstance(role, list):
        roles = sorted({item for item in role if isinstance(item, str) and item.strip()})
        return {"role": roles} if roles else None
    return None


def _compact_session_security_context(input_value: dict[str, Any] | None) -> dict[str, Any] | None:
    """Keep session context to hashed or coarse fields so templates do not encourage raw IP/user-agent storage."""
    if not input_value:
        return None
    location = input_value.get("location")
    compact_location = None
    if isinstance(location, dict):
        compact_location = _compact_metadata(
            {
                "country": location.get("country"),
                "region": location.get("region"),
            }
        )
    return _compact_metadata(
        {
            "ipAddressHash": input_value.get("ipAddressHash") or input_value.get("ip_address_hash"),
            "networkHash": input_value.get("networkHash") or input_value.get("network_hash"),
            "userAgentHash": input_value.get("userAgentHash") or input_value.get("user_agent_hash"),
            "deviceId": input_value.get("deviceId") or input_value.get("device_id"),
            "location": compact_location,
            "method": input_value.get("method"),
            "provider": input_value.get("provider"),
        }
    )


def _compact_metadata(input_value: dict[str, Any]) -> dict[str, Any] | None:
    """Drop absent optional metadata fields without mutating caller-owned dictionaries."""
    output = {key: value for key, value in input_value.items() if value is not None}
    return output or None


def _merge_metadata(caller_metadata: dict[str, Any] | None, template_metadata: dict[str, Any] | None) -> dict[str, Any]:
    """Give template-reserved metadata such as sessionId final say over caller metadata."""
    output = dict(caller_metadata or {})
    output.update(template_metadata or {})
    return output


def _first_normalized(values: list[Any], normalize: Any) -> str | None:
    """Return the first recognized classifier value while skipping unknown aliases."""
    for value in values:
        normalized = normalize(value)
        if normalized is not None:
            return normalized
    return None


def _metadata_object(value: Any) -> dict[str, Any] | None:
    """Narrow nested metadata values before reading classifier aliases."""
    return value if isinstance(value, dict) else None


def _normalize_classifier_label(value: str) -> str:
    """Normalize classifier labels so separators and case do not affect aliases."""
    return re.sub(r"[^a-z0-9]", "", value.strip().lower())


def _assert_metadata_does_not_contain_raw_content(metadata: Any) -> None:
    """Fail closed when agent/code template caller metadata includes raw content or credential material."""
    if not metadata:
        return
    if not isinstance(metadata, dict):
        raise TypeError("metadata must be an object")
    for key, value in metadata.items():
        _assert_metadata_value_does_not_contain_raw_content(str(key), value, f"metadata.{key}")


def _assert_metadata_value_does_not_contain_raw_content(key: str, value: Any, path: str) -> None:
    """Recursively scan nested caller metadata for raw prompt, diff, path, output, argument, or token fields."""
    if _is_raw_content_metadata_key(key):
        raise TypeError(f"{path} is not allowed in agent/code audit template metadata")
    if isinstance(value, str) and _looks_like_raw_content_value(value):
        raise TypeError(f"{path} looks like raw content or credential material")
    if isinstance(value, list):
        for index, item in enumerate(value):
            _assert_metadata_value_does_not_contain_raw_content(key, item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for nested_key, nested_value in value.items():
            _assert_metadata_value_does_not_contain_raw_content(str(nested_key), nested_value, f"{path}.{nested_key}")


def _is_raw_content_metadata_key(key: str) -> bool:
    """Reject key names that denote raw code, prompt, log, path, tool argument, or credential material."""
    normalized = re.sub(r"[^a-z0-9]", "", key.lower())
    if normalized.endswith(("hash", "hashes", "id", "ids", "count", "status")):
        return False
    blocked = {
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
    }
    return any(normalized == item or normalized.endswith(item) for item in blocked)


def _looks_like_raw_content_value(value: str) -> bool:
    """Catch common raw patch and bearer-token shapes even when the metadata key is innocuous."""
    return bool(
        re.search(r"(^|\n)diff --git ", value)
        or re.search(r"@@ -\d+(,\d+)? \+\d+(,\d+)? @@", value)
        or re.search(r"Bearer\s+[A-Za-z0-9._-]+", value, re.I)
    )


_AUDIT_LOG_VISIBILITY_ALIASES = {
    "internal": "internal",
    "private": "internal",
    "staff": "internal",
    "employee": "internal",
    "admin": "internal",
    "ops": "internal",
    "backoffice": "internal",
    "firstparty": "internal",
    "external": "external",
    "public": "external",
    "customer": "external",
    "user": "external",
    "userfacing": "external",
    "enduser": "external",
    "partner": "partner",
    "vendor": "partner",
    "thirdparty": "partner",
    "system": "system",
    "service": "system",
    "automation": "system",
    "machine": "system",
}

_AUDIT_LOG_SURFACE_ALIASES = {
    "api": "api",
    "rest": "api",
    "graphql": "api",
    "http": "api",
    "https": "api",
    "rpc": "api",
    "trpc": "api",
    "app": "app",
    "application": "app",
    "ui": "app",
    "web": "app",
    "browser": "app",
    "dashboard": "app",
    "frontend": "app",
    "worker": "worker",
    "job": "worker",
    "cron": "worker",
    "queue": "worker",
    "background": "worker",
    "scheduled": "worker",
    "cli": "cli",
    "terminal": "cli",
    "commandline": "cli",
    "command": "cli",
    "webhook": "webhook",
    "hook": "webhook",
    "callback": "webhook",
}

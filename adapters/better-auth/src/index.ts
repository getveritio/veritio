import type { AuditEventInput, AuditRecord, AuditRecorder, EvidenceScope, JsonObject } from "@veritio/core";

export interface BetterAuthVeritioAdapterOptions {
  recorder: AuditRecorder;
  environment?: string;
}

export interface BetterAuthUserRef {
  id: string;
  email?: string | null;
}

export interface BetterAuthSessionRef {
  id: string;
}

export interface BetterAuthOrganizationRef {
  id: string;
}

export interface BetterAuthInvitationRef {
  id: string;
  email?: string | null;
  role?: string | string[] | null;
}

export interface BetterAuthMemberRef {
  id: string;
  role?: string | string[] | null;
}

export interface BetterAuthRequestContext {
  tenantId: string;
  requestId?: string;
}

export interface BetterAuthUserEventContext extends BetterAuthRequestContext {
  user: BetterAuthUserRef;
}

export interface BetterAuthSessionEventContext extends BetterAuthRequestContext {
  user: BetterAuthUserRef;
  session: BetterAuthSessionRef;
}

export interface BetterAuthInvitationCreatedContext {
  invitation: BetterAuthInvitationRef;
  inviter: BetterAuthUserRef;
  organization: BetterAuthOrganizationRef;
  requestId?: string;
}

export interface BetterAuthInvitationAcceptedContext {
  invitation: BetterAuthInvitationRef;
  member: BetterAuthMemberRef;
  user: BetterAuthUserRef;
  organization: BetterAuthOrganizationRef;
  requestId?: string;
}

export interface BetterAuthVeritioAdapter {
  recordUserCreated(input: BetterAuthUserEventContext): Promise<AuditRecord>;
  recordSessionCreated(input: BetterAuthSessionEventContext): Promise<AuditRecord>;
  recordSessionRevoked(input: BetterAuthSessionEventContext): Promise<AuditRecord>;
  recordInvitationCreated(input: BetterAuthInvitationCreatedContext): Promise<AuditRecord>;
  recordInvitationAccepted(input: BetterAuthInvitationAcceptedContext): Promise<AuditRecord>;
}

export function createBetterAuthVeritioAdapter(options: BetterAuthVeritioAdapterOptions): BetterAuthVeritioAdapter {
  return {
    recordUserCreated(input) {
      const tenantId = requireNonEmpty(input.tenantId, "tenantId");
      const userId = requireNonEmpty(input.user.id, "user.id");

      return options.recorder.record(
        withRequestId({
          actor: { type: "user", id: userId },
          action: "auth.user.created",
          target: { type: "user", id: userId },
          scope: buildScope(tenantId, options.environment),
          purpose: "access_management",
          lawfulBasis: "contract",
          retention: "security_1y",
          metadata: {},
        }, input.requestId),
        { idempotencyKey: `better-auth:user-created:${tenantId}:${userId}` },
      );
    },

    recordSessionCreated(input) {
      const tenantId = requireNonEmpty(input.tenantId, "tenantId");
      const userId = requireNonEmpty(input.user.id, "user.id");
      const sessionId = requireNonEmpty(input.session.id, "session.id");

      return options.recorder.record(
        withRequestId({
          actor: { type: "user", id: userId },
          action: "auth.session.created",
          target: { type: "session", id: sessionId },
          scope: buildScope(tenantId, options.environment),
          purpose: "access_management",
          lawfulBasis: "contract",
          retention: "security_1y",
          metadata: {},
        }, input.requestId),
        { idempotencyKey: `better-auth:session-created:${tenantId}:${sessionId}` },
      );
    },

    recordSessionRevoked(input) {
      const tenantId = requireNonEmpty(input.tenantId, "tenantId");
      const userId = requireNonEmpty(input.user.id, "user.id");
      const sessionId = requireNonEmpty(input.session.id, "session.id");

      return options.recorder.record(
        withRequestId({
          actor: { type: "user", id: userId },
          action: "auth.session.revoked",
          target: { type: "session", id: sessionId },
          scope: buildScope(tenantId, options.environment),
          purpose: "access_management",
          lawfulBasis: "contract",
          retention: "security_1y",
          metadata: {},
        }, input.requestId),
        { idempotencyKey: `better-auth:session-revoked:${tenantId}:${sessionId}` },
      );
    },

    recordInvitationCreated(input) {
      const tenantId = requireNonEmpty(input.organization.id, "organization.id");
      const invitationId = requireNonEmpty(input.invitation.id, "invitation.id");
      const inviterId = requireNonEmpty(input.inviter.id, "inviter.id");

      return options.recorder.record(
        withRequestId({
          actor: { type: "user", id: inviterId },
          action: "org.member.invited",
          target: { type: "organization_invitation", id: invitationId },
          scope: buildScope(tenantId, options.environment),
          purpose: "access_management",
          lawfulBasis: "contract",
          retention: "security_1y",
          metadata: roleMetadata(input.invitation.role),
        }, input.requestId),
        { idempotencyKey: `better-auth:invitation-created:${tenantId}:${invitationId}` },
      );
    },

    recordInvitationAccepted(input) {
      const tenantId = requireNonEmpty(input.organization.id, "organization.id");
      const memberId = requireNonEmpty(input.member.id, "member.id");
      const userId = requireNonEmpty(input.user.id, "user.id");
      const invitationId = requireNonEmpty(input.invitation.id, "invitation.id");

      return options.recorder.record(
        withRequestId({
          actor: { type: "user", id: userId },
          action: "org.member.joined",
          target: { type: "organization_member", id: memberId },
          scope: buildScope(tenantId, options.environment),
          purpose: "access_management",
          lawfulBasis: "contract",
          retention: "security_1y",
          metadata: {
            invitationId,
            ...roleMetadata(input.member.role),
          },
        }, input.requestId),
        { idempotencyKey: `better-auth:invitation-accepted:${tenantId}:${invitationId}:${memberId}` },
      );
    },
  };
}

function withRequestId(input: Omit<AuditEventInput, "requestId">, requestId: string | undefined): AuditEventInput {
  return requestId ? { ...input, requestId } : input;
}

function buildScope(tenantId: string, environment: string | undefined): EvidenceScope & { tenantId: string } {
  const scope: EvidenceScope & { tenantId: string } = { tenantId };
  if (environment) {
    scope.environment = environment;
  }
  return scope;
}

function roleMetadata(role: string | string[] | null | undefined): JsonObject {
  if (typeof role === "string" && role.trim().length > 0) {
    return { role };
  }
  if (Array.isArray(role)) {
    const roles = [...new Set(role.filter((item) => typeof item === "string" && item.trim().length > 0))].sort();
    return roles.length > 0 ? { role: roles } : {};
  }
  return {};
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  return value;
}

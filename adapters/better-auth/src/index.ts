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

export interface BetterAuthSessionSecurityContext {
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
  riskScore?: number;
}

export interface BetterAuthOrganizationRef {
  id: string;
}

export interface BetterAuthOrganizationCreatedContext {
  organization: BetterAuthOrganizationRef;
  actor: BetterAuthUserRef;
  requestId?: string;
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
  securityContext?: BetterAuthSessionSecurityContext;
  metadata?: JsonObject;
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
  recordOrganizationCreated(input: BetterAuthOrganizationCreatedContext): Promise<AuditRecord>;
  recordInvitationCreated(input: BetterAuthInvitationCreatedContext): Promise<AuditRecord>;
  recordInvitationAccepted(input: BetterAuthInvitationAcceptedContext): Promise<AuditRecord>;
}

/**
 * Builds the portable audit-event input for a Better Auth user creation. Hosts
 * can use this pure mapper when their storage surface is not an AuditStore, while
 * still preserving the adapter's tenant scope and metadata minimization rules.
 */
export function buildBetterAuthUserCreatedAuditEventInput(
  input: BetterAuthUserEventContext,
  environment?: string,
): AuditEventInput {
  const tenantId = requireNonEmpty(input.tenantId, "tenantId");
  const userId = requireNonEmpty(input.user.id, "user.id");

  return withRequestId(
    {
      actor: { type: "user", id: userId },
      action: "auth.user.created",
      target: { type: "user", id: userId },
      scope: buildScope(tenantId, environment),
      purpose: "access_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: {},
    },
    input.requestId,
  );
}

/**
 * Builds the portable audit-event input for first-party organization creation.
 * Organization identity becomes both target and tenant scope so Cloud or OSS
 * hosts can seed lifecycle evidence only after the organization exists.
 */
export function buildBetterAuthOrganizationCreatedAuditEventInput(
  input: BetterAuthOrganizationCreatedContext,
  environment?: string,
): AuditEventInput {
  const organizationId = requireNonEmpty(input.organization.id, "organization.id");
  const actorId = requireNonEmpty(input.actor.id, "actor.id");

  return withRequestId(
    {
      actor: { type: "user", id: actorId },
      action: "org.created",
      target: { type: "organization", id: organizationId },
      scope: buildScope(organizationId, environment),
      purpose: "access_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: {},
    },
    input.requestId,
  );
}

/**
 * Builds a portable sign-in audit-event input for Better Auth sessions. Hosts
 * may attach hashed IP/user-agent and coarse location context through
 * securityContext, while metadata remains an explicit host-owned escape hatch.
 */
export function buildBetterAuthSessionCreatedAuditEventInput(
  input: BetterAuthSessionEventContext,
  environment?: string,
): AuditEventInput {
  return buildBetterAuthSessionAuditEventInput(input, "auth.session.created", environment);
}

/**
 * Builds a portable logout/session-revocation audit-event input. The stable
 * Better Auth session id is the target; hosts must never pass session tokens,
 * cookies, or authorization headers as metadata.
 */
export function buildBetterAuthSessionRevokedAuditEventInput(
  input: BetterAuthSessionEventContext,
  environment?: string,
): AuditEventInput {
  return buildBetterAuthSessionAuditEventInput(input, "auth.session.revoked", environment);
}

/**
 * Creates Better Auth lifecycle recorders that translate auth and organization
 * events into Veritio audit events without persisting raw email metadata.
 */
export function createBetterAuthVeritioAdapter(options: BetterAuthVeritioAdapterOptions): BetterAuthVeritioAdapter {
  return {
    /**
     * Records a Better Auth user creation event without storing raw email data.
     */
    recordUserCreated(input) {
      const tenantId = requireNonEmpty(input.tenantId, "tenantId");
      const userId = requireNonEmpty(input.user.id, "user.id");

      return options.recorder.record(buildBetterAuthUserCreatedAuditEventInput(input, options.environment), {
        idempotencyKey: `better-auth:user-created:${tenantId}:${userId}`,
      });
    },

    /**
     * Records a session creation event scoped to the tenant that owns the user.
     */
    recordSessionCreated(input) {
      const tenantId = requireNonEmpty(input.tenantId, "tenantId");
      const sessionId = requireNonEmpty(input.session.id, "session.id");

      return options.recorder.record(buildBetterAuthSessionCreatedAuditEventInput(input, options.environment), {
        idempotencyKey: `better-auth:session-created:${tenantId}:${sessionId}`,
      });
    },

    /**
     * Records a session revocation event using the stable Better Auth session id.
     */
    recordSessionRevoked(input) {
      const tenantId = requireNonEmpty(input.tenantId, "tenantId");
      const sessionId = requireNonEmpty(input.session.id, "session.id");

      return options.recorder.record(buildBetterAuthSessionRevokedAuditEventInput(input, options.environment), {
        idempotencyKey: `better-auth:session-revoked:${tenantId}:${sessionId}`,
      });
    },

    /**
     * Records organization creation after the organization id can safely become
     * tenant scope for lifecycle evidence.
     */
    recordOrganizationCreated(input) {
      const organizationId = requireNonEmpty(input.organization.id, "organization.id");

      return options.recorder.record(buildBetterAuthOrganizationCreatedAuditEventInput(input, options.environment), {
        idempotencyKey: `better-auth:organization-created:${organizationId}`,
      });
    },

    /**
     * Records an organization invitation while preserving role metadata only.
     */
    recordInvitationCreated(input) {
      const tenantId = requireNonEmpty(input.organization.id, "organization.id");
      const invitationId = requireNonEmpty(input.invitation.id, "invitation.id");
      const inviterId = requireNonEmpty(input.inviter.id, "inviter.id");

      return options.recorder.record(
        withRequestId(
          {
            actor: { type: "user", id: inviterId },
            action: "org.member.invited",
            target: { type: "organization_invitation", id: invitationId },
            scope: buildScope(tenantId, options.environment),
            purpose: "access_management",
            lawfulBasis: "contract",
            retention: "security_1y",
            metadata: roleMetadata(input.invitation.role),
          },
          input.requestId,
        ),
        { idempotencyKey: `better-auth:invitation-created:${tenantId}:${invitationId}` },
      );
    },

    /**
     * Records invitation acceptance with member and invitation ids for evidence
     * discovery, still omitting raw invited email metadata.
     */
    recordInvitationAccepted(input) {
      const tenantId = requireNonEmpty(input.organization.id, "organization.id");
      const memberId = requireNonEmpty(input.member.id, "member.id");
      const userId = requireNonEmpty(input.user.id, "user.id");
      const invitationId = requireNonEmpty(input.invitation.id, "invitation.id");

      return options.recorder.record(
        withRequestId(
          {
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
          },
          input.requestId,
        ),
        { idempotencyKey: `better-auth:invitation-accepted:${tenantId}:${invitationId}:${memberId}` },
      );
    },
  };
}

/**
 * Shared mapper for Better Auth session lifecycle events. It enforces tenant,
 * user, and session ids before they become event scope, actor, target, or
 * idempotency material, while keeping first-class security context bounded.
 */
function buildBetterAuthSessionAuditEventInput(
  input: BetterAuthSessionEventContext,
  action: "auth.session.created" | "auth.session.revoked",
  environment: string | undefined,
): AuditEventInput {
  const tenantId = requireNonEmpty(input.tenantId, "tenantId");
  const userId = requireNonEmpty(input.user.id, "user.id");
  const sessionId = requireNonEmpty(input.session.id, "session.id");

  return withRequestId(
    {
      actor: { type: "user", id: userId },
      action,
      target: { type: "session", id: sessionId },
      scope: buildScope(tenantId, environment),
      purpose: "access_management",
      lawfulBasis: "contract",
      retention: "security_1y",
      metadata: mergeMetadata(input.metadata, {
        securityContext: compactSessionSecurityContext(input.securityContext),
      }),
    },
    input.requestId,
  );
}

/**
 * Adds request correlation only when the host provided it, keeping the default
 * event payload minimal.
 */
function withRequestId(input: Omit<AuditEventInput, "requestId">, requestId: string | undefined): AuditEventInput {
  return requestId ? { ...input, requestId } : input;
}

/**
 * Builds tenant-scoped evidence scope for Better Auth events, with environment
 * supplied by the host application rather than the adapter reading globals.
 */
function buildScope(tenantId: string, environment: string | undefined): EvidenceScope & { tenantId: string } {
  const scope: EvidenceScope & { tenantId: string } = { tenantId };
  if (environment) {
    scope.environment = environment;
  }
  return scope;
}

/**
 * Keeps role information useful while avoiding raw invitation email metadata.
 */
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

/**
 * Keeps sign-in/logout security context to hashed identifiers and coarse
 * location fields so adapter defaults do not retain raw IP or user-agent values.
 */
function compactSessionSecurityContext(input: BetterAuthSessionSecurityContext | undefined): JsonObject | undefined {
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
    riskScore: input.riskScore,
  });
}

/**
 * Removes omitted optional metadata fields without rewriting host-owned values.
 */
function compactMetadata(input: Record<string, unknown>): JsonObject | undefined {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) {
      output[key] = value;
    }
  }
  return Object.keys(output).length > 0 ? (output as JsonObject) : undefined;
}

/**
 * Merges host metadata with adapter-owned metadata, letting adapter-owned fields
 * such as securityContext keep a consistent shape.
 */
function mergeMetadata(callerMetadata: JsonObject | undefined, adapterMetadata: Record<string, unknown>): JsonObject {
  return { ...(callerMetadata ?? {}), ...(compactMetadata(adapterMetadata) ?? {}) };
}

/**
 * Requires Better Auth identifiers before they become tenant scope, actors,
 * targets, or idempotency key material.
 */
function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  return value;
}

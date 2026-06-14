import type {
  AuditEventInput,
  AuditRecord,
  AuditRecorder,
  AuditStoreAppendOptions,
  EvidenceScope,
  LawfulBasis,
  Principal,
  Resource,
} from "@veritio/core";

type MaybePromise<T> = T | Promise<T>;

export interface SvelteKitVeritioContext {
  tenantId: string;
  actor: SvelteKitVeritioActorRef;
  requestId?: string;
  workspaceId?: string;
  environment?: string;
}

export interface SvelteKitVeritioActorRef {
  type: Principal["type"];
  id: string;
}

export interface SvelteKitVeritioRequestInput {
  event?: unknown;
  locals?: unknown;
  params?: Record<string, string>;
  context?: SvelteKitVeritioContext;
}

export interface SvelteKitVeritioAdapterOptions {
  recorder: AuditRecorder;
  environment?: string;
  resolveContext?: (input: SvelteKitVeritioRequestInput) => MaybePromise<SvelteKitVeritioContext>;
}

export interface SvelteKitVeritioEventInput extends SvelteKitVeritioRequestInput {
  action: string;
  target: Resource;
  purpose?: string;
  lawfulBasis?: LawfulBasis;
  dataCategories?: string[];
  retention?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  append?: AuditStoreAppendOptions;
}

export interface SvelteKitVeritioAdapter {
  recordAction(input: SvelteKitVeritioEventInput): Promise<AuditRecord>;
  recordEndpoint(input: SvelteKitVeritioEventInput): Promise<AuditRecord>;
  withAction<T>(input: SvelteKitVeritioEventInput, handler: () => MaybePromise<T>): Promise<T>;
}

/**
 * Creates a thin SvelteKit adapter that records actions and endpoints through an
 * injected recorder and host-resolved locals/request context.
 */
export function createSvelteKitVeritioAdapter(options: SvelteKitVeritioAdapterOptions): SvelteKitVeritioAdapter {
  const record = async (input: SvelteKitVeritioEventInput) => {
    const context = await resolveContext(options, input);
    const event = buildAuditEvent(input, context, options.environment);
    const appendOptions = buildAppendOptions(input);
    return options.recorder.record(event, appendOptions);
  };

  return {
    /**
     * Records evidence for a SvelteKit form action through the shared adapter
     * path.
     */
    recordAction(input) {
      return record(input);
    },

    /**
     * Records evidence for a SvelteKit endpoint through the shared adapter path.
     */
    recordEndpoint(input) {
      return record(input);
    },

    /**
     * Runs a SvelteKit action first and records evidence only after it succeeds.
     */
    async withAction(input, handler) {
      const result = await handler();
      await record(input);
      return result;
    },
  };
}

/**
 * Resolves host-owned tenant and actor context from explicit input or the
 * configured callback, then validates it before event construction.
 */
async function resolveContext(
  options: SvelteKitVeritioAdapterOptions,
  input: SvelteKitVeritioRequestInput,
): Promise<SvelteKitVeritioContext> {
  const context = input.context ?? (await options.resolveContext?.(input));
  if (!context) {
    throw new TypeError("context or resolveContext is required");
  }
  return validateContext(context);
}

/**
 * Fails closed when SvelteKit locals/context do not provide tenant scope or actor
 * identity.
 */
function validateContext(context: SvelteKitVeritioContext): SvelteKitVeritioContext {
  requireNonEmpty(context.tenantId, "tenantId");
  requireNonEmpty(context.actor?.type, "actor.type");
  requireNonEmpty(context.actor?.id, "actor.id");
  return context;
}

/**
 * Maps a SvelteKit operation into the portable Veritio audit-event input while
 * keeping optional privacy and retention fields host-controlled.
 */
function buildAuditEvent(
  input: SvelteKitVeritioEventInput,
  context: SvelteKitVeritioContext,
  fallbackEnvironment: string | undefined,
): AuditEventInput {
  const event: AuditEventInput = {
    actor: context.actor,
    action: requireNonEmpty(input.action, "action"),
    target: validateTarget(input.target),
    scope: buildScope(context, fallbackEnvironment),
    metadata: input.metadata ?? {},
  };
  if (context.requestId) {
    event.requestId = context.requestId;
  }
  if (input.purpose) {
    event.purpose = input.purpose;
  }
  if (input.lawfulBasis) {
    event.lawfulBasis = input.lawfulBasis;
  }
  if (input.dataCategories?.length) {
    event.dataCategories = input.dataCategories;
  }
  if (input.retention) {
    event.retention = input.retention;
  }
  return event;
}

/**
 * Builds Veritio evidence scope from host context and the adapter environment
 * fallback without reading process state directly.
 */
function buildScope(
  context: SvelteKitVeritioContext,
  fallbackEnvironment: string | undefined,
): EvidenceScope & { tenantId: string } {
  const scope: EvidenceScope & { tenantId: string } = {
    tenantId: context.tenantId,
  };
  if (context.workspaceId) {
    scope.workspaceId = context.workspaceId;
  }
  const environment = context.environment ?? fallbackEnvironment;
  if (environment) {
    scope.environment = environment;
  }
  return scope;
}

/**
 * Validates target identity before it becomes part of a hashed audit event.
 */
function validateTarget(target: Resource): Resource {
  requireNonEmpty(target?.type, "target.type");
  requireNonEmpty(target?.id, "target.id");
  return target;
}

/**
 * Converts adapter append options and shorthand idempotency keys into the core
 * AuditStore append contract.
 */
function buildAppendOptions(input: SvelteKitVeritioEventInput): AuditStoreAppendOptions | undefined {
  const appendOptions: AuditStoreAppendOptions = { ...(input.append ?? {}) };
  if (input.idempotencyKey !== undefined) {
    appendOptions.idempotencyKey = requireNonEmpty(input.idempotencyKey, "idempotencyKey");
  }
  return Object.keys(appendOptions).length > 0 ? appendOptions : undefined;
}

/**
 * Requires non-empty framework context fields before recording evidence.
 */
function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  return value;
}

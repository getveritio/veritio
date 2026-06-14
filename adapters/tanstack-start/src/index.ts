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

export interface TanStackStartVeritioContext {
  tenantId: string;
  actor: TanStackStartVeritioActorRef;
  requestId?: string;
  workspaceId?: string;
  environment?: string;
}

export interface TanStackStartVeritioActorRef {
  type: Principal["type"];
  id: string;
}

export interface TanStackStartVeritioRequestInput {
  request?: unknown;
  params?: Record<string, string>;
  context?: TanStackStartVeritioContext;
}

export interface TanStackStartVeritioAdapterOptions {
  recorder: AuditRecorder;
  environment?: string;
  resolveContext?: (input: TanStackStartVeritioRequestInput) => MaybePromise<TanStackStartVeritioContext>;
}

export interface TanStackStartVeritioEventInput extends TanStackStartVeritioRequestInput {
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

export interface TanStackStartVeritioAdapter {
  recordRouteHandler(input: TanStackStartVeritioEventInput): Promise<AuditRecord>;
  recordServerFunction(input: TanStackStartVeritioEventInput): Promise<AuditRecord>;
  withServerFunction<T>(input: TanStackStartVeritioEventInput, handler: () => MaybePromise<T>): Promise<T>;
}

export function createTanStackStartVeritioAdapter(
  options: TanStackStartVeritioAdapterOptions,
): TanStackStartVeritioAdapter {
  const record = async (input: TanStackStartVeritioEventInput) => {
    const context = await resolveContext(options, input);
    const event = buildAuditEvent(input, context, options.environment);
    const appendOptions = buildAppendOptions(input);
    return options.recorder.record(event, appendOptions);
  };

  return {
    recordRouteHandler(input) {
      return record(input);
    },

    recordServerFunction(input) {
      return record(input);
    },

    async withServerFunction(input, handler) {
      const result = await handler();
      await record(input);
      return result;
    },
  };
}

async function resolveContext(
  options: TanStackStartVeritioAdapterOptions,
  input: TanStackStartVeritioRequestInput,
): Promise<TanStackStartVeritioContext> {
  const context = input.context ?? (await options.resolveContext?.(input));
  if (!context) {
    throw new TypeError("context or resolveContext is required");
  }
  return validateContext(context);
}

function validateContext(context: TanStackStartVeritioContext): TanStackStartVeritioContext {
  requireNonEmpty(context.tenantId, "tenantId");
  requireNonEmpty(context.actor?.type, "actor.type");
  requireNonEmpty(context.actor?.id, "actor.id");
  return context;
}

function buildAuditEvent(
  input: TanStackStartVeritioEventInput,
  context: TanStackStartVeritioContext,
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

function buildScope(
  context: TanStackStartVeritioContext,
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

function validateTarget(target: Resource): Resource {
  requireNonEmpty(target?.type, "target.type");
  requireNonEmpty(target?.id, "target.id");
  return target;
}

function buildAppendOptions(input: TanStackStartVeritioEventInput): AuditStoreAppendOptions | undefined {
  const appendOptions: AuditStoreAppendOptions = { ...(input.append ?? {}) };
  if (input.idempotencyKey !== undefined) {
    appendOptions.idempotencyKey = requireNonEmpty(input.idempotencyKey, "idempotencyKey");
  }
  return Object.keys(appendOptions).length > 0 ? appendOptions : undefined;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  return value;
}

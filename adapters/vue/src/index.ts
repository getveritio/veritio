export interface VueVeritioTargetRef {
  type: string;
  id: string;
}

export interface VueVeritioAttrsInput {
  action: string;
  target: VueVeritioTargetRef;
  purpose?: string;
}

export interface VueVeritioAttrs {
  readonly "data-veritio-action": string;
  readonly "data-veritio-target-type": string;
  readonly "data-veritio-target-id": string;
  readonly "data-veritio-purpose"?: string;
}

const SERVER_ONLY_KEY_PATTERN =
  /(recorder|store|storage|scope|tenantId|workspaceId|actor|metadata|secret|token|password|authorization|api[_-]?key|connection[_-]?string|database[_-]?url|database)/i;

/**
 * Creates inert client-side data attributes for Vue components while rejecting
 * tenant scope, recorder, storage, and secret-like fields that belong on servers.
 */
export function createVueVeritioAttrs(input: VueVeritioAttrsInput): VueVeritioAttrs {
  rejectServerOnlyKeys(input as unknown as Record<string, unknown>);
  rejectServerOnlyKeys(input.target as unknown as Record<string, unknown>);

  const attrs: VueVeritioAttrs = {
    "data-veritio-action": requireNonEmpty(input.action, "action"),
    "data-veritio-target-type": requireNonEmpty(input.target.type, "target.type"),
    "data-veritio-target-id": requireNonEmpty(input.target.id, "target.id"),
  };
  if (input.purpose) {
    return Object.freeze({
      ...attrs,
      "data-veritio-purpose": input.purpose,
    });
  }
  return Object.freeze(attrs);
}

export const createVeritioAttrs = createVueVeritioAttrs;

/**
 * Blocks server-only evidence context from leaking into client-rendered attrs.
 */
function rejectServerOnlyKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (SERVER_ONLY_KEY_PATTERN.test(key)) {
      throw new TypeError(`client evidence attributes must not include ${key}`);
    }
  }
}

/**
 * Requires visible client attribute identifiers before rendering them.
 */
function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  return value;
}

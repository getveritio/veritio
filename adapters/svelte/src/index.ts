export interface SvelteVeritioTargetRef {
  type: string;
  id: string;
}

export interface SvelteVeritioAttributeInput {
  action: string;
  target: SvelteVeritioTargetRef;
  purpose?: string;
}

export interface SvelteVeritioAttributes {
  readonly "data-veritio-action": string;
  readonly "data-veritio-target-type": string;
  readonly "data-veritio-target-id": string;
  readonly "data-veritio-purpose"?: string;
}

const SERVER_ONLY_KEY_PATTERN =
  /(recorder|store|storage|scope|tenantId|workspaceId|actor|metadata|secret|token|password|authorization|api[_-]?key|connection[_-]?string|database[_-]?url|database)/i;

export function createSvelteVeritioAttributes(input: SvelteVeritioAttributeInput): SvelteVeritioAttributes {
  rejectServerOnlyKeys(input as unknown as Record<string, unknown>);
  rejectServerOnlyKeys(input.target as unknown as Record<string, unknown>);

  const attributes: SvelteVeritioAttributes = {
    "data-veritio-action": requireNonEmpty(input.action, "action"),
    "data-veritio-target-type": requireNonEmpty(input.target.type, "target.type"),
    "data-veritio-target-id": requireNonEmpty(input.target.id, "target.id"),
  };
  if (input.purpose) {
    return Object.freeze({
      ...attributes,
      "data-veritio-purpose": input.purpose,
    });
  }
  return Object.freeze(attributes);
}

export const createVeritioAttributes = createSvelteVeritioAttributes;

function rejectServerOnlyKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (SERVER_ONLY_KEY_PATTERN.test(key)) {
      throw new TypeError(`client evidence attributes must not include ${key}`);
    }
  }
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  return value;
}

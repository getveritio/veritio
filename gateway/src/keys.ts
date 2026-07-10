/**
 * Virtual-key extraction and resolution (pure).
 *
 * The gateway compares sha256 hashes of presented keys against config-stored
 * hashes, so presented key values never persist, never appear in evidence,
 * and never reach logs. Resolution fails closed: no match or a revoked key
 * yields a typed refusal, never a pass-through.
 */
import { createHash } from "node:crypto";
import type { VirtualKeyConfig } from "./config";

/**
 * sha256 hex of the exact presented key string. This is the only form of a
 * virtual key the gateway stores or compares; config authors generate it with
 * `echo -n "vk_…" | shasum -a 256`.
 */
export function hashPresentedKey(presented: string): string {
  return createHash("sha256").update(presented, "utf8").digest("hex");
}

/**
 * Pulls the presented virtual key from request headers: `x-api-key` first
 * (Anthropic SDK convention), else `Authorization: Bearer <key>` (OpenAI SDK
 * convention). Returns null when neither is present or the Authorization
 * scheme is not Bearer — callers must treat null as an unauthenticated deny.
 */
export function extractPresentedKey(headers: Headers): string | null {
  const apiKey = headers.get("x-api-key");
  if (apiKey !== null && apiKey.length > 0) return apiKey;
  const authorization = headers.get("authorization");
  if (authorization === null) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

/** Typed key-resolution result; refusal reasons flow into evidence and 401 bodies. */
export type VirtualKeyResolution =
  | { ok: true; key: VirtualKeyConfig }
  | { ok: false; reason: "unknown_key" | "revoked_key" };

/**
 * Resolves a presented key against configured key hashes. Revocation is
 * checked after the hash match so a revoked key is reported as revoked (an
 * auditable signal) rather than blending into unknown-key noise.
 */
export function resolveVirtualKey(presented: string, keys: VirtualKeyConfig[]): VirtualKeyResolution {
  const hash = hashPresentedKey(presented);
  const key = keys.find((candidate) => candidate.keyHash === hash);
  if (key === undefined) return { ok: false, reason: "unknown_key" };
  if (key.revoked === true) return { ok: false, reason: "revoked_key" };
  return { ok: true, key };
}

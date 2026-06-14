import { createRedisServerTipCache, type RedisTipCacheHost } from "./create-redis-tip-cache";

/**
 * Exposes the Redis tenant-tip cache through a server-owned factory.
 */
export function createServerAuditTipCache(host: RedisTipCacheHost) {
  return createRedisServerTipCache(host);
}

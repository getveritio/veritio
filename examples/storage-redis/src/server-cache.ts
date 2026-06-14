import { createRedisServerTipCache, type RedisTipCacheHost } from "./create-redis-tip-cache";

export function createServerAuditTipCache(host: RedisTipCacheHost) {
  return createRedisServerTipCache(host);
}

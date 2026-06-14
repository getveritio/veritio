import { createRedisAuditTipCache, type RedisAuditTipClient } from "@veritio/storage";

export interface RedisTipCacheHost {
  client: RedisAuditTipClient;
  keyPrefix?: string;
}

/**
 * Creates a Redis tenant-tip cache from a host-injected client. This cache is
 * not an AuditStore and must not become the durable evidence source of truth.
 */
export function createRedisServerTipCache(host: RedisTipCacheHost) {
  return createRedisAuditTipCache({
    client: host.client,
    ...(host.keyPrefix === undefined ? {} : { keyPrefix: host.keyPrefix }),
  });
}

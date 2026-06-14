import { createRedisAuditTipCache, type RedisAuditTipClient } from "@veritio/storage";

export interface RedisTipCacheHost {
  client: RedisAuditTipClient;
  keyPrefix?: string;
}

export function createRedisServerTipCache(host: RedisTipCacheHost) {
  return createRedisAuditTipCache({
    client: host.client,
    keyPrefix: host.keyPrefix,
  });
}

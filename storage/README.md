# `@veritio/storage`

Host-injected storage helpers for Veritio audit trail evidence.

The package provides durable `AuditStore` factories for transaction-capable SQL
and MongoDB boundaries, plus a Redis tenant-tip cache helper. It does not read
environment variables, open database connections, or bundle vendor clients.

## Durable Stores

- `createPostgresAuditStore`: PostgreSQL-compatible stores.
- `createNeonAuditStore`: Neon-backed PostgreSQL-compatible stores.
- `createMysqlAuditStore`: MySQL-compatible stores.
- `createMariaDbAuditStore`: MariaDB-compatible stores.
- `createMongoAuditStore`: MongoDB stores with host-provided transaction
  boundaries.

Host applications must provide a transaction-capable client wrapper. The store
uses tenant-scoped append ordering, idempotency-key hashes, expected previous
hash checks, and persisted record integrity validation.

## Redis

`createRedisAuditTipCache` stores and reads validated tenant chain tips. It is
not an `AuditStore` and does not claim durable audit evidence on its own. Use it
alongside a durable store when a cache is useful.

## SQL Schema Helpers

`POSTGRES_AUDIT_RECORDS_SCHEMA_SQL` and `MYSQL_AUDIT_RECORDS_SCHEMA_SQL`
provide starting table definitions. Review them for your database policy,
backup, retention, and migration requirements before applying them.

Veritio supports evidence collection and verification workflows. It is not legal
advice and does not make an application automatically compliant with any
regulation or framework.

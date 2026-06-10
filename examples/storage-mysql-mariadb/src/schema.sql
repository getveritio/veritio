create table if not exists veritio_audit_records (
  tenant_id varchar(191) not null,
  sequence bigint not null,
  idempotency_key_hash char(64) not null,
  event_json json not null,
  previous_hash char(64),
  hash char(64) not null,
  hash_algorithm varchar(32) not null,
  canonicalization varchar(64) not null,
  appended_at datetime(3) not null,
  primary key (tenant_id, sequence),
  unique key veritio_audit_records_idempotency_idx (tenant_id, idempotency_key_hash),
  key veritio_audit_records_tenant_appended_at_idx (tenant_id, appended_at)
);

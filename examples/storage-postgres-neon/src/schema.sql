create table if not exists veritio_audit_records (
  tenant_id text not null,
  sequence bigint not null,
  idempotency_key_hash text not null,
  event_json jsonb not null,
  previous_hash text,
  hash text not null,
  hash_algorithm text not null check (hash_algorithm = 'sha256'),
  canonicalization text not null check (canonicalization = 'veritio-json-v1'),
  appended_at timestamptz not null,
  primary key (tenant_id, sequence),
  unique (tenant_id, idempotency_key_hash)
);

create index if not exists veritio_audit_records_tenant_appended_at_idx
  on veritio_audit_records (tenant_id, appended_at desc);

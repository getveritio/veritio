CREATE TABLE IF NOT EXISTS veritio_audit_records (
  tenant_id text NOT NULL,
  sequence bigint NOT NULL,
  idempotency_key_hash char(64) NOT NULL,
  event_canonical text NOT NULL,
  record_json text NOT NULL,
  hash char(64) NOT NULL,
  previous_hash char(64),
  appended_at text NOT NULL,
  PRIMARY KEY (tenant_id, sequence),
  UNIQUE (tenant_id, idempotency_key_hash)
);

CREATE INDEX IF NOT EXISTS veritio_audit_records_tenant_sequence_idx
  ON veritio_audit_records (tenant_id, sequence);

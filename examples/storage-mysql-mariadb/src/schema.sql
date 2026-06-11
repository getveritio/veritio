CREATE TABLE IF NOT EXISTS `veritio_audit_records` (
  `tenant_id` varchar(255) NOT NULL,
  `sequence` bigint NOT NULL,
  `idempotency_key_hash` char(64) NOT NULL,
  `event_canonical` longtext NOT NULL,
  `record_json` longtext NOT NULL,
  `hash` char(64) NOT NULL,
  `previous_hash` char(64),
  `appended_at` varchar(40) NOT NULL,
  PRIMARY KEY (`tenant_id`, `sequence`),
  UNIQUE KEY `veritio_audit_records_idempotency_unique` (`tenant_id`, `idempotency_key_hash`),
  KEY `veritio_audit_records_tenant_sequence_idx` (`tenant_id`, `sequence`)
);

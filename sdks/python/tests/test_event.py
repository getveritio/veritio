import unittest

from veritio import canonical_json, create_audit_event, hash_audit_event, hash_audit_record, hash_idempotency_key


class EventTests(unittest.TestCase):
    def test_canonical_json_sorts_keys_recursively(self):
        actual = canonical_json(
            {
                "z": 1,
                "a": {
                    "c": 3,
                    "b": [2, {"y": "yes", "x": "first"}],
                },
            }
        )

        self.assertEqual(actual, '{"a":{"b":[2,{"x":"first","y":"yes"}],"c":3},"z":1}')

    def test_canonical_json_preserves_null_and_does_not_html_escape_strings(self):
        line_separator = chr(0x2028)

        self.assertEqual(
            canonical_json({"note": f"<&{line_separator}", "a": None}),
            f'{{"a":null,"note":"<&{line_separator}"}}',
        )

    def test_create_audit_event_redacts_sensitive_metadata(self):
        event = create_audit_event(
            {
                "id": "evt_01",
                "occurredAt": "2026-06-10T00:00:00.000Z",
                "actor": {"type": "user", "id": "usr_123"},
                "action": "org.member.invited",
                "target": {"type": "organization", "id": "org_123"},
                "metadata": {
                    "invitedEmail": "member@example.com",
                    "role": "viewer",
                },
            }
        )

        self.assertEqual(event["schemaVersion"], "2026-06-10")
        self.assertEqual(event["metadata"]["invitedEmail"], "[redacted]")
        self.assertEqual(event["metadata"]["role"], "viewer")

    def test_create_audit_event_rejects_invalid_action(self):
        with self.assertRaisesRegex(TypeError, "action must use dotted lowercase protocol form"):
            create_audit_event(
                {
                    "id": "evt_01",
                    "occurredAt": "2026-06-10T00:00:00.000Z",
                    "actor": {"type": "user", "id": "usr_123"},
                    "action": "OrgMemberInvited",
                    "target": {"type": "organization", "id": "org_123"},
                    "metadata": {},
                }
            )

    def test_hash_audit_event_is_deterministic(self):
        event = create_audit_event(
            {
                "id": "evt_01",
                "occurredAt": "2026-06-10T00:00:00.000Z",
                "actor": {"type": "system", "id": "sys_1"},
                "action": "retention.policy.applied",
                "target": {"type": "organization", "id": "org_123"},
                "metadata": {"policy": "security_1y"},
            }
        )

        self.assertEqual(hash_audit_event(event), hash_audit_event(event))

    def test_hash_idempotency_key_matches_protocol_vector(self):
        self.assertEqual(
            hash_idempotency_key("org_123", "evt_01"),
            "e18c21b684554d90c197722b0b121e63bd5eadf5bf2f844c70f31be0825016f8",
        )

    def test_hash_audit_record_matches_protocol_vector(self):
        line_separator = chr(0x2028)
        idempotency_key_hash = hash_idempotency_key("org_123", "evt_01")

        self.assertEqual(
            hash_audit_record(
                {
                    "event": {
                        "id": "evt_01",
                        "schemaVersion": "2026-06-10",
                        "occurredAt": "2026-06-10T00:00:00.000Z",
                        "actor": {"type": "user", "id": "usr_123"},
                        "action": "org.member.invited",
                        "target": {"type": "organization", "id": "org_123"},
                        "scope": {"tenantId": "org_123", "environment": "test"},
                        "metadata": {"note": f"<&{line_separator}", "optional": None, "role": "viewer"},
                    },
                    "sequence": 1,
                    "previousHash": None,
                    "hashAlgorithm": "sha256",
                    "canonicalization": "veritio-json-v1",
                    "appendedAt": "2026-06-10T00:00:01.000Z",
                    "idempotencyKeyHash": idempotency_key_hash,
                }
            ),
            "14396c51f0304f26c9be4ac918daf9d50109c0d9fd238ccb1c87c15632427edf",
        )


if __name__ == "__main__":
    unittest.main()

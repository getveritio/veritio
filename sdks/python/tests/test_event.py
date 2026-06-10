import unittest

from veritio import canonical_json, create_audit_event, hash_audit_event


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


if __name__ == "__main__":
    unittest.main()

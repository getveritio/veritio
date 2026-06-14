import json
import unittest
from pathlib import Path

from veritio import (
    canonical_json,
    create_audit_event,
    create_evidence_edge,
    hash_audit_event,
    hash_audit_record,
    hash_evidence_edge,
    hash_evidence_edge_record,
    hash_idempotency_key,
)

CONFORMANCE_DIR = Path(__file__).resolve().parents[3] / "spec" / "conformance"


def load_fixture(file_name):
    return json.loads((CONFORMANCE_DIR / file_name).read_text(encoding="utf-8"))


class EventTests(unittest.TestCase):
    def test_canonical_json_matches_conformance_fixtures(self):
        fixture = load_fixture("canonical-json.json")

        for conformance_case in fixture["cases"]:
            with self.subTest(conformance_case["name"]):
                self.assertEqual(canonical_json(conformance_case["input"]), conformance_case["expected"])

    def test_create_audit_event_matches_conformance_fixtures(self):
        fixture = load_fixture("event-creation.json")

        for conformance_case in fixture["cases"]:
            with self.subTest(conformance_case["name"]):
                self.assertEqual(create_audit_event(conformance_case["input"]), conformance_case["expected"])

    def test_redaction_matches_conformance_fixtures(self):
        fixture = load_fixture("redaction.json")

        for conformance_case in fixture["cases"]:
            with self.subTest(conformance_case["name"]):
                event = create_audit_event(
                    {
                        "id": "evt_redaction_fixture",
                        "occurredAt": "2026-06-10T00:00:00.000Z",
                        "actor": {"type": "user", "id": "usr_fixture_123"},
                        "action": "org.member.invited",
                        "target": {"type": "organization", "id": "org_fixture_123"},
                        "metadata": conformance_case["metadata"],
                    }
                )
                self.assertEqual(event["metadata"], conformance_case["expectedMetadata"])

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

    def test_hash_audit_event_matches_conformance_fixtures(self):
        fixture = load_fixture("event-hashing.json")

        for conformance_case in fixture["cases"]:
            with self.subTest(conformance_case["name"]):
                self.assertEqual(
                    hash_audit_event(conformance_case["event"], conformance_case["previousHash"]),
                    conformance_case["expectedHash"],
                )

    def test_audit_record_hashing_matches_conformance_fixtures(self):
        fixture = load_fixture("audit-record-hashing.json")

        for conformance_case in fixture["cases"]:
            with self.subTest(conformance_case["name"]):
                self.assertEqual(
                    hash_idempotency_key(conformance_case["tenantId"], conformance_case["idempotencyKey"]),
                    conformance_case["expectedIdempotencyKeyHash"],
                )
                self.assertEqual(
                    hash_audit_record(conformance_case["recordWithoutHash"]),
                    conformance_case["expectedHash"],
                )

    def test_create_evidence_edge_matches_conformance_fixtures(self):
        fixture = load_fixture("edge-creation.json")

        for conformance_case in fixture["cases"]:
            with self.subTest(conformance_case["name"]):
                self.assertEqual(create_evidence_edge(conformance_case["input"]), conformance_case["expected"])

    def test_create_evidence_edge_rejects_invalid_relation(self):
        with self.assertRaisesRegex(TypeError, "relation must be a supported evidence graph relation"):
            create_evidence_edge(
                {
                    "id": "edge_invalid_relation",
                    "occurredAt": "2026-06-13T00:00:00.000Z",
                    "from": {"type": "agent_session", "id": "agt_sess_123"},
                    "relation": "linked_to",
                    "to": {"type": "file", "id": "file_123"},
                    "metadata": {},
                }
            )

    def test_create_evidence_edge_requires_entity_references(self):
        with self.assertRaisesRegex(TypeError, "from.id is required"):
            create_evidence_edge(
                {
                    "id": "edge_missing_entity_id",
                    "occurredAt": "2026-06-13T00:00:00.000Z",
                    "from": {"type": "agent_session", "id": ""},
                    "relation": "created",
                    "to": {"type": "file", "id": "file_123"},
                    "metadata": {},
                }
            )

    def test_hash_evidence_edge_matches_conformance_fixtures(self):
        fixture = load_fixture("edge-hashing.json")

        for conformance_case in fixture["cases"]:
            with self.subTest(conformance_case["name"]):
                self.assertEqual(
                    hash_evidence_edge(conformance_case["edge"], conformance_case["previousHash"]),
                    conformance_case["expectedHash"],
                )

    def test_edge_record_hashing_matches_conformance_fixtures(self):
        fixture = load_fixture("edge-record-hashing.json")

        for conformance_case in fixture["cases"]:
            with self.subTest(conformance_case["name"]):
                self.assertEqual(
                    hash_idempotency_key(conformance_case["tenantId"], conformance_case["idempotencyKey"]),
                    conformance_case["expectedIdempotencyKeyHash"],
                )
                self.assertEqual(
                    hash_evidence_edge_record(conformance_case["recordWithoutHash"]),
                    conformance_case["expectedHash"],
                )


if __name__ == "__main__":
    unittest.main()

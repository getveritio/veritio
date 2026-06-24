import json
import unittest
from pathlib import Path

from veritio import (
    agent_prompt_recorded_template,
    agent_session_started_template,
    agent_tool_called_template,
    audit_log_classification_metadata,
    audit_log_surface_values,
    audit_log_visibility_values,
    audit_template_sets,
    auth_session_created_template,
    canonical_json,
    change_proposal_created_template,
    create_audit_event,
    create_evidence_commit,
    create_evidence_edge,
    detect_audit_log_classifiers,
    files_changed_template,
    hash_audit_event,
    hash_audit_record,
    hash_evidence_commit,
    hash_evidence_edge,
    hash_evidence_edge_record,
    hash_idempotency_key,
    organization_created_template,
    review_waiver_recorded_template,
    verify_evidence_commits,
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
                edge = create_evidence_edge(
                    {
                        "id": "edge_redaction_fixture",
                        "occurredAt": "2026-06-23T10:18:04.000Z",
                        "from": {"type": "change", "id": "chg_redaction_fixture"},
                        "relation": "has_output",
                        "to": {"type": "revision", "id": "rev_redaction_fixture"},
                        "metadata": conformance_case["metadata"],
                    }
                )
                self.assertEqual(edge["metadata"], conformance_case["expectedMetadata"])

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

    def test_evidence_commit_matches_conformance_fixtures(self):
        fixture = load_fixture("evidence-commit.json")
        ordered_case = fixture["cases"][0]
        odd_case = fixture["cases"][1]

        commit = create_evidence_commit(ordered_case["input"])
        self.assertEqual(commit, ordered_case["expected"])
        self.assertEqual(hash_evidence_commit(commit), commit["hash"])
        self.assertEqual(
            verify_evidence_commits([commit]),
            {"ok": False, "index": 0, "reason": "previous_hash_mismatch"},
        )

        odd_commit = create_evidence_commit(odd_case["input"])
        self.assertEqual(odd_commit["recordsRoot"], odd_case["expectedRecordsRoot"])

    def test_evidence_commit_rejects_empty_and_duplicate_members(self):
        base_input = {
            "commitId": "cmt_empty",
            "streamId": "str_fixture",
            "sequence": 1,
            "previousCommitHash": None,
            "committedAt": "2026-06-23T10:15:31.000Z",
            "members": [],
        }

        with self.assertRaisesRegex(TypeError, "members must not be empty"):
            create_evidence_commit(base_input)
        with self.assertRaisesRegex(TypeError, "duplicate commit member"):
            create_evidence_commit(
                {
                    **base_input,
                    "commitId": "cmt_duplicate",
                    "members": [
                        {
                            "index": 0,
                            "recordType": "audit.record",
                            "recordId": "evt_01",
                            "recordHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        },
                        {
                            "index": 1,
                            "recordType": "audit.record",
                            "recordId": "evt_01",
                            "recordHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        },
                    ],
                }
            )

    def test_evidence_commit_verifier_detects_chain_and_hash_tampering(self):
        first = create_evidence_commit(
            {
                "commitId": "cmt_01",
                "streamId": "str_fixture",
                "sequence": 1,
                "previousCommitHash": None,
                "committedAt": "2026-06-23T10:15:31.000Z",
                "members": [
                    {
                        "index": 0,
                        "recordType": "audit.record",
                        "recordId": "evt_01",
                        "recordHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    }
                ],
            }
        )
        second = create_evidence_commit(
            {
                "commitId": "cmt_02",
                "streamId": "str_fixture",
                "sequence": 2,
                "previousCommitHash": first["hash"],
                "committedAt": "2026-06-23T10:16:31.000Z",
                "members": [
                    {
                        "index": 0,
                        "recordType": "evidence.edge.record",
                        "recordId": "edge_01",
                        "recordHash": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                    }
                ],
            }
        )

        self.assertEqual(verify_evidence_commits([first, second]), {"ok": True})
        self.assertEqual(
            verify_evidence_commits([{**second, "previousCommitHash": None}]),
            {"ok": False, "index": 0, "reason": "sequence_mismatch"},
        )
        self.assertEqual(
            verify_evidence_commits([first, {**second, "recordCount": 2}]),
            {"ok": False, "index": 1, "reason": "record_count_mismatch"},
        )
        malformed = {**first}
        del malformed["streamId"]
        self.assertEqual(
            verify_evidence_commits([malformed]),
            {"ok": False, "index": 0, "reason": "invalid_member_manifest"},
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

    def test_audit_template_sets_expose_common_actions(self):
        self.assertIn("auth.session.created", audit_template_sets["auth"])
        self.assertIn("org.created", audit_template_sets["organization"])
        self.assertIn("agent.session.started", audit_template_sets["agent"])
        self.assertIn("review.waiver.recorded", audit_template_sets["code"])

    def test_audit_log_classifier_helpers_and_detectors(self):
        self.assertEqual(audit_log_visibility_values, ["internal", "external", "partner", "system"])
        self.assertEqual(audit_log_surface_values, ["api", "app", "worker", "cli", "webhook"])
        self.assertEqual(
            audit_log_classification_metadata(visibility="public", surface="REST"),
            {"logVisibility": "external", "logSurface": "api"},
        )
        self.assertEqual(
            audit_log_classification_metadata(visibility="staff", surface="dashboard"),
            {"logVisibility": "internal", "logSurface": "app"},
        )
        self.assertEqual(
            detect_audit_log_classifiers({"auditLog": {"visibility": "partner", "surface": "webhook"}}),
            {"visibility": "partner", "surface": "webhook"},
        )
        self.assertEqual(
            detect_audit_log_classifiers({"visibility": "customer", "client": {"type": "browser"}}),
            {"visibility": "external", "surface": "app"},
        )

    def test_auth_session_template_keeps_hashed_security_context(self):
        event = create_audit_event(
            auth_session_created_template(
                event_id="evt_signin",
                occurred_at="2026-06-20T00:00:00.000Z",
                user_id="usr_123",
                session_id="sess_123",
                scope={"tenantId": "org_123", "environment": "test"},
                security_context={
                    "ip_address_hash": "sha256:client-ip",
                    "user_agent_hash": "sha256:user-agent",
                    "location": {"country": "US", "region": "CA", "city": "San Francisco"},
                },
                metadata={
                    "authorization": "Bearer secret",
                    **audit_log_classification_metadata(visibility="customer", surface="api"),
                },
            )
        )

        self.assertEqual(event["action"], "auth.session.created")
        self.assertEqual(event["target"], {"type": "session", "id": "sess_123"})
        self.assertEqual(
            event["metadata"],
            {
                "authorization": "[redacted]",
                "logSurface": "api",
                "logVisibility": "external",
                "securityContext": {
                    "ipAddressHash": "sha256:client-ip",
                    "location": {"country": "US", "region": "CA"},
                    "userAgentHash": "sha256:user-agent",
                },
            },
        )

    def test_organization_template_defaults_tenant_scope(self):
        event = create_audit_event(
            organization_created_template(
                event_id="evt_org_created",
                occurred_at="2026-06-20T00:01:00.000Z",
                organization_id="org_123",
                actor={"type": "user", "id": "usr_123"},
            )
        )

        self.assertEqual(event["action"], "org.created")
        self.assertEqual(event["scope"], {"tenantId": "org_123"})

    def test_agent_template_preserves_reserved_session_id(self):
        event = create_audit_event(
            agent_session_started_template(
                event_id="evt_agent_started",
                occurred_at="2026-06-20T00:02:00.000Z",
                session_id="agt_sess_123",
                agent_actor={"type": "ai_agent", "id": "agent_codex"},
                scope={"tenantId": "org_123"},
                metadata={"sessionId": "caller_shadow", "reason": "code_review"},
            )
        )

        self.assertEqual(event["action"], "agent.session.started")
        self.assertEqual(event["metadata"], {"reason": "code_review", "sessionId": "agt_sess_123"})

    def test_code_templates_include_session_grouping(self):
        files_event = create_audit_event(
            files_changed_template(
                event_id="evt_files_changed",
                occurred_at="2026-06-20T00:03:00.000Z",
                source_tree_id="tree_123",
                actor={"type": "ai_agent", "id": "agent_codex"},
                scope={"tenantId": "org_123"},
                session_id="agt_sess_123",
                file_count=2,
                file_path_hashes=["hash_b", "hash_a"],
            )
        )
        waiver_event = create_audit_event(
            review_waiver_recorded_template(
                event_id="evt_review_waiver",
                occurred_at="2026-06-20T00:04:00.000Z",
                pull_request_id="pr_123",
                reviewer={"type": "user", "id": "usr_reviewer"},
                scope={"tenantId": "org_123"},
                session_id="agt_sess_123",
                proposal_id="proposal_123",
                waiver_count=1,
                metadata={"sessionId": "caller_shadow"},
            )
        )

        self.assertEqual(files_event["metadata"]["sessionId"], "agt_sess_123")
        self.assertEqual(waiver_event["action"], "review.waiver.recorded")
        self.assertEqual(waiver_event["metadata"]["sessionId"], "agt_sess_123")

    def test_agent_and_code_templates_reject_raw_content_metadata(self):
        agent_actor = {"type": "ai_agent", "id": "agent_codex"}
        scope = {"tenantId": "org_123"}
        unsafe_cases = [
            lambda: agent_prompt_recorded_template(
                session_id="agt_sess_123",
                prompt_hash="sha256:prompt",
                agent_actor=agent_actor,
                scope=scope,
                metadata={"prompt": "create a secret-bearing patch"},
            ),
            lambda: files_changed_template(
                source_tree_id="tree_123",
                actor=agent_actor,
                scope=scope,
                metadata={"diff": "diff --git a/a.py b/a.py"},
            ),
            lambda: files_changed_template(
                source_tree_id="tree_123",
                actor=agent_actor,
                scope=scope,
                metadata={"hunk": "@@ -1 +1 @@"},
            ),
            lambda: files_changed_template(
                source_tree_id="tree_123",
                actor=agent_actor,
                scope=scope,
                metadata={"filePath": "src/secrets.py"},
            ),
            lambda: agent_tool_called_template(
                session_id="agt_sess_123",
                tool_call_id="tool_123",
                tool="shell",
                status="ok",
                agent_actor=agent_actor,
                scope=scope,
                metadata={"stdout": "raw command output"},
            ),
            lambda: agent_tool_called_template(
                session_id="agt_sess_123",
                tool_call_id="tool_123",
                tool="shell",
                status="failed",
                agent_actor=agent_actor,
                scope=scope,
                metadata={"stderr": "raw error output"},
            ),
            lambda: agent_tool_called_template(
                session_id="agt_sess_123",
                tool_call_id="tool_123",
                tool="shell",
                status="ok",
                agent_actor=agent_actor,
                scope=scope,
                metadata={"toolArgs": {"command": "cat .env"}},
            ),
            lambda: change_proposal_created_template(
                proposal_id="proposal_123",
                actor=agent_actor,
                scope=scope,
                metadata={"note": "Bearer abc.def"},
            ),
        ]

        for index, unsafe_case in enumerate(unsafe_cases):
            with self.subTest(index=index):
                with self.assertRaisesRegex(TypeError, "not allowed|looks like raw content"):
                    unsafe_case()


if __name__ == "__main__":
    unittest.main()

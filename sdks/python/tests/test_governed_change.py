import json
import unittest
from datetime import datetime, timezone

from veritio import (
    create_audit_event,
    create_governed_action_draft,
    create_governed_change_draft,
    define_entity,
    governed_revision_id,
    hash_idempotency_key,
    merge_veritio_metadata,
    ref_key,
)


SCOPE = {"tenantId": "org_acme_123", "workspaceId": "wks_security_456", "environment": "test"}
PRODUCER = {"authority": "acme.billing", "kind": "principal", "type": "service", "id": "billing-api"}
INITIATED_BY = {"authority": "auth.acme.internal", "kind": "principal", "type": "user", "id": "usr_123"}


class GovernedChangeTests(unittest.TestCase):
    def test_ref_key_formats_authority_qualified_refs(self):
        self.assertEqual(
            ref_key({"authority": "acme.billing", "kind": "entity", "type": "project_entry", "id": "42"}),
            "acme.billing:entity:project_entry:42",
        )

    def test_merge_veritio_metadata_rejects_reserved_shadowing(self):
        with self.assertRaisesRegex(TypeError, "metadata.changeId is reserved by Veritio"):
            merge_veritio_metadata({"changeId": "caller_supplied"}, {"changeId": "chg_01"})

        self.assertEqual(
            merge_veritio_metadata(
                {"safe": True},
                {
                    "authSessionId": "ses_123",
                    "authContextId": "authctx_123_v4",
                    "activityEpisodeId": "episode_20260623_1000_usr_admin",
                    "traceId": "trc_01jz_estimate",
                    "correlationId": "workflow_project_estimate",
                    "causationEventId": "evt_previous_trigger",
                    "changeId": "chg_project_estimate_91",
                    "capturePolicyId": "cap_project_changes",
                    "collectionSource": "governed-change-test",
                },
            ),
            {
                "activityEpisodeId": "episode_20260623_1000_usr_admin",
                "authContextId": "authctx_123_v4",
                "authSessionId": "ses_123",
                "capturePolicyId": "cap_project_changes",
                "causationEventId": "evt_previous_trigger",
                "changeId": "chg_project_estimate_91",
                "collectionSource": "governed-change-test",
                "correlationId": "workflow_project_estimate",
                "safe": True,
                "traceId": "trc_01jz_estimate",
            },
        )

    def test_create_governed_change_draft_derives_minimized_revision_evidence(self):
        project_entry = define_entity(
            authority="acme.billing",
            entity_type="project_entry",
            schema_ref="acme.billing/project_entry@3",
            field_set_ref="project-entry-governed-fields@2",
            identity=lambda row: row["id"],
            fields={
                "quantity": {"capture": "full"},
                "monthlyPrice": {"capture": "full"},
                "updatedAt": {"capture": "full"},
                "customerEmail": {"capture": "keyed_digest"},
                "temporaryCache": {"capture": "omit"},
            },
        )

        draft = create_governed_change_draft(
            {
                "scope": SCOPE,
                "entity": project_entry,
                "before": {
                    "id": "42",
                    "quantity": 10,
                    "monthlyPrice": 142800,
                    "updatedAt": datetime(2026, 6, 23, 10, 17, tzinfo=timezone.utc),
                    "customerEmail": "buyer@example.com",
                    "temporaryCache": "hot",
                },
                "after": {
                    "id": "42",
                    "quantity": 11,
                    "monthlyPrice": 148220,
                    "updatedAt": datetime(2026, 6, 23, 10, 18, tzinfo=timezone.utc),
                    "customerEmail": "buyer@example.com",
                    "temporaryCache": "warm",
                },
                "changedPaths": ["/quantity", "/monthlyPrice"],
                "change": {
                    "id": "chg_project_estimate_91",
                    "type": "project.estimate.recalculation",
                    "initiatedBy": INITIATED_BY,
                },
                "activity": {
                    "id": "act_calculation_91",
                    "type": "computation.project_cost_estimate",
                    "performedBy": {"authority": "acme.ai", "kind": "principal", "type": "ai_agent", "id": "cost_agent_7"},
                },
                "producer": PRODUCER,
                "occurredAt": "2026-06-23T10:18:00.000Z",
                "idempotencyKeyHash": "sha256:governed-change-test",
                "context": {"changeId": "chg_project_estimate_91", "traceId": "trc_01jz_estimate", "collectionSource": "test"},
                "capturePolicyRef": {"id": "cap_project_changes", "version": "3"},
                "digestKeys": {"keyedDigest": {"keyVersion": "tenant-key-7", "secret": "test-hmac-secret"}},
            }
        )

        self.assertEqual(draft["outboxEntry"]["mutationBinding"], "not_transaction_bound")
        # An update with no caller-supplied parent leaves lineage open — no
        # synthetic rev_..._previous parent is fabricated.
        self.assertNotIn("expectedParentRevisionRef", draft["outboxEntry"])
        self.assertEqual(draft["revision"]["parents"], [])
        self.assertEqual(draft["events"][0]["metadata"]["captureAssurance"], {
            "captureMethod": "transactional_outbox",
            "mutationBinding": "not_transaction_bound",
        })
        self.assertEqual([record["action"] for record in draft["outboxEntry"]["records"]], [
            "change.declared",
            "activity.recorded",
            "entity.revision.created",
        ])
        fields = draft["revision"]["stateCommitment"]["fields"]
        self.assertEqual(fields["quantity"], 11)
        self.assertEqual(fields["monthlyPrice"], 148220)
        self.assertEqual(fields["updatedAt"], "2026-06-23T10:18:00.000Z")
        self.assertEqual(fields["customerEmail"]["algorithm"], "hmac-sha256")
        self.assertEqual(fields["customerEmail"]["keyVersion"], "tenant-key-7")
        self.assertNotIn("buyer@example.com", json.dumps(fields))
        self.assertNotIn("test-hmac-secret", json.dumps(fields))
        self.assertNotIn("temporaryCache", json.dumps(fields))
        self.assertEqual([edge["relation"] for edge in draft["edges"]], [
            "has_activity",
            "has_output",
            "performed_by",
            "generated",
        ])
        revision_event = create_audit_event(draft["events"][2])
        self.assertEqual(
            revision_event["metadata"]["veritio"]["revision"]["stateCommitment"]["fields"]["customerEmail"],
            fields["customerEmail"],
        )

    def test_create_governed_change_draft_links_parent_only_when_supplied(self):
        entry = define_entity(
            authority="acme.billing",
            entity_type="project_entry",
            schema_ref="acme.billing/project_entry@3",
            field_set_ref="project-entry-governed-fields@2",
            identity=lambda row: row["id"],
            fields={"quantity": {"capture": "full"}},
        )
        expected_parent = {
            "authority": "veritio",
            "kind": "revision",
            "type": "project_entry",
            "id": "rev_project_entry_42_0a1b2c3d4e5f",
        }
        draft = create_governed_change_draft(
            {
                "scope": SCOPE,
                "entity": entry,
                "before": {"id": "42", "quantity": 10},
                "after": {"id": "42", "quantity": 11},
                "changedPaths": ["/quantity"],
                "change": {"id": "chg_supplied", "type": "project.estimate.recalculation", "initiatedBy": INITIATED_BY},
                "activity": {"id": "act_supplied", "type": "computation.project_cost_estimate", "performedBy": PRODUCER},
                "producer": PRODUCER,
                "occurredAt": "2026-06-23T10:18:00.000Z",
                "idempotencyKeyHash": "sha256:supplied-parent",
                "expectedParentRevisionRef": expected_parent,
            }
        )
        self.assertEqual(draft["revision"]["parents"], [expected_parent])
        self.assertEqual(draft["outboxEntry"]["expectedParentRevisionRef"], expected_parent)
        derived = next(edge for edge in draft["edges"] if edge["relation"] == "derived_from")
        self.assertEqual(derived["metadata"]["toRef"], expected_parent)

    def test_create_governed_change_draft_create_has_no_parent(self):
        entry = define_entity(
            authority="acme.billing",
            entity_type="project_entry",
            schema_ref="acme.billing/project_entry@3",
            field_set_ref="project-entry-governed-fields@2",
            identity=lambda row: row["id"],
            fields={"quantity": {"capture": "full"}},
        )
        draft = create_governed_change_draft(
            {
                "scope": SCOPE,
                "entity": entry,
                "after": {"id": "42", "quantity": 11},
                "changedPaths": ["/quantity"],
                "change": {"id": "chg_create", "type": "project.estimate.created", "initiatedBy": INITIATED_BY},
                "activity": {"id": "act_create", "type": "computation.project_cost_estimate", "performedBy": PRODUCER},
                "producer": PRODUCER,
                "occurredAt": "2026-06-23T10:18:00.000Z",
                "idempotencyKeyHash": "sha256:create",
            }
        )
        self.assertEqual(draft["revision"]["parents"], [])
        self.assertNotIn("expectedParentRevisionRef", draft["outboxEntry"])
        self.assertFalse(any(edge["relation"] == "derived_from" for edge in draft["edges"]))

    def test_create_governed_change_draft_rejects_invalid_timestamp(self):
        project_entry = define_entity(
            authority="acme.billing",
            entity_type="project_entry",
            schema_ref="acme.billing/project_entry@3",
            field_set_ref="project-entry-governed-fields@2",
            identity=lambda row: row["id"],
            fields={},
        )

        with self.assertRaisesRegex(ValueError, "occurredAt must be a valid date"):
            create_governed_change_draft(
                {
                    "scope": SCOPE,
                    "entity": project_entry,
                    "after": {"id": "42"},
                    "changedPaths": [],
                    "change": {"id": "chg_invalid_date", "type": "project.invalid", "initiatedBy": INITIATED_BY},
                    "activity": {"id": "act_invalid_date", "type": "project.invalid", "performedBy": PRODUCER},
                    "producer": PRODUCER,
                    "occurredAt": "not-a-date",
                    "idempotencyKeyHash": "sha256:invalid-date",
                }
            )

    def test_create_governed_change_draft_fails_closed_for_unsupported_capture_mode(self):
        project_entry = define_entity(
            authority="acme.billing",
            entity_type="project_entry",
            schema_ref="acme.billing/project_entry@3",
            field_set_ref="project-entry-governed-fields@2",
            identity=lambda row: row["id"],
            fields={"sensitiveRef": {"capture": "reference"}},
        )

        with self.assertRaisesRegex(TypeError, "capture mode reference is not supported"):
            create_governed_change_draft(
                {
                    "scope": SCOPE,
                    "entity": project_entry,
                    "after": {"id": "42", "sensitiveRef": "external-secret-ref"},
                    "changedPaths": ["/sensitiveRef"],
                    "change": {"id": "chg_unsupported_capture", "type": "project.unsupported_capture", "initiatedBy": INITIATED_BY},
                    "activity": {"id": "act_unsupported_capture", "type": "project.unsupported_capture", "performedBy": PRODUCER},
                    "producer": PRODUCER,
                    "occurredAt": "2026-06-23T10:18:00.000Z",
                    "idempotencyKeyHash": "sha256:unsupported-capture",
                }
            )


class GovernedActionDraftTests(unittest.TestCase):
    def project_entry(self):
        return define_entity(
            authority="acme.billing",
            entity_type="project_entry",
            schema_ref="acme.billing/project_entry@3",
            field_set_ref="project-entry-governed-fields@2",
            identity=lambda row: row["id"],
            fields={
                "quantity": {"capture": "full"},
                "status": {"capture": "full"},
                "customerEmail": {"capture": "keyed_digest"},
                "temporaryCache": {"capture": "omit"},
            },
        )

    def test_create_governed_action_draft_derives_ids_hash_and_changed_paths(self):
        draft = create_governed_action_draft(
            {
                "scope": SCOPE,
                "entity": self.project_entry(),
                "before": {"id": "42", "quantity": 10, "status": "active", "customerEmail": "buyer@example.com"},
                "after": {"id": "42", "quantity": 11, "status": "archived", "customerEmail": "buyer@example.com"},
                "actionType": "project.updated",
                "activityType": "project.update",
                "initiatedBy": INITIATED_BY,
                "performedBy": PRODUCER,
                "producer": PRODUCER,
                "occurredAt": "2026-06-23T10:18:00.000Z",
                "idempotencyKey": "project:42:v2",
                "metadata": {"surface": "api"},
                "digestKeys": {"keyedDigest": {"keyVersion": "tenant-key-7", "secret": "test-hmac-secret"}},
            }
        )

        self.assertRegex(draft["changeRef"]["id"], r"^chg_project_entry_42_[a-f0-9]{16}$")
        self.assertEqual(draft["activityRef"]["id"], draft["changeRef"]["id"].replace("chg_", "act_", 1))
        self.assertEqual(draft["revision"]["changedPaths"], ["/quantity", "/status"])
        self.assertEqual(draft["events"][0]["metadata"]["idempotencyKeyHash"], hash_idempotency_key(SCOPE["tenantId"], "project:42:v2"))
        encoded = json.dumps(draft["outboxEntry"])
        self.assertNotIn("buyer@example.com", encoded)
        self.assertNotIn("test-hmac-secret", encoded)

    def test_create_governed_action_draft_rejects_noop_updates(self):
        with self.assertRaisesRegex(TypeError, "at least one governed field must change"):
            create_governed_action_draft(
                {
                    "scope": SCOPE,
                    "entity": self.project_entry(),
                    "before": {"id": "42", "quantity": 10, "status": "active", "customerEmail": "buyer@example.com"},
                    "after": {"id": "42", "quantity": 10, "status": "active", "customerEmail": "buyer@example.com"},
                    "actionType": "project.updated",
                    "activityType": "project.update",
                    "initiatedBy": INITIATED_BY,
                    "performedBy": PRODUCER,
                    "producer": PRODUCER,
                    "idempotencyKey": "project:42:no-op",
                    "digestKeys": {"keyedDigest": {"keyVersion": "tenant-key-7", "secret": "test-hmac-secret"}},
                }
            )

    def test_create_governed_action_draft_honors_explicit_changed_paths(self):
        draft = create_governed_action_draft(
            {
                "scope": SCOPE,
                "entity": self.project_entry(),
                "before": {"id": "42", "quantity": 10, "status": "active", "customerEmail": "buyer@example.com"},
                "after": {"id": "42", "quantity": 10, "status": "active", "customerEmail": "buyer@example.com"},
                "changedPaths": ["/derivedEstimate"],
                "actionType": "project.estimate.recalculated",
                "activityType": "project.estimate.recalculation",
                "initiatedBy": INITIATED_BY,
                "performedBy": PRODUCER,
                "producer": PRODUCER,
                "idempotencyKey": "project:42:derived",
                "digestKeys": {"keyedDigest": {"keyVersion": "tenant-key-7", "secret": "test-hmac-secret"}},
            }
        )

        self.assertEqual(draft["revision"]["changedPaths"], ["/derivedEstimate"])

    def test_matches_the_cross_language_governed_action_fixture(self):
        from pathlib import Path

        fixture = json.loads(
            (Path(__file__).resolve().parents[3] / "spec" / "conformance" / "governed-action-draft.json").read_text(
                encoding="utf-8"
            )
        )
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                entity_input = case["input"]["entity"]
                entity = define_entity(
                    authority=entity_input["authority"],
                    entity_type=entity_input["type"],
                    schema_ref=entity_input["schemaRef"],
                    field_set_ref=entity_input["fieldSetRef"],
                    identity=lambda row, field=entity_input["identityField"]: row[field],
                    fields=entity_input["fields"],
                )
                draft = create_governed_action_draft({**case["input"], "entity": entity})
                self.assertEqual(draft["changeRef"]["id"], case["expected"]["changeId"])
                self.assertEqual(draft["activityRef"]["id"], case["expected"]["activityId"])
                self.assertEqual(draft["revision"]["changedPaths"], case["expected"]["changedPaths"])
                self.assertEqual(draft["events"][0]["metadata"]["idempotencyKeyHash"], case["expected"]["idempotencyKeyHash"])
                self.assertEqual([event["action"] for event in draft["events"]], case["expected"]["eventActions"])
                self.assertEqual([edge["relation"] for edge in draft["edges"]], case["expected"]["edgeRelations"])

class GovernedRevisionIdTests(unittest.TestCase):
    def test_matches_the_cross_language_conformance_fixture(self):
        from pathlib import Path

        fixture = json.loads(
            (Path(__file__).resolve().parents[3] / "spec" / "conformance" / "governed-revision-id.json").read_text(
                encoding="utf-8"
            )
        )
        for case in fixture["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(
                    governed_revision_id(case["entityType"], case["entityId"], case["stateDigest"], case["changeId"]),
                    case["expected"],
                )

    def test_rollback_to_identical_state_yields_distinct_id_and_replay_is_idempotent(self):
        entry = define_entity(
            authority="acme.billing",
            entity_type="project_entry",
            schema_ref="acme.billing/project_entry@3",
            field_set_ref="project-entry-governed-fields@2",
            identity=lambda row: row["id"],
            fields={"quantity": {"capture": "full"}},
        )

        def draft_for(change_id):
            return create_governed_change_draft(
                {
                    "scope": SCOPE,
                    "entity": entry,
                    "before": {"id": "42", "quantity": 10},
                    "after": {"id": "42", "quantity": 11},
                    "changedPaths": ["/quantity"],
                    "change": {"id": change_id, "type": "project.estimate.recalculation", "initiatedBy": INITIATED_BY},
                    "activity": {
                        "id": "act_roll",
                        "type": "computation.project_cost_estimate",
                        "performedBy": PRODUCER,
                    },
                    "producer": PRODUCER,
                    "occurredAt": "2026-06-23T10:18:00.000Z",
                    "idempotencyKeyHash": "sha256:rollback-test",
                }
            )

        first = draft_for("chg_a")
        rollback = draft_for("chg_b")
        replay = draft_for("chg_a")

        # Identical governed state (same commitment digest) ...
        self.assertEqual(
            rollback["revision"]["stateCommitment"]["digest"], first["revision"]["stateCommitment"]["digest"]
        )
        # ... but a DIFFERENT change must never merge into the same revision node.
        self.assertNotEqual(rollback["revision"]["ref"]["id"], first["revision"]["ref"]["id"])
        # Replaying the same change stays idempotent.
        self.assertEqual(replay["revision"]["ref"]["id"], first["revision"]["ref"]["id"])


if __name__ == "__main__":
    unittest.main()

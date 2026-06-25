import json
import unittest
from datetime import datetime, timezone

from veritio import (
    create_audit_event,
    create_governed_change_draft,
    define_entity,
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


if __name__ == "__main__":
    unittest.main()

import unittest

from fastapi.testclient import TestClient

from app.main import create_app


class FastAPIGovernedCrudTests(unittest.TestCase):
    def test_project_crud_records_audit_events_and_graph_edges(self) -> None:
        """CRUD routes should append tenant-scoped audit records and graph edges."""
        client = TestClient(create_app())

        created = client.post("/projects", json={"name": "Retention inbox"}).json()
        self.assertEqual(created["name"], "Retention inbox")

        updated = client.put(f"/projects/{created['id']}", json={"status": "reviewing"}).json()
        self.assertEqual(updated["status"], "reviewing")

        deleted = client.delete(f"/projects/{created['id']}").json()
        self.assertEqual(deleted["deleted"], True)

        evidence = client.get("/evidence").json()
        self.assertEqual(
            [record["event"]["action"] for record in evidence["auditRecords"]],
            [
                "change.declared",
                "activity.recorded",
                "entity.revision.created",
                "change.declared",
                "activity.recorded",
                "entity.revision.created",
                "change.declared",
                "activity.recorded",
                "entity.revision.created",
            ],
        )
        self.assertEqual(
            [edge["edge"]["relation"] for edge in evidence["edgeRecords"]],
            [
                "has_activity",
                "has_output",
                "performed_by",
                "generated",
                "has_activity",
                "has_output",
                "performed_by",
                "generated",
                "has_activity",
                "has_output",
                "performed_by",
                "generated",
            ],
        )
        self.assertEqual(evidence["auditVerification"], {"ok": True})
        self.assertEqual(evidence["edgeVerification"], {"ok": True})
        self.assertEqual(evidence["commitVerification"], {"ok": True})
        self.assertEqual([commit["recordCount"] for commit in evidence["commitRecords"]], [7, 7, 7])
        self.assertEqual(evidence["auditRecords"][0]["event"]["scope"]["tenantId"], "tenant_demo")
        self.assertEqual(evidence["auditRecords"][0]["event"]["actor"]["id"], "veritio.example.fastapi.auth:user_demo")
        self.assertEqual(evidence["auditRecords"][0]["event"]["metadata"]["projectNameHash"].startswith("sha256:"), True)

    def test_governed_lifecycle_scenario_records_broad_helper_driven_graph(self) -> None:
        """The showcase scenario should use SDK templates, country metadata, and multi-hop graph edges."""
        client = TestClient(create_app())

        scenario = client.post("/scenarios/governed-lifecycle").json()
        self.assertGreaterEqual(scenario["eventCount"], 8)
        self.assertGreaterEqual(scenario["edgeCount"], 10)
        self.assertEqual(scenario["commitRecordCount"], scenario["eventCount"] + scenario["edgeCount"])
        self.assertEqual(scenario["commitVerification"], {"ok": True})
        self.assertTrue(scenario["canonicalPlanHash"].startswith("sha256:"))

        evidence = client.get("/evidence").json()
        actions = [record["event"]["action"] for record in evidence["auditRecords"]]
        self.assertIn("auth.session.created", actions)
        self.assertIn("org.created", actions)
        self.assertIn("consent.granted", actions)
        self.assertIn("data.subject.request.created", actions)
        self.assertIn("export.bundle.created", actions)
        self.assertIn("retention.policy.applied", actions)

        auth_record = next(record for record in evidence["auditRecords"] if record["event"]["action"] == "auth.session.created")
        location = auth_record["event"]["metadata"]["securityContext"]["location"]
        self.assertEqual(location, {"country": "US", "region": "CA"})

        relations = [record["edge"]["relation"] for record in evidence["edgeRecords"]]
        for relation in ["subject_of", "processed_for", "retained_under", "exports", "sent_to", "attests_to"]:
            self.assertIn(relation, relations)

        self.assertEqual(evidence["auditVerification"], {"ok": True})
        self.assertEqual(evidence["edgeVerification"], {"ok": True})
        self.assertEqual(evidence["commitVerification"], {"ok": True})
        self.assertEqual(evidence["commitRecords"][0]["commitId"], "cmt_governed_lifecycle_demo")


if __name__ == "__main__":
    unittest.main()

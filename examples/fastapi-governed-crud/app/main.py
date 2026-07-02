from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from veritio import (
    HASH_ALGORITHM,
    audit_log_classification_metadata,
    auth_session_created_template,
    canonical_json,
    consent_granted_template,
    create_audit_event,
    create_evidence_commit,
    create_evidence_edge,
    data_subject_request_created_template,
    export_bundle_created_template,
    hash_audit_record,
    hash_evidence_edge_record,
    hash_idempotency_key,
    organization_created_template,
    organization_member_invited_template,
    organization_member_joined_template,
    retention_policy_applied_template,
    verify_evidence_commits,
    with_risk_signals,
)

CANONICALIZATION = "veritio-json-v1"


class ProjectCreate(BaseModel):
    """Request body for creating a project without accepting actor or tenant ids."""

    name: str = Field(min_length=1, max_length=80)


class ProjectUpdate(BaseModel):
    """Request body for state changes that should be auditable as project updates."""

    status: str = Field(min_length=1, max_length=40)


class DemoState:
    """Holds local CRUD state plus append-only evidence chains for one demo tenant."""

    def __init__(self) -> None:
        self.tenant_id = "tenant_demo"
        self.actor_user_id = "user_demo"
        self.projects: dict[str, dict[str, Any]] = {}
        self.audit_records: list[dict[str, Any]] = []
        self.edge_records: list[dict[str, Any]] = []
        self.commit_records: list[dict[str, Any]] = []

    def append_project_evidence(self, action: str, relation: str, project: dict[str, Any], request_id: str) -> None:
        """Append matching audit and graph records plus one EvidenceCommit for a CRUD action."""
        audit_event = create_audit_event(
            {
                "actor": {"type": "user", "id": self.actor_user_id},
                "action": action,
                "target": {"type": "project", "id": project["id"]},
                "scope": {"tenantId": self.tenant_id, "environment": "reference"},
                "requestId": request_id,
                "purpose": "project_governance",
                "lawfulBasis": "contract",
                "dataCategories": ["project_metadata"],
                "retention": "audit_1y",
                "metadata": {
                    "status": project["status"],
                    "projectNameHash": stable_hash(project["name"]),
                    "source": "fastapi-governed-crud",
                },
            }
        )
        audit_record = build_audit_record(self.audit_records, audit_event, request_id, self.tenant_id)
        self.audit_records.append(audit_record)

        edge = create_evidence_edge(
            {
                "scope": {"tenantId": self.tenant_id, "environment": "reference"},
                "from": {"type": "actor", "id": self.actor_user_id, "actorType": "user"},
                "relation": relation,
                "to": {"type": "resource", "id": project["id"], "resourceType": "project"},
                "metadata": {
                    "action": action,
                    "requestId": request_id,
                    "status": project["status"],
                },
            }
        )
        edge_record = build_edge_record(self.edge_records, edge, request_id, self.tenant_id)
        self.edge_records.append(edge_record)
        self.append_commit(
            commit_id=f"cmt_{project['id']}_{relation}",
            stream_id=f"str_{self.tenant_id}_project_mutations",
            audit_records=[audit_record],
            edge_records=[edge_record],
        )

    def append_template_event(self, event_input: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        """Normalize a helper-produced audit input and append it to the local audit chain."""
        event = create_audit_event(event_input)
        record = build_audit_record(self.audit_records, event, idempotency_key, self.tenant_id)
        self.audit_records.append(record)
        return record

    def append_edge(self, edge_input: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        """Normalize an example graph edge and append it to the local edge chain."""
        edge = create_evidence_edge(edge_input)
        record = build_edge_record(self.edge_records, edge, idempotency_key, self.tenant_id)
        self.edge_records.append(record)
        return record

    def append_commit(
        self,
        commit_id: str,
        stream_id: str,
        audit_records: list[dict[str, Any]],
        edge_records: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Append an EvidenceCommit that binds already appended local record envelopes."""
        previous_commit = next((commit for commit in reversed(self.commit_records) if commit["streamId"] == stream_id), None)
        members = [
            *[
                {
                    "index": index,
                    "recordType": "audit.record",
                    "recordId": record["event"]["id"],
                    "recordHash": f"sha256:{record['hash']}",
                }
                for index, record in enumerate(audit_records)
            ],
            *[
                {
                    "index": len(audit_records) + index,
                    "recordType": "evidence.edge.record",
                    "recordId": record["edge"]["id"],
                    "recordHash": f"sha256:{record['hash']}",
                }
                for index, record in enumerate(edge_records)
            ],
        ]
        commit = create_evidence_commit(
            {
                "commitId": commit_id,
                "streamId": stream_id,
                "sequence": (previous_commit["sequence"] if previous_commit else 0) + 1,
                "previousCommitHash": previous_commit["hash"] if previous_commit else None,
                "members": members,
            }
        )
        self.commit_records.append(commit)
        return commit

    def run_governed_lifecycle_scenario(self) -> dict[str, Any]:
        """Record a realistic multi-step governed system flow using SDK helper templates."""
        scope = {"tenantId": self.tenant_id, "environment": "reference"}
        actor = {"type": "user", "id": self.actor_user_id}
        service = {"type": "system", "id": "system_exports"}
        plan = {
            "scenario": "governed_lifecycle",
            "tenantId": self.tenant_id,
            "subjectId": "subject_demo",
            "country": "US",
            "region": "CA",
            "steps": [
                "auth_session",
                "organization_bootstrap",
                "membership",
                "consent",
                "subject_request",
                "export",
                "retention",
                "processor_transfer",
            ],
        }
        canonical_plan_hash = stable_hash(canonical_json(plan))
        classifier = audit_log_classification_metadata(visibility="external", surface="api")

        event_inputs = [
            auth_session_created_template(
                user_id=self.actor_user_id,
                session_id="session_demo_us_ca",
                scope=scope,
                request_id="scenario:auth-session",
                security_context={
                    "ipAddressHash": stable_hash("203.0.113.42"),
                    "userAgentHash": stable_hash("demo-browser"),
                    "location": {"country": "US", "region": "CA", "city": "San Francisco"},
                    "method": "password",
                    "provider": "better-auth",
                },
                metadata=with_risk_signals(
                    {**classifier, "canonicalPlanHash": canonical_plan_hash},
                    {"operationType": "create", "reversibility": "recoverable", "envCriticality": "production"},
                ),
            ),
            organization_created_template(
                organization_id=self.tenant_id,
                organization_display="Demo Tenant",
                actor=actor,
                scope=scope,
                request_id="scenario:org-created",
                metadata=classifier,
            ),
            organization_member_invited_template(
                organization_id=self.tenant_id,
                invitation_id="invite_ops_reviewer",
                inviter=actor,
                role=["admin", "privacy_reviewer"],
                scope=scope,
                request_id="scenario:member-invited",
                metadata=audit_log_classification_metadata(visibility="internal", surface="app"),
            ),
            organization_member_joined_template(
                organization_id=self.tenant_id,
                member_id="member_ops_reviewer",
                actor=actor,
                role=["admin", "privacy_reviewer"],
                scope=scope,
                request_id="scenario:member-joined",
                metadata=audit_log_classification_metadata(visibility="internal", surface="app"),
            ),
            consent_granted_template(
                actor=actor,
                consent_id="consent_marketing_demo",
                subject_id="subject_demo",
                purpose_id="purpose_product_updates",
                scope=scope,
                request_id="scenario:consent-granted",
                data_categories=["account", "preferences", "usage"],
                metadata=classifier,
            ),
            data_subject_request_created_template(
                actor=actor,
                subject_request_id="dsr_export_demo",
                request_type="access_export",
                subject_id="subject_demo",
                scope=scope,
                request_id="scenario:subject-request",
                metadata=classifier,
            ),
            export_bundle_created_template(
                actor=service,
                export_bundle_id="export_bundle_demo",
                format="jsonl",
                scope=scope,
                request_id="scenario:export-created",
                metadata={**classifier, "canonicalPlanHash": canonical_plan_hash},
            ),
            retention_policy_applied_template(
                actor=service,
                policy_id="policy_security_1y",
                resource_id="project_demo",
                scope=scope,
                request_id="scenario:retention-applied",
                metadata=audit_log_classification_metadata(visibility="system", surface="worker"),
            ),
        ]

        first_event_sequence = len(self.audit_records)
        event_records = []
        for event_input in event_inputs:
            event_records.append(
                self.append_template_event(event_input, f"scenario:event:{event_input['action']}:{event_input['target']['id']}")
            )

        edge_inputs = [
            graph_edge("actor", self.actor_user_id, "created", "resource", self.tenant_id, "organization", scope, canonical_plan_hash),
            graph_edge("actor", self.actor_user_id, "created", "consent", "consent_marketing_demo", None, scope, canonical_plan_hash),
            graph_edge("consent", "consent_marketing_demo", "subject_of", "data_subject", "subject_demo", None, scope, canonical_plan_hash),
            graph_edge("data_subject", "subject_demo", "processed_for", "purpose", "purpose_product_updates", None, scope, canonical_plan_hash),
            graph_edge("resource", "project_demo", "retained_under", "policy", "policy_security_1y", None, scope, canonical_plan_hash),
            graph_edge("subject_request", "dsr_export_demo", "subject_of", "data_subject", "subject_demo", None, scope, canonical_plan_hash),
            graph_edge("export_bundle", "export_bundle_demo", "exports", "subject_request", "dsr_export_demo", None, scope, canonical_plan_hash),
            graph_edge("export_bundle", "export_bundle_demo", "sent_to", "processor", "processor_secure_mail", None, scope, canonical_plan_hash),
            graph_edge("system", "system_exports", "attests_to", "export_bundle", "export_bundle_demo", None, scope, canonical_plan_hash),
            graph_edge("resource", "project_demo", "part_of", "resource", self.tenant_id, "organization", scope, canonical_plan_hash),
        ]
        edge_records = []
        for edge_input in edge_inputs:
            edge_records.append(self.append_edge(edge_input, f"scenario:edge:{edge_input['relation']}:{edge_input['to']['id']}"))
        commit = self.append_commit(
            commit_id="cmt_governed_lifecycle_demo",
            stream_id=f"str_{self.tenant_id}_governed_lifecycle",
            audit_records=event_records,
            edge_records=edge_records,
        )

        return {
            "scenario": "governed_lifecycle",
            "canonicalPlanHash": canonical_plan_hash,
            "eventCount": len(self.audit_records) - first_event_sequence,
            "edgeCount": len(edge_inputs),
            "commitId": commit["commitId"],
            "commitRecordCount": commit["recordCount"],
            "auditVerification": verify_records(self.audit_records, "event"),
            "edgeVerification": verify_records(self.edge_records, "edge"),
            "commitVerification": verify_evidence_commits(self.commit_records),
        }


def create_app(state: DemoState | None = None) -> FastAPI:
    """Create the FastAPI app with server-owned tenant and actor resolution."""
    demo_state = state or DemoState()
    app = FastAPI(title="Veritio FastAPI governed CRUD showcase")

    @app.post("/projects", status_code=201)
    def create_project(input_body: ProjectCreate) -> dict[str, Any]:
        """Create a project and record the governed creation as audit and graph evidence."""
        project = {
            "id": f"project_{uuid.uuid4().hex[:12]}",
            "name": input_body.name,
            "status": "active",
        }
        demo_state.projects[project["id"]] = project
        demo_state.append_project_evidence("project.created", "created", project, f"req_{uuid.uuid4().hex}")
        return project

    @app.put("/projects/{project_id}")
    def update_project(project_id: str, input_body: ProjectUpdate) -> dict[str, Any]:
        """Update a project status and record the mutation without trusting client tenant scope."""
        project = demo_state.projects.get(project_id)
        if project is None:
            raise HTTPException(status_code=404, detail="project not found")
        project["status"] = input_body.status
        demo_state.append_project_evidence("project.updated", "modified", project, f"req_{uuid.uuid4().hex}")
        return project

    @app.delete("/projects/{project_id}")
    def delete_project(project_id: str) -> dict[str, Any]:
        """Delete a project and preserve the deletion as a tenant-scoped evidence edge."""
        project = demo_state.projects.pop(project_id, None)
        if project is None:
            raise HTTPException(status_code=404, detail="project not found")
        project["status"] = "deleted"
        demo_state.append_project_evidence("project.deleted", "deleted", project, f"req_{uuid.uuid4().hex}")
        return {"id": project_id, "deleted": True}

    @app.get("/evidence")
    def read_evidence() -> dict[str, Any]:
        """Return local evidence records so tests and readers can inspect the governed flow."""
        return {
            "tenantId": demo_state.tenant_id,
            "auditRecords": demo_state.audit_records,
            "edgeRecords": demo_state.edge_records,
            "commitRecords": demo_state.commit_records,
            "auditVerification": verify_records(demo_state.audit_records, "event"),
            "edgeVerification": verify_records(demo_state.edge_records, "edge"),
            "commitVerification": verify_evidence_commits(demo_state.commit_records),
        }

    @app.post("/scenarios/governed-lifecycle")
    def run_governed_lifecycle() -> dict[str, Any]:
        """Run a larger real-life evidence scenario using SDK templates and graph helpers."""
        return demo_state.run_governed_lifecycle_scenario()

    return app


def graph_edge(
    from_type: str,
    from_id: str,
    relation: str,
    to_type: str,
    to_id: str,
    resource_type: str | None,
    scope: dict[str, str],
    canonical_plan_hash: str,
) -> dict[str, Any]:
    """Build a graph edge input with stable metadata shared by the scenario edges."""
    to_entity: dict[str, Any] = {"type": to_type, "id": to_id}
    if resource_type is not None:
        to_entity["resourceType"] = resource_type
    return {
        "scope": scope,
        "from": {"type": from_type, "id": from_id},
        "relation": relation,
        "to": to_entity,
        "metadata": {
            "source": "fastapi-governed-lifecycle",
            "canonicalPlanHash": canonical_plan_hash,
        },
    }


def build_audit_record(
    existing_records: list[dict[str, Any]],
    event: dict[str, Any],
    idempotency_key: str,
    tenant_id: str,
) -> dict[str, Any]:
    """Build one local audit-record envelope using the same hash fields as storage adapters."""
    previous_hash = existing_records[-1]["hash"] if existing_records else None
    record = {
        "event": event,
        "sequence": len(existing_records) + 1,
        "previousHash": previous_hash,
        "hashAlgorithm": HASH_ALGORITHM,
        "canonicalization": CANONICALIZATION,
        "appendedAt": now_iso(),
        "idempotencyKeyHash": hash_idempotency_key(tenant_id, idempotency_key),
    }
    record["hash"] = hash_audit_record(record)
    return record


def build_edge_record(
    existing_records: list[dict[str, Any]],
    edge: dict[str, Any],
    idempotency_key: str,
    tenant_id: str,
) -> dict[str, Any]:
    """Build one local edge-record envelope to show the separate graph hash chain."""
    previous_hash = existing_records[-1]["hash"] if existing_records else None
    record = {
        "edge": edge,
        "sequence": len(existing_records) + 1,
        "previousHash": previous_hash,
        "hashAlgorithm": HASH_ALGORITHM,
        "canonicalization": CANONICALIZATION,
        "appendedAt": now_iso(),
        "idempotencyKeyHash": hash_idempotency_key(tenant_id, f"edge:{idempotency_key}"),
    }
    record["hash"] = hash_evidence_edge_record(record)
    return record


def verify_records(records: list[dict[str, Any]], payload_key: str) -> dict[str, Any]:
    """Verify sequence, previous hash, and envelope hash for local showcase records."""
    previous_hash = None
    for index, record in enumerate(records):
        if record["sequence"] != index + 1:
            return {"ok": False, "index": index, "reason": "sequence_mismatch"}
        if record["previousHash"] != previous_hash:
            return {"ok": False, "index": index, "reason": "previous_hash_mismatch"}
        expected_hash = hash_audit_record(record) if payload_key == "event" else hash_evidence_edge_record(record)
        if record["hash"] != expected_hash:
            return {"ok": False, "index": index, "reason": "hash_mismatch"}
        previous_hash = record["hash"]
    return {"ok": True}


def stable_hash(value: str) -> str:
    """Hash display text before it enters metadata so examples avoid raw names in evidence."""
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def now_iso() -> str:
    """Return millisecond UTC timestamps matching the SDK record envelope style."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


app = create_app()

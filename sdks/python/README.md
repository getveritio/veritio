# Veritio Python SDK

Initial Python SDK for creating normalized audit events and evidence graph edges, then verifying tamper-evident hashes.

```python
from veritio import create_evidence_edge, hash_evidence_edge

edge = create_evidence_edge(
    {
        "from": {"type": "agent_session", "id": "agt_sess_123"},
        "relation": "created",
        "to": {"type": "file", "id": "file_billing_plan", "pathHash": "sha256:..."},
        "scope": {"tenantId": "org_123", "environment": "production"},
        "metadata": {"reason": "ai_agent"},
    }
)

edge_hash = hash_evidence_edge(edge)
```

Audit templates return ordinary audit-event input dictionaries for common auth,
organization, data, agent, and code-change actions:

```python
from veritio import audit_log_classification_metadata, auth_session_created_template, create_audit_event

event = create_audit_event(
    auth_session_created_template(
        user_id="usr_123",
        session_id="sess_123",
        scope={"tenantId": "org_123", "environment": "production"},
        security_context={
            "ip_address_hash": "sha256:client-ip",
            "user_agent_hash": "sha256:user-agent",
            "location": {"country": "US", "region": "CA"},
        },
        metadata=audit_log_classification_metadata(visibility="customer", surface="app"),
    )
)
```

`audit_log_classification_metadata` and `detect_audit_log_classifiers` provide
portable filters for internal/external/partner/system logs and
api/app/worker/cli/webhook surfaces. They only use metadata keys
(`logVisibility`, `logSurface`); they are not protocol fields.

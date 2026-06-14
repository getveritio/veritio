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

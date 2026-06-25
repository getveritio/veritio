# FastAPI Governed CRUD Showcase

This example shows how a Python FastAPI service can turn normal CRUD mechanics
into Veritio audit records and activity-graph edges. It is a local proof of
concept: tenant and actor identity are resolved on the server as `tenant_demo`
and `user_demo`, and records are kept in memory so the example runs without a
hosted Veritio account.

## What It Shows

- `POST /projects` records `project.created` and a `created` graph edge.
- `PUT /projects/{id}` records `project.updated` and a `modified` graph edge.
- `DELETE /projects/{id}` records `project.deleted` and a `deleted` graph edge.
- `POST /scenarios/governed-lifecycle` records a larger helper-driven scenario:
  auth session with country/region context, organization bootstrap, membership,
  consent, data-subject request, export bundle, retention policy, and processor
  transfer graph evidence.
- `GET /evidence` returns the local audit, edge, and EvidenceCommit chains plus
  verification status for all three.

Project names are represented in metadata as `projectNameHash`, not raw display
text. This keeps the example focused on stable ids, hashes, statuses, and tenant
scope.

## Why It Works

FastAPI validates request bodies, but the application owns tenant and actor
resolution. Each mutation calls `append_project_evidence`, which creates a
Veritio audit event, appends a hash-chained audit-record envelope, creates an
evidence edge, appends a separate edge-record envelope, then binds both records
in an EvidenceCommit. `GET /evidence` verifies the audit, edge, and commit
chains so readers can inspect the audit trail, activity graph, and commit
membership together.

## Run Locally

```sh
cd examples/fastapi-governed-crud
python3 -m venv .venv
. .venv/bin/activate
pip install -e .
PYTHONPATH=../../sdks/python/src:. uvicorn app.main:app --reload --port 8010
```

Then create evidence:

```sh
curl -X POST http://localhost:8010/projects \
  -H 'content-type: application/json' \
  -d '{"name":"Retention inbox"}'

curl http://localhost:8010/evidence

curl -X POST http://localhost:8010/scenarios/governed-lifecycle
```

## Test

```sh
cd examples/fastapi-governed-crud
PYTHONPATH=../../sdks/python/src:. python3 -m unittest discover -s tests
```

The test suite covers both the CRUD path and the broader lifecycle path,
including EvidenceCommit membership, `securityContext.location.country`,
canonical JSON plan hashing, consent/DSAR/export/retention helper events, and
graph relations such as `processed_for`, `retained_under`, `exports`, `sent_to`,
and `attests_to`.

## Docker

Build from the repository root so the Dockerfile can copy the local SDK:

```sh
docker build -f examples/fastapi-governed-crud/Dockerfile -t veritio-fastapi-governed-crud .
docker run --rm -p 8010:8010 veritio-fastapi-governed-crud
```

## Hosted Veritio Cloud Wiring

The example is intentionally OSS-first. To send the same evidence to Veritio
Cloud, keep the CRUD routes and server-owned tenant/actor boundary, then add an
application-owned delivery function that posts the generated records to the
hosted ingest endpoint with a project-scoped API key. Do not put hosted project
ids, API keys, or account credentials in this example directory.

# Gin Governed CRUD Showcase

This example shows a small Gin API that records Veritio audit events and
evidence graph edges for project CRUD mutations.

The demo is fully local:

- no hosted Veritio account
- no hosted project id
- no client-supplied tenant or actor scope
- no personal data in the request body

The server owns `tenant_demo` and `user_demo`, appends audit records for
`project.created`, `project.updated`, and `project.deleted`, and exposes the
current evidence chains at `GET /evidence`.

## What It Shows

- `POST /projects` records `project.created` and a `created` graph edge.
- `PUT /projects/{id}` records `project.updated` and a `modified` graph edge.
- `DELETE /projects/{id}` records `project.deleted` and a `deleted` graph edge.
- `POST /scenarios/governed-lifecycle` records a larger helper-driven scenario:
  auth session with country/region context, organization bootstrap, membership,
  consent, data-subject request, export bundle, retention policy, and processor
  transfer graph evidence.
- `GET /evidence` returns local audit and edge chains plus verification status.

Project names are represented as `projectNameHash` in event metadata. The event
target uses the stable project id only, which keeps the example focused on
server-owned identifiers, statuses, hashes, and tenant scope.

## Why It Works

The Gin handlers are only the transport layer. Each mutation calls
`recordProjectMutation`, which builds a Veritio audit event, appends an audit
record envelope, builds an evidence edge, then appends an edge-record envelope.
The audit and graph chains are verified independently so readers can see both
the chronological audit trail and the activity graph that links actor to
resource.

## Run Locally

```sh
cd examples/gin-governed-crud
go test ./...
go run .
```

The server listens on `:8080`.

Build the container from the repository root so the Dockerfile can copy both
the example and the local Go SDK:

```sh
docker build -f examples/gin-governed-crud/Dockerfile .
```

```sh
curl -X POST http://localhost:8080/projects \
  -H 'content-type: application/json' \
  -d '{"name":"Retention inbox"}'

curl -X PUT http://localhost:8080/projects/project_1 \
  -H 'content-type: application/json' \
  -d '{"status":"reviewing"}'

curl -X DELETE http://localhost:8080/projects/project_1

curl -X POST http://localhost:8080/scenarios/governed-lifecycle

curl http://localhost:8080/evidence
```

`auditVerification.ok` and `edgeVerification.ok` show whether the local
tamper-evident record chains still verify.

The `go test ./...` suite covers both CRUD and the broader lifecycle scenario,
including `SessionSecurityLocation{Country, Region}`, canonical JSON plan
hashing, consent/DSAR/export/retention helper events, and graph relations such
as `processed_for`, `retained_under`, `exports`, `sent_to`, and `attests_to`.

## Docker

Build from the repository root so the Dockerfile can copy the local SDK:

```sh
docker build -f examples/gin-governed-crud/Dockerfile -t veritio-gin-governed-crud .
docker run --rm -p 8080:8080 veritio-gin-governed-crud
```

## Hosted Veritio Cloud Wiring

The same events and edges returned by `/evidence` can be delivered to hosted
Veritio Cloud from an application-owned boundary using a project-scoped API key.
Keep hosted project ids and API keys outside this repository, inject them at the
local shell or deployment boundary, and keep `scope.tenantId` aligned to the
Cloud project id when sending hosted payloads.

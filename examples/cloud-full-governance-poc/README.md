# Veritio Cloud Payload POC

Runnable SDK coverage harness for hosted-compatible ingest/read payloads. It
covers every current SDK audit template outside the excluded agent-session and
code-change families.

This example does not prove Cloudflare deployment readiness. The OSS repo owns
the portable evidence payloads and optional HTTP smoke client; Worker, Pages,
R2, D1, key routing, and deployment configuration belong in `veritio-cloud`.

## What It Covers

Auth:

- `auth.user.created`
- `auth.session.created`
- `auth.session.revoked`
- `auth.password.reset.requested`

Organization:

- `org.created`
- `org.member.invited`
- `org.member.joined`
- `org.member.role.changed`
- `org.member.removed`

Data lifecycle:

- `consent.granted`
- `consent.revoked`
- `data.subject.request.created`
- `export.bundle.created`
- `retention.policy.applied`

Hosted-compatible control plane and machine-use action payloads:

- `project.created`
- `project.updated`
- `scoped.key.created` for machine-ingested SDK evidence, with hosted service's
  `scoped_key.created` table action preserved in metadata.
- `evidence.ingest.accepted`
- `evidence.read.events`
- `evidence.read.edges`
- `evidence.read.graph`
- `audit.log.read`
- `retention.sweep.completed`

The scoped-key coverage emits one `scoped_key.created` event for every hosted
authority: `ingest`, `read`, `export`, `admin`, `billing`, and `mcp`.

Graph relations:

- `caused_by`
- `part_of`
- `read`
- `modified`
- `created`
- `deleted`
- `derived_from`
- `attests_to`
- `exports`
- `satisfies_policy`
- `violates_policy`
- `subject_of`
- `processed_for`
- `retained_under`
- `sent_to`

The scenario also includes Better Auth-style security metadata with `US/CA`
country/region context, a deterministic canonical JSON plan hash, and every
audit classifier value: visibility `internal`, `external`, `partner`, `system`
plus surface `api`, `app`, `worker`, `cli`, and `webhook`.

## Why It Exists

The framework examples show how to wire Veritio into app servers. This example
is the broader coverage harness: it builds the complete non-agent/non-code SDK
template surface, the hosted-compatible management/read/ingest payload surface,
and can post that same payload to a deployed hosted Veritio endpoint.

The payload avoids raw personal data, raw tokens, code paths, file contents,
prompts, diffs, and agent-session records.

## Local Test

```sh
cd examples/cloud-full-governance-poc
bun install
bun run typecheck
bun test
```

## Post To A Deployed Hosted Endpoint

Create an ingest-scoped key for the hosted project, then run:

```sh
cd examples/cloud-full-governance-poc
VERITIO_CLOUD_PROJECT_ID="project-id" \
VERITIO_CLOUD_INGEST_TOKEN="vrt_..." \
bun run cloud:post
```

Optional machine read-back:

```sh
VERITIO_CLOUD_PROJECT_ID="project-id" \
VERITIO_CLOUD_INGEST_TOKEN="vrt_..." \
VERITIO_CLOUD_READ_TOKEN="vrt_..." \
bun run cloud:post
```

The script prints the run id, canonical plan hash, posted counts, ingest chain
tips, and optional read-back counts. Do not commit scoped keys; keep them in the
shell environment or a local secret manager.

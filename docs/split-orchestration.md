# Veritio Split Orchestration

Use `veritio` as the control repo for work that spans the Veritio split. The
control model keeps repo boundaries explicit while allowing one Codex session to
inspect, edit, and verify sibling repositories by path.

## Control Model

```txt
veritio/          control point + OSS source of truth
veritio-website/  sibling repo for public website and docs pages
veritio-cloud/    sibling repo for private hosted SaaS/PaaS behavior
```

`veritio` may coordinate sibling work through public docs, scripts, prompts, and
agent configuration. It must not become a source monorepo for website or hosted
implementation code.

## Central Commands

Run from `veritio`:

```sh
bun run status:split
bun run verify:split
bun run verify:siblings
```

These commands use the expected sibling layout:

- `../veritio-website`
- `../veritio-cloud`

Override paths when needed:

```sh
VERITIO_WEBSITE_DIR=/path/to/veritio-website \
VERITIO_CLOUD_DIR=/path/to/veritio-cloud \
bun run verify:split
```

## Workflow

1. Route the task with `docs/repo-map.md`.
2. Read the owning repo's guidance files before editing that repo.
3. Define or confirm public protocol and SDK behavior in `veritio` before
   implementing hosted behavior.
4. Edit only the owning repo's files.
5. Run the owning repo's verification command.
6. For multi-repo changes, finish with `bun run verify:split`.

## Review Agents

Use project-scoped reviewers when the change is non-trivial:

- `split-orchestrator` for multi-repo sequencing from `veritio`.
- `repo-routing-reviewer` for ownership and boundary checks.
- `protocol-compat-reviewer` for protocol, schema, hashing, redaction,
  canonical JSON, export, or graph changes.
- `sdk-parity-reviewer` for TypeScript/Python/Go semantic alignment.
- `adapter-boundary-reviewer` for framework adapters and server package
  boundaries.
- `privacy-redaction-reviewer` for metadata minimization and compliance wording.

## Boundary Rules

- Coordination docs may live in `veritio`.
- Public website implementation stays in `veritio-website`.
- Hosted SaaS/PaaS implementation stays in `veritio-cloud`.
- Public protocol semantics stay in `veritio`.
- Website claims wait until backing OSS or hosted behavior exists.
- No repo may claim automatic legal compliance.

## Completion Standard

A split task is not complete until:

- each edited repo has a clear verification result or an explicit skipped-check
  reason
- ownership boundaries still match `docs/repo-map.md`
- hosted-only semantics did not leak into `spec/`
- private material stayed in ignored local paths or private repos
- public copy avoids compliance guarantees

# Veritio Split Orchestration

Use `veritio` as the default Codex control repo for work that spans the split.
This avoids opening one chat per repository while preserving real repository
boundaries.

## Control Model

`veritio` may coordinate sibling work through docs, prompts, scripts, and Codex
agents. It must not become a source monorepo for website or cloud
implementation.

```txt
veritio/          control point + OSS source of truth
veritio-website/  sibling repo, edited by path when public website/docs own work
veritio-cloud/    sibling repo, edited by path when hosted SaaS/PaaS owns work
```

From a Codex session rooted at `veritio`, use absolute sibling paths or shell
`workdir` values to inspect, edit, and verify the other repos. Do not ask the
user to open separate chats unless a task explicitly needs an independent
thread or long-running parallel workflow.

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

Override paths only when needed:

```sh
VERITIO_WEBSITE_DIR=/path/to/veritio-website \
VERITIO_CLOUD_DIR=/path/to/veritio-cloud \
bun run verify:split
```

## Single-Chat Prompt

Use this prompt when you want Codex to coordinate all split repos from
`veritio`:

```text
Work from /Users/yanmalinovskiy/Projects/Personal_Projects/veritio as the
control repo.

Before changing files, read:
- AGENTS.md
- CLAUDE.md
- docs/repo-map.md
- docs/repository-spec.md
- docs/split-orchestration.md

Use repo-routing-reviewer and split-orchestrator first. If work belongs in a
sibling repo, edit that sibling by explicit path/workdir from this same chat.
Do not ask me to open separate chats unless parallel independent threads are
truly needed.

Cross-repo order:
1. Define protocol/SDK/export semantics in veritio.
2. Implement hosted behavior in veritio-cloud.
3. Publish website/docs claims in veritio-website only after backing behavior
   exists.

Verify with bun run verify:split, or a narrower split command if the task only
touches one repo.
```

## Cross-Repo Workflow

1. Route the task using `docs/repo-map.md`.
2. Read the owning repo's `AGENTS.md`, `CLAUDE.md`, and
   `docs/repository-spec.md`.
3. Spawn or use the relevant `.codex/agents` reviewers:
   - `split-orchestrator` for multi-repo sequencing from `veritio`
   - `repo-routing-reviewer` for boundary ownership
   - repo-specific reviewers for protocol, website claims, cloud security, and
     framework boundaries
4. Edit only the owning repo's files.
5. Run the owning repo's verification command.
6. For multi-repo changes, finish with `bun run verify:split`.

## Boundary Rules

- Coordination files may live in `veritio`.
- Website implementation stays in `veritio-website`.
- Hosted SaaS/PaaS implementation stays in `veritio-cloud`.
- Public protocol semantics stay in `veritio`.
- Public claims wait until backing OSS or hosted behavior exists.
- No repo may claim automatic legal compliance.

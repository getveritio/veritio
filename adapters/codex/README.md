# @veritio/codex

Capture [Codex CLI](https://github.com/openai/codex) agent activity as Veritio
evidence — passively, via the `notify` hook — with a local file sink and an
optional ingest POST to Veritio Cloud.

Codex fires a `notify` program once per turn. This adapter maps each
`agent-turn-complete` notification to a hash-chained, **redacted** evidence
trail: a session-started record and a prompt record carrying only the prompt's
**hash**. Capture is out-of-band and never blocks or disturbs the agent.

> **Privacy:** raw prompts and message contents are **never** persisted — only
> stable ids and a prompt hash travel. Redaction runs in the hook before
> anything reaches a sink.

## What is captured

| Codex notification | Veritio record |
|---|---|
| `agent-turn-complete` | `agent.session.started` + `agent.prompt.recorded` (prompt **hash** only) |

Codex notify does not report tool calls or file edits, so this adapter is
session/prompt-grained. For per-edit and per-tool provenance, run the Veritio
`Stop`-style git scan in your own tooling; a first-class Codex adapter that
reads Codex session transcripts is future work.

## Configure the notify hook

Codex has a **single** `notify` slot. If you already use one (e.g. a desktop
notifier), you MUST wrap it — never replace it. In `~/.codex/config.toml`:

```toml
notify = ["/absolute/path/to/veritio-codex-notify-wrapper.sh"]
```

with a wrapper that forwards to your existing notifier, then runs capture in
the background so it never blocks the turn:

```bash
#!/bin/bash
# your existing notifier (if any):
# "/path/to/existing/notifier" "$@" || true
nohup veritio-codex-notify "$@" >/dev/null 2>&1 &
```

If you have no existing notifier, point `notify` directly at a wrapper that
just backgrounds `veritio-codex-notify "$@"`.

`veritio login codex` (the Veritio CLI) writes this configuration for you and
mints the ingest key, so no key is pasted by hand.

## Configuration (environment)

Read only at the process boundary; no credential is embedded in the hook.

| Variable | Default | Purpose |
|---|---|---|
| `VERITIO_LOCAL_DIR` | `~/.veritio/codex` | Local evidence store directory (always written) |
| `VERITIO_TENANT_ID` | `local` | Tenant scope on every record |
| `VERITIO_ACTOR_ID` | `local_developer` | Stable id of the enforcing human (never an email) |
| `VERITIO_AGENT_ACTOR_ID` | `agent_codex` | Stable id of the agent actor |
| `VERITIO_ENVIRONMENT` | `development` | Scope environment |
| `VERITIO_WORKSPACE_ID` | — | Optional workspace scope |
| `VERITIO_INGEST_URL` + `VERITIO_INGEST_KEY` | — | If **both** set, also POST records to a Veritio ingest endpoint. The server re-redacts. |

## Cross-language parity

TypeScript-only today (matches the TS-only provenance recorder). The
notification→record mapping table above is the language-neutral contract a
future Python/Go capture adapter must reproduce, including the hash-only rule.

## Status

Experimental notify-based capture. It never uses a client-side request abort
on ingest (an aborted hosted-DB request can wedge a tenant — see the cloud
connection-timeout hardening); capture fails by returning, not by cancelling.

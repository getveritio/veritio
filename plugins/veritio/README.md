# Veritio plugin for Claude Code

Give your Claude Code sessions a **tamper-evident audit trail** — who did what,
when — recorded to Veritio Cloud, plus a hosted MCP server so you (or Claude)
can query that evidence back.

- **Passive capture** — session start/end, prompts, tool calls, and file changes
  are recorded via Claude Code hooks. **Hash-only**: raw prompts, tool inputs,
  and file contents are never stored — only stable ids and content hashes.
- **Hosted MCP** — `list_sessions` / `get_session` / `export_session` against
  your own evidence, over `https://console.getveritio.com/api/mcp`.

## Install

```
/plugin marketplace add getveritio/veritio
/plugin install veritio@veritio
```

The plugin ships **disabled by default** (it connects to a hosted service).
Enable it with `/plugin`, then connect once:

```
veritio login claude
```

`veritio login` (from the `veritio` CLI) runs a browser device-authorization
flow: you approve in the console, it mints a scoped ingest key and writes the
capture credentials — **no key is ever pasted**. The hosted MCP uses Claude
Code's built-in OAuth (approve it once in `/mcp`).

## What gets recorded

| Claude Code event | Veritio record |
|---|---|
| `SessionStart` | `agent.session.started` |
| `UserPromptSubmit` | `agent.prompt.recorded` (prompt **hash** only) |
| `PreToolUse` (Edit/Write/MultiEdit) | pre-image content hash |
| `PostToolUse` / `PostToolUseFailure` | `agent.tool.called` + code change (before/after **hashes**) |
| `Stop` | `git status` turn-scan for Bash-driven file changes |
| `SessionEnd` | finalizes session state |

Capture runs `@veritio/claude-code` via `bunx`; the credentials come from the
env written by `veritio login` (see `@veritio/claude-code` for the full env
contract). Veritio produces compliance *evidence*; it does not make you
compliant and is not legal advice.

## Requirements

- [Bun](https://bun.sh) on PATH (the capture hook runs under Bun).
- A Veritio Cloud account for the hosted sink and MCP (the OSS SDK works
  fully offline without one; this plugin is the hosted-connected path).

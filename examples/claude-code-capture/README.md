# Claude Code Capture

Runs the real `@veritio/claude-code` hook binary end to end: simulated Claude
Code hook events go in over stdin (exactly as Claude Code delivers them), a
hash-chained, **redacted** evidence trail comes out, and the session is queried
back and exported as a verifiable bundle.

## What it proves

- `SessionStart → UserPromptSubmit → PreToolUse → PostToolUse → Stop →
  SessionEnd` maps to `agent.session.started`, `agent.prompt.recorded`,
  `agent.tool.called`, and `change.files.changed` records plus provenance-graph
  edges.
- **Redaction on raw bytes:** the test greps every file in the evidence store
  and shows the raw prompt text never lands anywhere — only `sha256` hashes of
  prompts, tool inputs, and file contents travel.
- `listSessions` / `getSession` / `exportSession` recover the session summary,
  its provenance graph, and a bundle whose audit + edge hash chains verify.

`src/capture.ts` builds an isolated temp git repo and temp `VERITIO_LOCAL_DIR`,
so the simulation never touches your real `~/.veritio/claude-code` store.

## Run

```sh
bun install
bun run build   # builds the SDK + adapter dist the hook binary ships as
bun test src
```

## Use it in a real project

Install `@veritio/claude-code` and wire the same binary into your project's
`.claude/settings.json` (see the [package README](../../adapters/claude-code/README.md)
for the full hook matrix and environment variables):

```jsonc
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "bun ${CLAUDE_PROJECT_DIR}/node_modules/@veritio/claude-code/dist/hook.js" }] }]
    // ...same command for UserPromptSubmit, PreToolUse (Edit|Write|MultiEdit),
    // PostToolUse, PostToolUseFailure, Stop, SessionEnd
  }
}
```

Veritio supports evidence collection and verification workflows; it is not
legal advice.

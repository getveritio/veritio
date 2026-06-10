# Agent Setup

Veritio includes local guidance for Codex-style agents and Claude Code.

## Codex

- Root guidance: `AGENTS.md`
- Local skills: `.agents/skills/*/SKILL.md`

Use the local skills for implementation and protocol review work:

- `veritio-implement-feature`
- `veritio-protocol-review`

## Claude Code

- Root guidance: `CLAUDE.md`
- Rules: `.claude/rules/*.md`
- Review agents: `.claude/agents/*.md`
- Skills: `.claude/skills/*/SKILL.md`
- Hooks: `.claude/hooks/*.sh`

The hooks block common unsafe edits and run `bun run verify` on stop when non-doc files changed.

## Verification

Primary command:

```bash
bun run verify
```

This runs TypeScript tests, Python tests, Go tests, and TypeScript typechecking.

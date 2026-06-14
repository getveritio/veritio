# Plugin & Collaboration Discipline

Use plugins, subagents, and agent teams for coverage, not ceremony. Their output is evidence to verify and synthesize.

## Routing

- Feature work: `veritio-implement-feature`.
- Protocol/schema/hashing/redaction changes: `veritio-protocol-change`.
- Diff review before handoff: `veritio-review-diff`.
- Bugs, flakes, and cross-language divergence: `veritio-debug`.
- External review fixes: `veritio-pr-review-fix`.

## Review behavior

- Discovery first, triage second. Do not suppress plausible bugs during investigation because the user asked for a concise final answer.
- For cross-boundary or cross-language work, create an agent team early, before implementation or final review. Verify the strongest claim locally.
- Prefer plain subagents only for isolated evidence gathering, tiny one-file fixes, or when `TeamCreate` is unavailable. Otherwise default to an agent team for substantial feature work, cross-language bugs, non-trivial reviews, architecture decisions, and PR-fix cycles.
- Agent teams are enabled via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `.claude/settings.json`.
- Agent teams: 3-5 teammates, distinct lenses, disjoint write scopes, devil's-advocate lens, one active team at a time, no nested teams, lead synthesizes and cleans up.
- Useful lenses for this repo: protocol/spec compatibility, SDK parity across TS/Python/Go, privacy/redaction, adapter/server boundary, and devil's advocate.
- If a substantial task skipped agent teams, say why in the final verification summary.

## Reviewer agents

Route diff-aware review to the repo's reviewer agents:

- `protocol-compat-reviewer` — spec/SDK protocol and hashing compatibility.
- `sdk-parity-reviewer` — TypeScript/Python/Go behavior alignment.
- `privacy-redaction-reviewer` — metadata minimization, deterministic redaction, compliance-claim safety.
- `adapter-boundary-reviewer` — thin adapters, no vendor lock-in, no credentials in browser code.

Codex and CodeRabbit are verifiable reviewers, not truth. Validate each critique against current code before applying.

## Output

- Lead with impact and evidence.
- Say what was verified, what remains unverified, and what would falsify the conclusion.
- Do not equate passing tests with correctness when the bug involved a real cross-language byte/hash divergence.

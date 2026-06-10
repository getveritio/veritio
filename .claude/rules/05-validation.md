# Validation

Use the narrowest check that proves the change, then run the full gate for meaningful repo changes.

## Commands

- Full gate: `bun run verify`
- TypeScript tests: `bun run test:ts`
- Python tests: `bun run test:python`
- Go tests: `bun run test:go`
- TypeScript typecheck: `bun run typecheck`

## Handoff

- Report commands run and whether they passed.
- If a command was skipped, explain why.
- If a check fails from a pre-existing issue, show the failure boundary and avoid hiding it.

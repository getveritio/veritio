# Change Discipline

Use the minimum code that satisfies the user request, repo invariants, and verification criteria.

## Simplicity first

- Do not add features beyond what was asked.
- Do not add abstractions for single-use code.
- Do not add configurability, compatibility modes, fallbacks, or extension points unless the request or existing architecture requires them.
- Do not add error handling for impossible scenarios. Do handle realistic boundary failures by failing closed with sanitized errors.
- If the implementation becomes large, re-check whether a smaller direct change satisfies the same success criteria.
- If a senior engineer would call the solution overcomplicated, simplify before continuing.

## Surgical changes

- Touch only files and lines needed for the requested behavior.
- Do not improve adjacent code, comments, naming, formatting, or structure unless the requested change depends on it.
- Match existing style even when a different style would be preferable.
- If unrelated dead code or design debt is noticed, mention it in the handoff instead of deleting or refactoring it.
- Every changed line must trace to the user request, a proven root cause, or verification needed for that cause. If it does not, leave it out.
- Avoid "drive-by doctrine": do not add broad rules, compatibility modes, or cleanup just because the current investigation made them visible.

## Cleanup boundary

- Remove imports, variables, functions, tests, fixtures, or docs that your change made unused or obsolete.
- Do not remove pre-existing dead code unless the user asked for that cleanup or the current change makes it unsafe to leave.

#!/usr/bin/env bash
set -euo pipefail

if [[ "${VERITIO_SKIP_COMMAND_GUARD:-}" == "1" ]]; then
  exit 0
fi

input="$(cat)"
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

command_text="$(printf '%s' "$input" | jq -r '.tool_input.command // .tool_input.cmd // empty')"
if [[ -z "$command_text" ]]; then
  exit 0
fi

if printf '%s' "$command_text" | grep -Eq '(^|[;&|[:space:]])rm[[:space:]]+-rf[[:space:]]+(/|\\$HOME|~|\\.\\.)([[:space:]]|$)'; then
  echo "BLOCKED: risky rm -rf target. Set VERITIO_SKIP_COMMAND_GUARD=1 only if you really mean it." >&2
  exit 2
fi

if printf '%s' "$command_text" | grep -Eq 'git[[:space:]]+(reset[[:space:]]+--hard|checkout[[:space:]]+--|clean[[:space:]]+-fd)'; then
  echo "BLOCKED: destructive git command. Preserve user work unless explicitly instructed." >&2
  exit 2
fi

if printf '%s' "$command_text" | grep -Eq 'npm[[:space:]]+publish|bun[[:space:]]+publish|twine[[:space:]]+upload|go[[:space:]]+list[[:space:]].*@latest'; then
  echo "BLOCKED: publish/release command requires explicit user approval." >&2
  exit 2
fi

exit 0

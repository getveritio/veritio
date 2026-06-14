#!/usr/bin/env bash
# PostToolUse: auto-format TS/TSX/JS/JSON with Biome after Edit/Write/MultiEdit.
# Best-effort: never blocks, never surfaces noise on success.

set -euo pipefail

if [[ "${VERITIO_SKIP_FORMAT_HOOK:-}" == "1" ]]; then
  exit 0
fi

input="$(cat)"
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
if [[ -z "$file_path" || ! -f "$file_path" ]]; then
  exit 0
fi

project_dir="${CODEX_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$PWD}}"
case "$file_path" in
  "$project_dir"/*) ;;
  *) exit 0 ;;
esac

case "$file_path" in
  *.gen.*|*/bun.lock) exit 0 ;;
esac

rel_path="${file_path#"$project_dir"/}"
case "$rel_path" in
  node_modules/*|dist/*|sdks/python/*|sdks/go/*) exit 0 ;;
esac

case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.jsonc) ;;
  *) exit 0 ;;
esac

if ! command -v bun >/dev/null 2>&1; then
  exit 0
fi

if ! ( cd "$project_dir" && bun x @biomejs/biome format --write "$rel_path" >/dev/null 2>&1 ); then
  echo "biome-format-on-edit: skipped (formatter unavailable or exited non-zero) for ${rel_path}" >&2
fi

exit 0

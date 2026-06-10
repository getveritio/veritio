#!/usr/bin/env bash
set -euo pipefail

if [[ "${VERITIO_SKIP_GUARD_HOOK:-}" == "1" ]]; then
  exit 0
fi

input="$(cat)"
if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')"
if [[ -z "$file_path" ]]; then
  exit 0
fi

project_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
case "$file_path" in
  /*) ;;
  *) file_path="$project_dir/$file_path" ;;
esac

rel="${file_path#"$project_dir"/}"
base="$(basename "$file_path")"

case "$base" in
  .env|.env.*)
    case "$base" in
      .env.example|.env.sample|.env.template) ;;
      *)
        echo "BLOCKED: $rel is a real env file. Keep secrets and local machine state user-owned." >&2
        exit 2
        ;;
    esac
    ;;
  bun.lock|package-lock.json|yarn.lock|pnpm-lock.yaml)
    echo "BLOCKED: $rel is a lockfile. Use the package manager instead of editing by hand." >&2
    exit 2
    ;;
esac

case "$file_path" in
  *.gen.*|*.generated.*)
    echo "BLOCKED: $rel looks generated. Edit the source and regenerate." >&2
    exit 2
    ;;
esac

exit 0

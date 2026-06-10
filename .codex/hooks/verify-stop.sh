#!/usr/bin/env bash
set -euo pipefail

if [[ "${VERITIO_SKIP_VERIFY_HOOK:-}" == "1" ]]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "$PROJECT_DIR" ]]; then
  if git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    PROJECT_DIR="$git_root"
  else
    echo "verify-stop: not in a git repo; skipping verify." >&2
    exit 0
  fi
fi

cd "$PROJECT_DIR"

if git diff --quiet && git diff --cached --quiet; then
  exit 0
fi

CHANGED=$(
  {
    git diff --name-only
    git diff --cached --name-only
  } | sed '/^$/d' | sort -u
)

NON_DOC=$(printf '%s\n' "$CHANGED" | grep -Ev '(^|/)LICENSE(\..*)?$|\.(md|mdx|txt)$' || true)
if [[ -z "$NON_DOC" ]]; then
  echo "verify-stop: only docs files changed; skipping verify." >&2
  exit 0
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "verify-stop: bun not found; skipping bun run verify." >&2
  exit 0
fi

if [[ ! -d node_modules ]]; then
  echo "verify-stop: node_modules missing; run bun install before bun run verify." >&2
  exit 1
fi

echo "verify-stop: running bun run verify for changed non-doc files." >&2
bun run verify

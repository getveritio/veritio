#!/usr/bin/env bash
set -euo pipefail

# Verifies every example app so they cannot rot against adapter/SDK API changes.
# JavaScript examples are independent bun workspaces, while Python and Go
# examples import the sibling SDKs through PYTHONPATH or go replace directives.
# The gate uses local in-memory examples only; storage-* examples are still
# checked statically and never require live databases.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXAMPLES_DIR="$ROOT_DIR/examples"

# Reads whether a given npm script is defined in the example's package.json
# without depending on jq; returns success when the script exists.
has_script() {
  local dir="$1"
  local name="$2"
  node -e "process.exit((require('$dir/package.json').scripts||{})['$name']?0:1)"
}

# Installs an example's dependencies, then runs build (when present) before
# typecheck. Build runs first because TanStack Start generates its route tree at
# build time and tsc needs it; SvelteKit's typecheck self-generates via sync.
verify_example() {
  local dir="$1"
  local name
  name="$(basename "$dir")"

  echo
  echo "==> $name"
  echo "    $dir"
  (
    cd "$dir"
    bun install
    if has_script "$dir" build; then
      bun run build
    fi
    if has_script "$dir" typecheck; then
      bun run typecheck
    fi
    if has_script "$dir" test; then
      bun run test
    fi
  )
}

verify_python_example() {
  local dir="$1"
  local name
  name="$(basename "$dir")"

  echo
  echo "==> $name"
  echo "    $dir"
  (
    cd "$dir"
    python3 -m venv .venv
    # Installs the example's framework dependencies into an ignored local venv
    # while importing the sibling Veritio SDK through PYTHONPATH.
    . .venv/bin/activate
    pip install -e .
    PYTHONPATH="$ROOT_DIR/sdks/python/src:." python3 -m unittest discover -s tests
  )
}

verify_go_example() {
  local dir="$1"
  local name
  name="$(basename "$dir")"

  echo
  echo "==> $name"
  echo "    $dir"
  (
    cd "$dir"
    go test ./...
  )
}

for example in "$EXAMPLES_DIR"/*/; do
  if [[ -f "${example}package.json" ]]; then
    verify_example "${example%/}"
  elif [[ -f "${example}pyproject.toml" ]]; then
    verify_python_example "${example%/}"
  elif [[ -f "${example}go.mod" ]]; then
    verify_go_example "${example%/}"
  fi
done

echo
echo "All examples verified."

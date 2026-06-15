#!/usr/bin/env bash
set -euo pipefail

# Verifies every example app so they cannot rot against adapter/SDK API changes.
# Each example is its own bun workspace (separate lockfile + node_modules), so we
# install per-example and run the strongest available static check. This gate is
# intentionally static: it never *runs* the storage-* examples, so it needs no
# live database or network beyond dependency installation.

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
  )
}

for example in "$EXAMPLES_DIR"/*/; do
  [[ -f "${example}package.json" ]] || continue
  verify_example "${example%/}"
done

echo
echo "All examples verified."

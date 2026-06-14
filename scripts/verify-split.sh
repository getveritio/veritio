#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARENT_DIR="$(dirname "$ROOT_DIR")"

WEBSITE_DIR="${VERITIO_WEBSITE_DIR:-$PARENT_DIR/veritio-website}"
CLOUD_DIR="${VERITIO_CLOUD_DIR:-$PARENT_DIR/veritio-cloud}"

# Prints supported split verification modes for agents running from the control
# repo.
usage() {
  cat <<'USAGE'
Usage: scripts/verify-split.sh [all|oss|website|cloud|siblings|status]

Runs verification across the Veritio split repositories from the OSS/control repo.

Modes:
  all       verify veritio, veritio-website, and veritio-cloud
  oss       verify only veritio
  website   verify only veritio-website
  cloud     verify only veritio-cloud
  siblings  verify website and cloud only
  status    print git status for all three repos

Environment overrides:
  VERITIO_WEBSITE_DIR=/absolute/path/to/veritio-website
  VERITIO_CLOUD_DIR=/absolute/path/to/veritio-cloud
USAGE
}

# Fails early when a sibling repo path is missing instead of silently skipping a
# verification surface.
require_dir() {
  local label="$1"
  local dir="$2"
  if [[ ! -d "$dir" ]]; then
    echo "Missing $label directory: $dir" >&2
    exit 1
  fi
}

# Runs one verification command in a named repo and prints the path for readable
# multi-repo logs.
run_step() {
  local label="$1"
  local dir="$2"
  shift 2

  require_dir "$label" "$dir"
  echo
  echo "==> $label"
  echo "    $dir"
  (cd "$dir" && "$@")
}

# Prints the git status for one split repo without modifying its worktree.
status_step() {
  local label="$1"
  local dir="$2"

  require_dir "$label" "$dir"
  echo
  echo "==> $label status"
  echo "    $dir"
  if [[ -d "$dir/.git" ]]; then
    git -C "$dir" status --short
  else
    echo "not a git repo"
  fi
}

# Verifies the OSS protocol, SDK, adapter, server, and CLI workspace.
verify_oss() {
  run_step "veritio" "$ROOT_DIR" bun run verify
}

# Verifies the public website sibling from the control repo.
verify_website() {
  run_step "veritio-website" "$WEBSITE_DIR" sh -c 'bun run check && bun run build'
}

# Verifies the private hosted cloud sibling from the control repo.
verify_cloud() {
  run_step "veritio-cloud" "$CLOUD_DIR" sh -c 'bun run typecheck && bun run build'
}

mode="${1:-all}"

case "$mode" in
  all)
    verify_oss
    verify_website
    verify_cloud
    ;;
  oss)
    verify_oss
    ;;
  website)
    verify_website
    ;;
  cloud)
    verify_cloud
    ;;
  siblings)
    verify_website
    verify_cloud
    ;;
  status)
    status_step "veritio" "$ROOT_DIR"
    status_step "veritio-website" "$WEBSITE_DIR"
    status_step "veritio-cloud" "$CLOUD_DIR"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown mode: $mode" >&2
    usage >&2
    exit 2
    ;;
esac

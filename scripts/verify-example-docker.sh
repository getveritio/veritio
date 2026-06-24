#!/usr/bin/env bash
set -euo pipefail

# Builds and runs the HTTP examples that publish Dockerfiles, then verifies that
# CRUD and governed-lifecycle evidence produce valid audit, edge, and commit
# hash chains.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAST_IMAGE="veritio-fastapi-governed-crud"
GIN_IMAGE="veritio-gin-governed-crud"
FAST_CONTAINER="veritio-fastapi-smoke"
GIN_CONTAINER="veritio-gin-smoke"

cleanup() {
  docker rm -f "$FAST_CONTAINER" "$GIN_CONTAINER" >/dev/null 2>&1 || true
}

wait_for_http() {
  local url="$1"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  echo "Timed out waiting for $url" >&2
  return 1
}

verify_evidence() {
  local name="$1"
  local url="$2"
  local payload
  payload="$(curl -fsS "$url/evidence")"
  printf '%s' "$payload" | python3 -c '
import json
import sys

name = sys.argv[1]
payload = json.load(sys.stdin)
assert payload["auditVerification"] == {"ok": True}, payload["auditVerification"]
assert payload["edgeVerification"] == {"ok": True}, payload["edgeVerification"]
assert payload["commitVerification"] == {"ok": True}, payload["commitVerification"]
assert len(payload["commitRecords"]) >= 4, payload["commitRecords"]
print(name, len(payload["auditRecords"]), "audit records", len(payload["edgeRecords"]), "edge records", len(payload["commitRecords"]), "commits")
' "$name"
}

exercise_api() {
  local url="$1"
  local created
  local id
  created="$(curl -fsS -X POST "$url/projects" -H 'content-type: application/json' -d '{"name":"Retention inbox"}')"
  id="$(printf '%s' "$created" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
  curl -fsS -X PUT "$url/projects/$id" -H 'content-type: application/json' -d '{"status":"reviewing"}' >/dev/null
  curl -fsS -X DELETE "$url/projects/$id" >/dev/null
  curl -fsS -X POST "$url/scenarios/governed-lifecycle" >/dev/null
}

trap cleanup EXIT
cleanup

docker build -f "$ROOT_DIR/examples/fastapi-governed-crud/Dockerfile" -t "$FAST_IMAGE" "$ROOT_DIR"
docker build -f "$ROOT_DIR/examples/gin-governed-crud/Dockerfile" -t "$GIN_IMAGE" "$ROOT_DIR"

docker run -d --rm --name "$FAST_CONTAINER" -p 8010:8010 "$FAST_IMAGE" >/dev/null
docker run -d --rm --name "$GIN_CONTAINER" -p 8080:8080 "$GIN_IMAGE" >/dev/null

wait_for_http "http://localhost:8010/evidence"
wait_for_http "http://localhost:8080/evidence"

exercise_api "http://localhost:8010"
verify_evidence "fastapi" "http://localhost:8010"

exercise_api "http://localhost:8080"
verify_evidence "gin" "http://localhost:8080"

echo "Docker examples verified."

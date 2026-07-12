#!/usr/bin/env bash
#
# Internal dogfood harness for @veritio/gateway.
#
# Runs a real gateway on localhost in front of the REAL Anthropic API using
# the operator's own key, so day-to-day traffic exercises streaming, policy,
# metering, and evidence exactly as a customer deployment would.
#
# Boundary rules this script protects:
# - The real provider key is read from $ANTHROPIC_API_KEY at this process
#   boundary only, written into a config file under $HOME with mode 600, and
#   never echoed. Nothing secret lives in the repo tree.
# - The generated virtual key is stored (mode 600) so repeat runs reuse it;
#   evidence chains accumulate under the same state dir across runs.
#
# Usage:
#   ANTHROPIC_API_KEY=sk-ant-… gateway/scripts/dogfood.sh up     # (re)start on :8790
#   gateway/scripts/dogfood.sh smoke                              # real requests through it
#   gateway/scripts/dogfood.sh verify                             # verify the evidence chain
#   gateway/scripts/dogfood.sh env                                # print exports for SDKs/Claude Code
#   gateway/scripts/dogfood.sh down                               # stop the gateway
set -euo pipefail

STATE_DIR="${VERITIO_DOGFOOD_DIR:-$HOME/.veritio-gateway-dogfood}"
CONFIG="$STATE_DIR/config.json"
VK_FILE="$STATE_DIR/virtual-key"
PID_FILE="$STATE_DIR/gateway.pid"
LOG_FILE="$STATE_DIR/gateway.log"
PORT="${VERITIO_GATEWAY_PORT:-8790}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Ensures state dir + virtual key exist; generates the vk once (mode 600).
ensure_state() {
  umask 077
  mkdir -p "$STATE_DIR/evidence"
  if [ ! -f "$VK_FILE" ]; then
    printf 'vk_dogfood_%s' "$(openssl rand -hex 16)" > "$VK_FILE"
    echo "generated virtual key at $VK_FILE"
  fi
}

# Writes the gateway config from env; the only place the real key is handled.
write_config() {
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    echo "error: ANTHROPIC_API_KEY is not set; export it and re-run 'up'" >&2
    exit 1
  fi
  local vk_hash
  vk_hash="$(printf '%s' "$(cat "$VK_FILE")" | shasum -a 256 | cut -d' ' -f1)"
  umask 077
  ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" VK_HASH="$vk_hash" EVIDENCE_DIR="$STATE_DIR/evidence" \
    python3 - > "$CONFIG" <<'PY'
import json, os
print(json.dumps({
    "tenantId": "tenant_dogfood",
    "gatewayId": "gw_dogfood_local",
    "evidenceDir": os.environ["EVIDENCE_DIR"],
    "providers": {
        "anthropic": {"baseUrl": "https://api.anthropic.com", "apiKey": os.environ["ANTHROPIC_API_KEY"]},
    },
    "policies": {
        "dogfood": {"providers": ["anthropic"], "models": ["*"], "endpoints": ["messages"]},
    },
    "keys": [{"keyId": "vk_dogfood", "keyHash": os.environ["VK_HASH"], "policy": "dogfood"}],
}, indent=2))
PY
  echo "config written to $CONFIG (mode 600)"
}

up() {
  ensure_state
  write_config
  down 2>/dev/null || true
  (cd "$REPO_ROOT" && VERITIO_GATEWAY_CONFIG="$CONFIG" VERITIO_GATEWAY_PORT="$PORT" \
    nohup bun gateway/src/server.ts > "$LOG_FILE" 2>&1 & echo $! > "$PID_FILE")
  sleep 1
  if curl -sf "http://127.0.0.1:$PORT/healthz" > /dev/null; then
    echo "gateway up on http://127.0.0.1:$PORT (pid $(cat "$PID_FILE"), log $LOG_FILE)"
  else
    echo "error: gateway failed to start; see $LOG_FILE" >&2
    exit 1
  fi
}

down() {
  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null && echo "gateway stopped" || true
    rm -f "$PID_FILE"
  fi
}

# Real traffic through the gateway: one non-streaming and one streaming
# request in Anthropic wire format. With a valid key both should be 200 and
# metered; with an invalid key both come back as upstream 401s recorded as
# ai.request.failed — either way the evidence pipeline is exercised for real.
smoke() {
  local vk
  vk="$(cat "$VK_FILE")"
  echo "--- non-streaming /v1/messages"
  curl -s -o /dev/null -w "status: %{http_code}\n" "http://127.0.0.1:$PORT/v1/messages" \
    -H "x-api-key: $vk" -H "content-type: application/json" -H "anthropic-version: 2023-06-01" \
    -d '{"model":"claude-haiku-4-5-20251001","max_tokens":32,"messages":[{"role":"user","content":"Say ok."}]}'
  echo "--- streaming /v1/messages"
  curl -s -o /dev/null -w "status: %{http_code}\n" "http://127.0.0.1:$PORT/v1/messages" \
    -H "x-api-key: $vk" -H "content-type: application/json" -H "anthropic-version: 2023-06-01" \
    -d '{"model":"claude-haiku-4-5-20251001","max_tokens":32,"stream":true,"messages":[{"role":"user","content":"Say ok."}]}'
  echo "--- last evidence events"
  tail -3 "$STATE_DIR/evidence/events.jsonl" 2>/dev/null \
    | python3 -c 'import json,sys
for line in sys.stdin:
    r = json.loads(line)
    e = r["event"]
    print(r["sequence"], e["action"], json.dumps(e["metadata"]))'
}

# Offline chain verification of everything the dogfood gateway has recorded.
verify() {
  (cd "$REPO_ROOT/gateway" && EVIDENCE_DIR="$STATE_DIR/evidence" bun -e '
    import { verifyAuditRecords } from "@veritio/core";
    import { createFileEvidenceStore } from "@veritio/storage";
    const store = createFileEvidenceStore(process.env.EVIDENCE_DIR!);
    const records = await store.listEvents();
    console.log(`records: ${records.length}`);
    console.log("verify:", JSON.stringify(verifyAuditRecords(records)));')
}

# Prints the exports that point official SDKs (and Claude Code, with the
# caveats in the README) at the dogfood gateway.
env_exports() {
  echo "export ANTHROPIC_BASE_URL=http://127.0.0.1:$PORT"
  echo "export ANTHROPIC_API_KEY=$(cat "$VK_FILE")"
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  smoke) smoke ;;
  verify) verify ;;
  env) env_exports ;;
  *) echo "usage: $0 {up|down|smoke|verify|env}" >&2; exit 1 ;;
esac

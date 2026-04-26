#!/usr/bin/env bash
#
# PR #5 sub-task 5a — Path B: parallel test gateway / MC profile.
#
# !!! NOT FOR #574 VERIFICATION (after 2026-04-27 finding) !!!
#
# Initial intent was to start a second openclaw-gateway in "device-auth mode"
# to trigger the migration path #574 needs. Đào's source inspection of
# server.impl-CtLS1ywt.js disproved that hypothesis: the gateway emits
# `connect.challenge` with a nonce UNCONDITIONALLY on every WS open, regardless
# of gateway.auth.mode. There is no `auth.mode = "device"` — the schema only
# allows `none | token | password | trusted-proxy`.
#
# This script is RETAINED as a reference for future parallel-env work that
# legitimately needs an isolated MC profile (separate DB, separate gateway
# instance, separate ports). It is INTENTIONALLY non-executable in its
# current form because its generated config writes `auth.mode = "device"`
# which the gateway would reject. Anyone reusing this script must:
#   1. Replace `auth.mode = "device"` with a valid value (likely `token`).
#   2. Adjust the `cmd_smoke` placeholder for the actual scenario being run.
#
# The original isolation properties remain correct: OPENCLAW_HOME=$TEST_DIR,
# port 18890 (gateway) / 3001 (MC dev), DB at $TEST_DIR/mc-test.db, cleanup
# via kill + rm -rf the temp dir. Production gateway 18789 + MC 3000 stay
# untouched.
#
# Status: REFERENCE ONLY. Do NOT run for #574 — use browser-side instrumentation
# on the existing 18789 gateway instead. See MISSION_CONTROL_BASELINE.md for
# the corrected verification approach.
#
# Cleanup: ./PR5_PATH_B_TEST_GATEWAY.sh cleanup [TEST_DIR]
# Original gateway and MC dev server are untouched throughout.
#

set -euo pipefail

TEST_PORT_GATEWAY="${TEST_PORT_GATEWAY:-18890}"
TEST_PORT_MC="${TEST_PORT_MC:-3001}"
TEST_DIR="${TEST_DIR:-/tmp/oc-test-gw-$$}"
OPENCLAW_BIN="${OPENCLAW_BIN:-/home/vip.toanvo/.npm-global/bin/openclaw}"

usage() {
  echo "Usage: $0 setup | start | smoke | cleanup [TEST_DIR]"
  echo "  setup   — create $TEST_DIR with copy of agents + workspace + test config"
  echo "  start   — launch the test gateway + dedicated MC dev profile (foreground bg)"
  echo "  smoke   — drive the device-auth nonce path via Camofox or curl, capture evidence"
  echo "  cleanup — kill background PIDs and rm -rf TEST_DIR"
}

cmd_setup() {
  if [[ -d "$TEST_DIR" ]]; then
    echo "TEST_DIR already exists: $TEST_DIR — refusing to overwrite. Run cleanup first."
    exit 1
  fi
  mkdir -p "$TEST_DIR"

  # Copy agents + workspace so the test gateway has identical agent configs.
  # We do NOT copy the live ~/.openclaw/openclaw.json — we generate a fresh
  # one with device-auth mode for this isolated run.
  cp -r "$HOME/.openclaw/agents" "$TEST_DIR/agents"
  cp -r "$HOME/.openclaw/workspace" "$TEST_DIR/workspace"

  cat > "$TEST_DIR/openclaw.json" <<JSON
{
  "gateway": {
    "auth": { "mode": "device" },
    "mode": "local",
    "controlUi": {
      "allowedOrigins": [
        "http://localhost:${TEST_PORT_MC}",
        "http://127.0.0.1:${TEST_PORT_MC}"
      ]
    },
    "port": ${TEST_PORT_GATEWAY}
  }
}
JSON

  cat > "$TEST_DIR/mc.env" <<ENV
PORT=${TEST_PORT_MC}
GATEWAY_HOST=127.0.0.1
GATEWAY_PORT=${TEST_PORT_GATEWAY}
DB_PATH=${TEST_DIR}/mc-test.db
OPENCLAW_BIN=${OPENCLAW_BIN}
NODE_ENV=development
ENV

  echo "✅ Test dir: $TEST_DIR"
  echo "   Test gateway port: $TEST_PORT_GATEWAY"
  echo "   Test MC dev port:  $TEST_PORT_MC"
  echo "   Original gateway 18789 + MC 3000: untouched"
}

cmd_start() {
  if [[ ! -d "$TEST_DIR" ]]; then
    echo "Run setup first."
    exit 1
  fi

  # Launch test gateway with isolated home — does not interfere with 18789.
  OPENCLAW_HOME="$TEST_DIR" "$OPENCLAW_BIN" gateway start \
    > "$TEST_DIR/gateway.log" 2>&1 &
  echo $! > "$TEST_DIR/gateway.pid"
  echo "Test gateway PID: $(cat "$TEST_DIR/gateway.pid"), log: $TEST_DIR/gateway.log"

  # MC dev server on alt port, alt DB, alt gateway target.
  ( cd /home/vip.toanvo/mission-control \
      && env $(cat "$TEST_DIR/mc.env" | xargs) \
         npx next dev -p "$TEST_PORT_MC" > "$TEST_DIR/mc.log" 2>&1 ) &
  echo $! > "$TEST_DIR/mc.pid"
  echo "Test MC dev PID: $(cat "$TEST_DIR/mc.pid"), log: $TEST_DIR/mc.log"

  echo "Wait ~5s for ready, then drive scenario via cmd_smoke"
}

cmd_smoke() {
  if [[ ! -f "$TEST_DIR/gateway.pid" ]]; then
    echo "Run start first."
    exit 1
  fi
  echo "TODO: drive the device-auth nonce path via Camofox or curl + cookies"
  echo "Expected evidence:"
  echo "  - gateway.log contains 'auth.nonce' frame"
  echo "  - browser localStorage briefly has 'mc-device-privkey' (legacy)"
  echo "  - after one reload, IDB store 'mc-device-identity' has CryptoKey, localStorage cleared"
  echo "  - websocket frames show 'auth.signature' response from MC"
  echo ""
  echo "Capture method: Camofox direct (port 9377) on http://127.0.0.1:${TEST_PORT_MC}"
  echo "Login as the same admin (DB cookies don't migrate, fresh setup needed)"
}

cmd_cleanup() {
  local dir="${1:-$TEST_DIR}"
  if [[ -f "$dir/gateway.pid" ]]; then
    kill -- "$(cat "$dir/gateway.pid")" 2>/dev/null || true
  fi
  if [[ -f "$dir/mc.pid" ]]; then
    kill -- "$(cat "$dir/mc.pid")" 2>/dev/null || true
  fi
  rm -rf "$dir"
  echo "Cleaned $dir"
}

case "${1:-}" in
  setup)   cmd_setup ;;
  start)   cmd_start ;;
  smoke)   cmd_smoke ;;
  cleanup) cmd_cleanup "${2:-$TEST_DIR}" ;;
  *)       usage; exit 1 ;;
esac

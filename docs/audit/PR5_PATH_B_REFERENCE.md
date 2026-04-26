# Path B (parallel test gateway) — REFERENCE ONLY

> **Status: CANCELLED for #574 verification.**
> Retained as a reference for future work that legitimately needs an isolated
> MC profile (separate DB, separate gateway instance, separate ports). Do
> **not** run any of the snippets below as part of the current PR #5
> verification — see `MISSION_CONTROL_BASELINE.md` for the corrected approach.

## Why Path B was cancelled

The original intent was to launch a second `openclaw-gateway` in "device-auth
mode" to trigger the migration code path #574 needs.

Đào's source-side review of
`~/.npm-global/lib/node_modules/openclaw/dist/server.impl-CtLS1ywt.js`
disproved the underlying assumption:

- The gateway emits `event/connect.challenge` with a `randomUUID()` nonce
  **unconditionally** on every WS open.
- This is independent of `gateway.auth.mode`.
- `auth.mode` schema only allows `none | token | password | trusted-proxy`.
  There is no `"device"` value — the gateway would reject the config the
  original script generates.

Because the trigger is unconditional, the verification work moves to
browser-side instrumentation on the existing MC + gateway pair
(`http://127.0.0.1:3000` → `127.0.0.1:18789`).

## Reference snippets (for future parallel-env work)

Anyone resurrecting the parallel-env idea for an unrelated scenario must
first replace `auth.mode = "device"` with a valid value (likely `token`) and
adjust the smoke step for the actual scenario being run.

### Isolation properties

| Variable             | Default                                       | Purpose                                                |
| -------------------- | --------------------------------------------- | ------------------------------------------------------ |
| `TEST_PORT_GATEWAY`  | `18890`                                       | Test gateway port (production stays on 18789)          |
| `TEST_PORT_MC`       | `3001`                                        | Test MC dev server port (production stays on 3000)     |
| `TEST_DIR`           | `/tmp/oc-test-gw-$$`                          | Isolated `OPENCLAW_HOME`                               |
| `OPENCLAW_BIN`       | `/home/vip.toanvo/.npm-global/bin/openclaw`   | CLI used to start the test gateway                     |

### Setup snippet

Copies live agents + workspace, generates a fresh `openclaw.json` (the
`auth.mode = "device"` line is **invalid** and must be replaced before reuse):

```bash
mkdir -p "$TEST_DIR"
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
```

### Start snippet

Backgrounds an isolated test gateway and a separate MC dev server. PIDs go to
`$TEST_DIR/{gateway,mc}.pid`, logs to `$TEST_DIR/{gateway,mc}.log`.
Production gateway 18789 + MC 3000 stay untouched throughout.

```bash
OPENCLAW_HOME="$TEST_DIR" "$OPENCLAW_BIN" gateway start \
  > "$TEST_DIR/gateway.log" 2>&1 &
echo $! > "$TEST_DIR/gateway.pid"

( cd /home/vip.toanvo/mission-control \
    && env $(cat "$TEST_DIR/mc.env" | xargs) \
       npx next dev -p "$TEST_PORT_MC" > "$TEST_DIR/mc.log" 2>&1 ) &
echo $! > "$TEST_DIR/mc.pid"
```

### Cleanup snippet

```bash
kill -- "$(cat "$TEST_DIR/gateway.pid")" 2>/dev/null || true
kill -- "$(cat "$TEST_DIR/mc.pid")" 2>/dev/null || true
rm -rf "$TEST_DIR"
```

## What replaces this for #574

Browser-side instrumentation on the existing MC instance at
`http://127.0.0.1:3000`, talking to the existing gateway on
`127.0.0.1:18789`. Four checks:

1. `window.isSecureContext` and `window.crypto?.subtle` availability.
2. Confirm `event/connect.challenge` frames actually arrive in MC (raw WS log).
3. Confirm `handleGatewayFrame` calls
   `sendConnectHandshake(ws, frame.payload?.nonce)`.
4. Inspect `tokenOnlyFallbackRef.current` — if stuck `true`, identify why.

If `connect.challenge` arrives but no migration runs → MC client bug. If it
doesn't arrive → MC connection / parser bug. Either way the fix path leaves
the gateway untouched.

# Mission Control dev-server runbook

This runbook covers the local Next.js development server used while working on Mission Control.
It is intentionally conservative: Mission Control shares hosts with other Next.js-based services such as 9router, so avoid broad process-kill patterns.

## Start the dev server

From the repository root:

```bash
cd /path/to/mission-control
pnpm install
OPENCLAW_BIN="${OPENCLAW_BIN:-$(command -v openclaw || true)}" pnpm dev
```

For Tyler's host, `openclaw` commonly lives under `~/.npm-global/bin`. If `command -v openclaw` is empty, use the absolute path:

```bash
OPENCLAW_BIN=/home/vip.toanvo/.npm-global/bin/openclaw pnpm dev
```

The package script binds the dev server to `127.0.0.1` and defaults to port `3000`:

```json
"dev": "pnpm run verify:node && next dev --hostname 127.0.0.1 --port ${PORT:-3000}"
```

Override the port only when you intentionally want an isolated second instance:

```bash
PORT=3001 OPENCLAW_BIN=/home/vip.toanvo/.npm-global/bin/openclaw pnpm dev
```

Open either local URL:

- `http://127.0.0.1:3000`
- `http://localhost:3000`

Phase 2.2 PRs #24/#25 make the gateway origin diagnostics/fix handle the localhost vs 127.0.0.1 pair.

## Verify from a clean shell

Use a shell that does not inherit your interactive PATH customisations:

```bash
env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin" bash -lc '
  cd /path/to/mission-control
  test -x /home/vip.toanvo/.npm-global/bin/openclaw
  OPENCLAW_BIN=/home/vip.toanvo/.npm-global/bin/openclaw pnpm exec next --version
'
```

Then start the server in that same style if needed:

```bash
env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin" bash -lc '
  cd /path/to/mission-control
  OPENCLAW_BIN=/home/vip.toanvo/.npm-global/bin/openclaw pnpm dev
'
```

## Find the Mission Control dev-server process safely

Prefer matching the exact command/port rather than a generic `next-server` name:

```bash
pgrep -af 'next dev --hostname 127\.0\.0\.1 --port 3000'
```

If you need to inspect the listener on port 3000:

```bash
ss -ltnp '( sport = :3000 )'
# or, when lsof is available:
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

## Stop the dev server safely

If the server is running in your current terminal, press `Ctrl-C`.

If it is detached, first identify the exact PID:

```bash
pgrep -af 'next dev --hostname 127\.0\.0\.1 --port 3000'
```

Then terminate only that PID:

```bash
kill -TERM <pid>
```

Confirm the port is free:

```bash
ss -ltnp '( sport = :3000 )' || true
```

Avoid broad patterns such as:

```bash
pkill -f next-server       # unsafe: can match unrelated Next.js services such as 9router
pkill -f next              # unsafe: too broad
killall node               # unsafe: kills unrelated Node services
```

## Troubleshooting

### `spawn openclaw ENOENT`

The dev server's environment cannot find the OpenClaw CLI. Set `OPENCLAW_BIN` to an absolute path and restart `pnpm dev`:

```bash
OPENCLAW_BIN=/home/vip.toanvo/.npm-global/bin/openclaw pnpm dev
```

You can also add the directory to the account PATH, but the explicit `OPENCLAW_BIN` env var is the least ambiguous option for reproducible debugging.

### Port 3000 already in use

Do not kill by process name. Identify the listener first:

```bash
ss -ltnp '( sport = :3000 )'
```

If it is the Mission Control dev server you intended to replace, stop that PID. If it is another service, either leave it alone and use `PORT=3001`, or decide intentionally which service should own port 3000.

### Generic `GW Offline` while gateway is healthy

After Phase 2.2 PRs #24/#25, local origin mismatches should be diagnosable through `/api/diagnostics/gateway-origin` and auto-registration should add both localhost and 127.0.0.1 forms. Restart the dev server once after upgrading so `registerMcAsDashboard()` can add the missing local peer.

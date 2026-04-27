# Phase 1.3 — Generic gateway caller inventory

**Status:** docs-only. No code migrations in this PR. Source-of-truth for the next three implementation PRs (1.3b, 1.3c, 1.3d).

**Snapshot date:** 2026-04-27 (HEAD `15c377f`, branch `phase-0/baseline-audit`).

## Why this PR

Phase 1.2 (PR #3) migrated the two `task-dispatch.ts` full-text dispatch paths from `runOpenClaw(['gateway', 'call', 'agent', ...])` to a native WS client (`callOpenClawGatewayWS` / `callGatewayAgentForText` in `src/lib/openclaw-gateway-ws.ts`). Per Đào's narrow-scope caveat (Telegram msg 1078), the migration deliberately did NOT touch other CLI shell-out callsites. PR #5 sub-task 5a verification (commit `4677fdd`) explicitly listed `notifications/deliver/route.ts:82` as a follow-up candidate. This document inventories every remaining callsite so the next implementation PRs can be split by risk and scope rather than guessed.

## Method

Three greps against the `phase-0/baseline-audit` checkout, excluding `node_modules`, `.next`, `__tests__`, and `.spec.` test files:

```bash
# Direct CLI shell-out wrapper
grep -rn 'runOpenClaw\b' --include='*.ts' --include='*.tsx' src/

# RPC-style helper that internally calls runOpenClaw(['gateway', 'call', ...])
grep -rn 'callOpenClawGateway\b' --include='*.ts' --include='*.tsx' src/

# Already-migrated WS path, included for completeness
grep -rn 'callOpenClawGatewayWS\|callGatewayAgentForText' --include='*.ts' --include='*.tsx' src/
```

Each callsite was opened to confirm (a) what gateway method or CLI command it invokes, (b) whether the invocation is gateway RPC (migratable to WS) or a true CLI operation (e.g. `--version`, `doctor`, `update`, `agents add`, `backup create`).

## Counts

| Category | Count | Files |
| --- | ---: | ---: |
| `runOpenClaw` direct callsites | 21 | 15 |
| `callOpenClawGateway` callsites | 17 | 8 |
| `callOpenClawGatewayWS` / `callGatewayAgentForText` (already migrated) | 6 | 2 |
| Other `child_process` subprocess (tmux, git, brew, op, gws, etc. — out of scope) | ~25 | many |

Counts use `grep -rEn 'runOpenClaw\s*\(' --include='*.ts' --include='*.tsx' src/ | grep -v '__tests__'` (which matches actual call expressions, excluding the export declaration in `command.ts`, dynamic-import bindings without an immediate call, and JSDoc / inline comment references). The 21 `runOpenClaw` figure breaks down as: 3 Tier 1 + 3 Tier 2 + 1 wrapper (`openclaw-gateway.ts:45`) + 1 Needs Design + 13 Keep CLI direct calls.

Note: `callOpenClawGateway` itself shell-outs (`src/lib/openclaw-gateway.ts:45` calls `runOpenClaw(['gateway', 'call', method, '--timeout', '--params', '--json'])`), so all 17 `callOpenClawGateway` callsites are also CLI shell-out under the hood. Migrating them means swapping for `callOpenClawGatewayWS`.

## Tier 1 — `gateway call agent` shell-out (HIGH RISK, same anti-pattern as #608)

Identical shape to the pattern PR #3 banned. Each fails with `spawn openclaw ENOENT` in containerised Mission Control deployments where the `openclaw` CLI binary is not on the image's `PATH`.

| File:line | Purpose | Migration |
| --- | --- | --- |
| `src/app/api/notifications/deliver/route.ts:90` | Notification → agent invocation. `invokeParams = { message, agentId, idempotencyKey, deliver: false }` then `runOpenClaw(['gateway', 'call', 'agent', '--params', JSON, '--json'])`. | `callGatewayAgentForText(agentId, message, { deliver: false, idempotencyKey, ... })` — drop-in. |
| `src/app/api/chat/messages/route.ts:518` | Chat-message-forward → invoke agent. Same `gateway call agent --params --json` pattern with `deliver: false`. | Same as above. |
| `src/app/api/chat/messages/route.ts:597` | Companion to line 518 — `runOpenClaw(['gateway', 'call', 'agent.wait', '--params', JSON, '--json'])` to await `runId` completion. | Needs WS analogue — likely `callOpenClawGatewayWS('agent.wait', { runId, timeoutMs })`. The wrapper is generic (`method` is a parameter), so this should be a one-liner without new wrapper code. |

**Đào's specific question on `notifications/deliver`:** confirmed HIGH priority. Same shell-out shape as the original #608 case, identical failure mode in containers. Bundle in PR 1.3c (with the `chat/messages` pair) for cleanest commit grouping; separating it into its own PR adds review overhead without changing risk.

## Tier 2 — `gateway sessions_send` shell-out (LOW RISK, mechanical unification)

Three callsites with identical argv shape: `['gateway', 'sessions_send', '--session', sessionKey, '--message', text]`.

| File:line | Purpose |
| --- | --- |
| `src/app/api/agents/[id]/wake/route.ts:42` | "Wake up check-in for ${agent.name}" message to agent's session. |
| `src/app/api/agents/message/route.ts:58` | Direct message between agents (`from`/`to` resolved server-side). |
| `src/app/api/tasks/[id]/broadcast/route.ts:51` | Broadcast a task update to multiple subscribers via `Promise.allSettled` over the agents list. |

Migration: single WS method `sessions.send` invoked via `callOpenClawGatewayWS('sessions.send', { sessionKey, message }, { timeoutMs: 10_000 })`. No business logic change. Estimated diff: ~30 LOC across 3 files plus a regression test extending `task-dispatch-source-discipline.test.ts` to forbid the literal `runOpenClaw([..., 'sessions_send', ...])` pattern.

## Tier 3 — `callOpenClawGateway` wrapper swap (MEDIUM RISK, broadest blast radius)

17 callsites across 8 files. Mechanical: replace the wrapper import + call site by `callOpenClawGatewayWS`. Same `(method, params, timeoutMs) → Promise<T>` shape, same return-type generics. After this tier completes, `src/lib/openclaw-gateway.ts` becomes dead code and can be deleted (with `parseGatewayJsonOutput` ported into the WS module if anything still needs it — quick scan suggests it does not, since the WS frames are already JSON).

| File:line | Method invoked |
| --- | --- |
| `src/app/api/nodes/route.ts:40` | `node.list` |
| `src/app/api/nodes/route.ts:62` | `node.devices` (or similar — confirm at impl time) |
| `src/app/api/nodes/route.ts:133` | `spec.method` (generic, comes from request body) |
| `src/app/api/channels/route.ts:150` | channel listing (typed `<GatewayData>`) |
| `src/app/api/channels/route.ts:162` | channel listing (typed `<GatewayData>`) |
| `src/app/api/channels/route.ts:330` | `web.login.start` (WhatsApp linking) |
| `src/app/api/channels/route.ts:356` | `web.login.wait` (WhatsApp linking, 122s timeout) |
| `src/app/api/channels/route.ts:382` | `channels.logout` |
| `src/app/api/spawn/route.ts:71` | `sessions_spawn` (primary payload) |
| `src/app/api/spawn/route.ts:81` | `sessions_spawn` (fallback payload) |
| `src/app/api/sessions/route.ts:114` | generic RPC (`rpcMethod`, `rpcParams`) |
| `src/app/api/sessions/route.ts:147` | `session_delete` |
| `src/app/api/sessions/[id]/control/route.ts:41` | `sessions_kill` |
| `src/app/api/sessions/[id]/control/route.ts:46` | `sessions_send` (note: this is the wrapper variant, not the direct-CLI variant in Tier 2) |
| `src/app/api/sessions/transcript/gateway/route.ts:39` | session transcript / history |
| `src/app/api/chat/messages/route.ts:493` | accepted-payload (typed `<any>`) |
| `src/lib/task-dispatch.ts:669` | `chat.send` for existing-session dispatch (Phase 1.2 partial — the new-session path was migrated but the existing-session path still uses the legacy wrapper) |

The 122-second `web.login.wait` is the longest-running of these and the only one likely to surface WS connection-lifetime concerns; the rest finish in ~10s. Estimated diff: ~150 LOC mostly imports + signature, plus extending the source-discipline test to forbid `callOpenClawGateway` once 1.3d ships.

## Keep CLI (true CLI ops, NOT gateway RPC)

These are not migration candidates — they invoke real CLI subcommands that have no gateway RPC equivalent. They stay on `runOpenClaw`. Some still carry the same `spawn openclaw ENOENT` failure mode in containers; addressing that is a packaging concern (ship the CLI in the image, or document it as a deployment requirement), not a WS-migration concern.

13 direct call lines:

| File:line | Command |
| --- | --- |
| `src/app/api/agents/route.ts:226` | `agents add <id> --workspace <path> --non-interactive` |
| `src/app/api/agents/[id]/route.ts:237` | `agents delete <id> --force` |
| `src/app/api/openclaw/version/route.ts:25` | `--version` |
| `src/app/api/openclaw/update/route.ts:16` | `--version` (pre-update probe) |
| `src/app/api/openclaw/update/route.ts:27` | `update --channel stable` |
| `src/app/api/openclaw/update/route.ts:34` | `--version` (post-update re-probe) |
| `src/app/api/openclaw/doctor/route.ts:71` | `doctor --fix` |
| `src/app/api/openclaw/doctor/route.ts:75` | `sessions cleanup --all-agents --enforce --fix-missing` |
| `src/app/api/openclaw/doctor/route.ts:91` | `doctor` (post-fix re-check) |
| `src/app/api/backup/route.ts:62` | `backup create --output <BACKUP_DIR>` |
| `src/app/api/status/route.ts:409` | `--version` |
| `src/app/api/diagnostics/route.ts:59` | `--version` |
| `src/app/api/channels/route.ts:178` | `channels status --json [--probe]` (CLI fallback when gateway is unreachable, intentional belt-and-braces — keep) |

Plus one indirect callsite via dependency-injected runner (does not appear in the `runOpenClaw\s*\(` grep but is effectively a Keep-CLI consumer): `src/lib/openclaw-doctor-cache.ts:56` defaults `runner = opts.runner ?? runOpenClaw`, executed when the doctor cache invokes the runner.

## Needs design (not migrated, not deferred)

| File:line | Issue |
| --- | --- |
| `src/app/api/pipelines/run/route.ts:137` | Uses `runOpenClaw(['agent', '--message', ..., '--timeout', ..., '--json'])` — invokes the CLI's own `agent` subcommand (long-running spawn), NOT `gateway call agent` (RPC). Could map to `sessions_spawn` + `agent.run` over WS, but spawn-vs-RPC parity needs a design call: does the caller need a long-lived stream of agent output, or a single deferred result? Treat as a separate ticket. |

## Recommended PR split

| PR | Scope | Risk | Est. LOC |
| --- | --- | ---: | ---: |
| **1.3a (this PR)** | docs-only inventory file | none | +138 |
| 1.3b | sessions_send unification — agents/wake + agents/message + tasks/broadcast (Tier 2) | low | ~30 |
| 1.3c | `gateway call agent` migration — notifications/deliver + chat/messages × 2 (Tier 1, including `agent.wait`) | medium | ~80 |
| 1.3d | `callOpenClawGateway` wrapper swap — Tier 3 (17 callsites), then delete `src/lib/openclaw-gateway.ts` | medium | ~150 |
| Defer | KEEP CLI block | n/a | 0 |
| Future ticket | `pipelines/run` design | n/a | TBD |

**Sequencing rationale:** 1.3b first because it is the smallest mechanical change with no behavioural risk, and it gives the regression-test pattern its second test case (after PR #3's `task-dispatch-source-discipline.test.ts`). 1.3c next because it closes the original `notifications/deliver` follow-up Đào called out in the PR #5 sub-task 5a verification, and because Tier 1 is the highest-impact failure mode in containers. 1.3d last because it is the largest blast radius and benefits from the WS path being battle-tested by the prior two PRs.

## Evidence (grep commands and counts)

Run from the repo root on commit `15c377f`.

**`runOpenClaw` count.** `grep -rEn 'runOpenClaw\s*\(' --include='*.ts' --include='*.tsx' src/ | grep -v '__tests__'` returns 24 raw lines. Three of those are NOT call expressions and must be excluded manually:

- `src/lib/command.ts:79` — the export declaration `export function runOpenClaw(args: string[], options: CommandOptions = {})`
- `src/lib/openclaw-gateway-ws.ts:4` — JSDoc reference inside a block comment (`* Replaces shell-out via \`runOpenClaw(['gateway', 'call', ...])\``)
- `src/lib/task-dispatch.ts:690` — single-line comment (`// Native WS replaces the legacy \`runOpenClaw([...gateway call agent`)

After exclusions: **21 actual call expressions** across 15 files. The breakdown — 3 Tier 1 + 3 Tier 2 + 1 wrapper (`openclaw-gateway.ts:45`) + 1 Needs Design (`pipelines/run.ts:137`) + 13 Keep CLI direct calls — sums to 21.

**`callOpenClawGateway` count.** `grep -rEn 'callOpenClawGateway\s*[(<]' --include='*.ts' --include='*.tsx' src/ | grep -v '__tests__' | grep -v 'export\|import'` returns **17** actual call expressions across 8 files. The `[(<]` matches both `callOpenClawGateway(` and the generic-typed form `callOpenClawGateway<T>(`.

**Anti-pattern detection.** The exact literal pattern `['gateway', 'call', 'agent', ...]` is hard to grep against directly because the array elements are on separate source lines (multi-line array literal). Two complementary approaches were used:

- `grep -rn "'agent'," --include='*.ts' src/ | grep -v '__tests__'` returns many hits (the literal `'agent',` appears in agent templates, gateway-ws.ts, etc., not all of them dispatch sites). Cross-referenced against the 21 `runOpenClaw` call expressions above by manually opening each call site and reading the args array — 2 of them have the dispatch shape `['gateway', 'call', 'agent', ...]`: `notifications/deliver/route.ts:90` (args body around lines 92–99) and `chat/messages/route.ts:518` (args body around lines 519–531).
- `grep -rn "'agent\.wait'," --include='*.ts' src/ | grep -v '__tests__'` returns **1 hit** (`chat/messages/route.ts:601`), which is the args body of the `runOpenClaw` call at `chat/messages/route.ts:597` — the companion `agent.wait` for the `runId` returned by the dispatch at line 518.

So Tier 1 contains 3 distinct call expressions: 2 with `gateway call agent` and 1 with `gateway call agent.wait`.

**Regression-test guard.** The PR #3 source-discipline test (`src/lib/__tests__/task-dispatch-source-discipline.test.ts`) guards `task-dispatch.ts` specifically against re-introduction of the dispatch pattern. PR 1.3c should extend the same test pattern to cover `notifications/deliver/route.ts` and `chat/messages/route.ts` once those callsites migrate.

**Hygiene.** No secrets, tokens, or session keys appear in the inventory output. All grep targets are public source patterns.

## Done-when (1.3a)

- This file exists with callsite table, classification, PR split, notifications/deliver priority, defer list, and grep commands.
- Đào reviews and merges PR 1.3a, then assigns PR 1.3b to the next implementer.

# Phase 5.6 — Ollama / free-tier badge

**Outcome:** added a small inline badge next to each agent's model name on the squad cards. Renders **free** (emerald) for known local providers (Ollama / llama.cpp / LM Studio / `local`), **paid** (amber) for known metered cloud providers (Anthropic / OpenAI / Cohere / Google / Gemini / Mistral / Bedrock / Groq / DeepSeek / xAI / Perplexity), and is omitted entirely when the tier is **unknown** (router-style prefixes like `9router/cx/...`, bare model ids without a prefix, missing config). 9 new unit tests pin the contract.

**Snapshot date:** 2026-04-27. Branched from `phase-0/baseline-audit` at `4c7cc11` (Phase 5.5 PR #42 merged).

## Why this PR exists

Per `docs/audit/MISSION_CONTROL_ROADMAP.md` § 5.6:

> Surface local/free/paid provider status to avoid cost surprises.

Đào (LEAD) assigned this to Mai (CODER) after Phase 5.5 closed (Đào msg 1705, ETA 00:05:00+10:00).

Tyler runs a mix of agents: some local (Ollama on the GCP VM, free), some Anthropic API (paid per-token), some routed through 9router (could be either). Without a visual cue, a `gpt-4o`-flavoured agent looks the same as a `qwen2.5-coder:14b` Ollama agent on the panel — but waking the first costs money and the second doesn't. Phase 5.6 fills that gap with a 1-character badge.

## What changed

### `src/lib/agent-card-helpers.ts`

Added two new exports:

1. **`classifyProviderTier(config): 'free' | 'paid' | 'unknown'`**
   - Reads the FIRST segment of `config.model.primary` via the existing `formatProviderName` helper.
   - Lowercase comparison; subprefix match — `'ollama-vps'` matches `'ollama'` and stays `'free'`, `'anthropic-stage'` matches `'anthropic'` and stays `'paid'`.
   - Free providers list (6): `ollama`, `llamacpp`, `llama-cpp`, `lmstudio`, `lm-studio`, `local`.
   - Paid providers list (14): `anthropic`, `openai`, `azure-openai`, `azureopenai`, `cohere`, `google`, `gemini`, `mistral`, `bedrock`, `aws-bedrock`, `groq`, `deepseek`, `xai`, `perplexity`.
   - Defaults to `'unknown'` for ALL other cases — including `9router/...` (the eventual provider depends on router config, the helper refuses to guess), bare model ids (`gpt-4o` with no prefix), missing/non-string config, and any unrecognized provider segment. **No false confidence.**

2. **`tierLabel(tier): string`**
   - Tooltip-friendly label: `'Local / free'` / `'Paid API'` / `'Unknown — check router config'`.
   - Decoupled from the badge's tone color so the UI layer owns presentation.

### `src/lib/__tests__/agent-card-helpers.test.ts`

Added 9 new cases. Pre-existing 29 cases unchanged.

- Known free provider list (4 cases — `ollama`, `llamacpp`, `lmstudio`, `local`).
- Known paid provider list (9 cases — anthropic / openai / cohere / google / gemini / mistral / bedrock / groq / deepseek).
- Router-style prefix → unknown (2 cases — `9router/cx/...`, `9router/free/...`).
- Bare model id → unknown.
- Case-insensitive provider segment.
- Subprefix variant matches (`anthropic-stage` → paid, `ollama-vps` → free).
- Missing/non-string config → unknown.
- Unrecognized vendor → unknown (no false-confidence regression).
- `tierLabel` returns non-empty for all three tiers.

Total: **38 cases** (was 29).

### `src/components/panels/agent-squad-panel-phase3.tsx`

Three minimal changes inside the existing `agents.map(...)` block:

1. Imported `classifyProviderTier` and `tierLabel` from `@/lib/agent-card-helpers`.
2. Computed `providerTier` once per card (next to existing `modelName`, `providerName`, etc.).
3. Inserted a tiny inline badge inside the role-line block:

```tsx
{modelName && providerTier !== 'unknown' && (
  <span
    className={`mt-0.5 inline-flex items-center rounded px-1.5 py-0 text-[10px] uppercase tracking-wide ${
      providerTier === 'free'
        ? 'bg-emerald-500/15 text-emerald-300'
        : 'bg-amber-500/15 text-amber-300'
    }`}
    title={tierLabel(providerTier)}
    aria-label={tierLabel(providerTier)}
  >
    {providerTier === 'free' ? 'free' : 'paid'}
  </span>
)}
```

Rendering rules:
- Hidden when `modelName` is empty (no model configured → no badge).
- Hidden when `providerTier === 'unknown'` (don't bait operator into trusting an ambiguous label).
- `free` → emerald-tinted background with emerald-300 text.
- `paid` → amber-tinted background with amber-300 text. Amber, not red — the goal is to flag for awareness, not alarm.
- `title` + `aria-label` carry the full `tierLabel` for tooltip / screen-reader.

## Why "unknown" is hidden, not labelled

A visible "unknown" badge would clutter every card whose model id starts with `9router/...` (currently almost all of Tyler's agents). Hiding the badge in that case keeps the visual signal high — when the operator sees a badge, it conveys real information ("this agent runs free on the local VM" or "this agent will hit the metered API"). The audit-doc tooltip on the role line still shows the full provider chain so operators who want to drill in can.

## Gates run (Mai re-verified on post-PR-#42 base)

```
$ git rev-parse HEAD
4c7cc1189fb55d518a049e3e0180b48ceeabeb85  # confirms post-PR-#42 base

$ npx vitest run src/lib/__tests__/agent-card-helpers.test.ts
✓ src/lib/__tests__/agent-card-helpers.test.ts (38 tests) 10ms
Test Files  1 passed (1)
Tests       38 passed (38)

$ npx tsc --noEmit
(clean)
```

## Findings / caveats

### C1 — Provider list maintenance is on this file, not config

Adding a new free/paid provider requires editing the two `readonly string[]` constants in `agent-card-helpers.ts`. That's intentional — the lists live next to the classification logic and are unit-tested. A config-driven list would risk drift (operator adds the provider to config but forgets to update the matching unit test, or vice versa).

### C2 — 9router / lite-llm / litellm style routers stay "unknown"

Multi-provider routers can route the same model id to either a free or paid backend depending on operator config. Classifying them as either tier would be a lie 50% of the time. Hiding the badge is the correct shape: operator looks at the router config when the eventual cost matters.

### C3 — Subprefix matching is conservative on purpose

`anthropic-stage` → paid, `ollama-vps` → free, but `anthropic-fakefree-rebrand` → still paid (matches `anthropic-` subprefix). The helper does not look INSIDE the provider name for keywords like `free` or `paid`. A vendor that offers both free and paid SKUs under the same prefix would need a more granular classifier; out of scope for Phase 5.6.

### C4 — Tone color is "amber" not "red" for paid

Paid does not equal "danger" — it just costs money. Red would over-alarm. Amber is the right tone for "spend awareness". If Tyler later wants harder cost-blocking, that's a separate Phase 5.x feature.

### C5 — Phase 3.1 caveat C2 closure clarification

Phase 3.1 audit deferred "full provider routing visibility" to Phase 5.1. PR #38 closed C2 partially by exposing the routing chain inline. Phase 5.6 adds the cost dimension on top. The two together fully close the original ambiguity Phase 3.1 documented.

## What this PR does not do

- Does not change the underlying model id storage shape.
- Does not auto-edit any agent's config.
- Does not block destructive actions (wake/dispatch) on paid agents — pure visual signal, operator still in control.
- Does not surface per-token cost estimates (that lives in `task-costs.ts` and is its own surface).
- Does not classify within-router routes (a future provider-routing-aware classifier could read `9router` config and resolve `cx/gpt-5.5` → `openai/gpt-4o`; out of scope here).
- Does not add component-level RTL tests (no precedent in `src/`; helper coverage at 38 cases pins the consumer contract).

## Risk and rollback

- Risk: very low. Two new pure helpers + 9 unit tests + 3 minimal panel changes. Existing agents render byte-identically except for the new badge inset.
- Rollback: revert this PR's diff. Helpers retire (no other consumers); panel reverts to the role-line shape from PR #38.

## Refs

- Đào msg 1705 (2026-04-27T13:26Z) — Phase 5.6 assignment, ETA 00:05:00+10:00.
- PR #42 — Phase 5.5 avatar gallery, merged at `4c7cc11`.
- `docs/audit/MISSION_CONTROL_ROADMAP.md` § 5.6 — task definition.
- `docs/audit/PHASE_3_1_AGENT_PANEL_SMOKE.md` C2 — original ambiguity, fully closed by PR #38 (provider chain) + this PR (cost dimension).
- `src/lib/agent-card-helpers.ts` — `classifyProviderTier` + `tierLabel` (this PR).
- `src/lib/__tests__/agent-card-helpers.test.ts` — 9 new cases (this PR).
- `src/components/panels/agent-squad-panel-phase3.tsx` — badge wire-in (this PR).

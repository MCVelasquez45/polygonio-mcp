# Sprint 2E — Watchlist-Driven Autonomous Paper Automation (100% completion)

Makes the **user watchlist the single authoritative source** of the automation
universe and brings the watchlist → Massive → deterministic flow → risk →
approved intent → Alpaca-paper lifecycle to verified runtime readiness.

## What changed

- **Server-side watchlist** (`features/watchlist/*`): `WatchlistItem` model (additive;
  no prior server watchlist existed), `WatchlistService` (CRUD + validation), and a
  cached **Automation Universe Provider** (read-through cache, TTL 15–60s default 30s,
  invalidated on every write) — the scheduler depends on this abstraction, not on Mongo layout.
- **Scheduler integration**: `optionsFlowUniverseEvaluator` now sources its universe from the
  provider (no `AUTOMATION_UNDERLYINGS` in the active path). Per-symbol watchlist controls
  (priority, min/maxDTE, maxSpread%, minConfidence) apply as effective config; the risk engine
  is untouched.
- **Deterministic candidate ranking**: confidence → premium flow → liquidity → spread →
  watchlist priority → symbol. One approved intent maximum preserved.
- **Fail-closed empty universe**: `WATCHLIST_EMPTY` (not `UNIVERSE_NOT_CONFIGURED`), no
  market-data or broker calls.
- **Observability**: `WATCHLIST_{CACHE_HIT,CACHE_MISS,REFRESH,LOADED,SYMBOL_COUNT,EMPTY,
  SYMBOL_SKIPPED,SYMBOL_EVALUATED,CANDIDATE_SELECTED}` + a per-tick `EVALUATION_HEARTBEAT`
  (mirrors `MONITOR_HEARTBEAT`). No `console.log`.
- **REST + UI**: `GET/POST/PATCH/DELETE /api/watchlist`, `/:symbol/automation`, `/universe`,
  `/refresh`; client API `client/src/api/watchlist.ts` + `WatchlistControlCenter.tsx`.
- **Docs**: `docs/automation/sprint-2e-watchlist-universe.md` (architecture, schema, refresh
  decision, ranking, submission semantics, cURL, pre-market checklist, paper-smoke runbook);
  `.env.example` marks `AUTOMATION_UNDERLYINGS` deprecated and documents
  `AUTOMATION_WATCHLIST_CACHE_TTL_MS`.

## Preserved (unchanged)

Execution gateway, broker adapter, monitoring scheduler, exit engine, risk engine, manual
trading, broker reconciliation, position lifecycle, restart recovery, research/manual/automation
isolation. Schema changes are additive and backward compatible.

## Tests

```
server:  node --test server/tests/*.test.mjs  → 316 pass / 0 fail / 0 skipped
client:  vitest run                            → 9 pass / 0 fail
build:   tsc (server)                          → exit 0
```

New: `automation2e.watchlist.test.mjs` (11), `automation2e.provider.test.mjs` (8) — empty/all-disabled
fail-closed, disabled-ignored, priority ordering, one-position max, no-duplicate-intent, dynamic
add/remove/disable/priority without restart, cache hit/miss/expire/invalidate, normalization/dedupe,
scheduler→watchlist→flow→approved-intent with zero submissions.

## Runtime verification (real boot, market closed → read-only)

- Atlas connected (`market-copilot`); Alpaca **paper** account reachable (`paper=true`); reconciliation **CLEAN**; existing equity positions (AMD, SPY) **not adopted**.
- Both schedulers ACTIVE with **separate leases**; `MONITOR_HEARTBEAT` + `EVALUATION_HEARTBEAT` healthy (`ownsLease:true`); graceful SIGTERM releases both leases.
- Live Massive options chain via server (`SPY` underlying 751.95, options REST OK, profile `options-advanced`).
- **Watchlist proven as the runtime universe**: via live API, added SPY/QQQ (auto) + IWM (research-only) → `/universe` returned priority-ordered `["QQQ","SPY"]`, IWM excluded; priority change, automation-disable, and delete all reflected **with no restart**.

## Recommendation

`CONDITIONAL GO — WATCHLIST-DRIVEN ALPACA PAPER AUTOMATION` — the only remaining gate is the
operator-supervised open-session paper round-trip (cannot be forced; market was closed at verification).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

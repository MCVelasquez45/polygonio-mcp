# Sprint 2E — Watchlist-Driven Automation Universe

The Watchlist is now the **single source of truth** for the automation universe.
The scheduler asks a Watchlist Service (via a cached Automation Universe
Provider) for its symbols every cycle. There is no `AUTOMATION_UNDERLYINGS`
symbol list in the active path, no hardcoded array, and no restart required when
the watchlist changes.

## Architecture

```
User (Watchlist Control Center UI)
        │  POST/PATCH /api/watchlist        (writes invalidate the cache)
        ▼
Watchlist Service  (watchlist.service.ts)          ← CRUD + validation
        │
        ▼
Automation Universe Provider (automationUniverseProvider.service.ts)
        │  cached read, TTL refresh, fail-closed
        ▼
Evaluation Scheduler (schedulerController → defaultEvaluateSession)
        │
        ▼
OPTIONS_NATIVE_FLOW evaluator (optionsFlowUniverseEvaluator.service.ts)
        │  per-symbol flow → deterministic rank → best candidate
        ▼
Risk Engine (unchanged) → Approved Intent → Execution Gateway → Alpaca Paper
```

## Watchlist schema (`automation_watchlist`)

Additive-only; there was no prior server-side watchlist. One document per symbol.

| Field | Type | Notes |
|---|---|---|
| `symbol` | string | unique, uppercased |
| `enabled` | boolean | master on/off |
| `automationEnabled` | boolean | opt-in to autonomous trading (default **false**) |
| `priority` | number | lower = higher priority (ranking tiebreak) |
| `strategy` | enum | `OPTIONS_NATIVE_FLOW` (only active); field is future-ready |
| `minConfidence` | number | overrides the flow score gate for this symbol |
| `maxPositionSize` | number | recorded; **advisory** until wired to sizing (debt) |
| `maxSpreadPercent` | number | percent → `contract.maxSpreadPct` (÷100) |
| `minDTE` / `maxDTE` | number | overrides the contract DTE window |
| `notes` | string? | operator note |
| `automationStatus`, `lastEvaluationAt`, `lastSignal`, `lastSignalAt`, `lastTradeAt` | telemetry | UI only — never gates a decision |

Future strategies (`EQUITY_MOMENTUM`, `VOLATILITY_BREAKOUT`, `NEWS_EVENT`,
`GPT_RESEARCH_ONLY`) are accepted by the enum but **not implemented** — a symbol
carrying one is skipped with `WATCHLIST_SYMBOL_SKIPPED` / `WATCHLIST_STRATEGY_INACTIVE`.

## Scheduler changes

Each evaluation cycle: load watchlist → filter `enabled && automationEnabled` →
rank by priority → evaluate every symbol under OPTIONS_NATIVE_FLOW → collect
signals → drop NO_TRADE → rank (**confidence → premium flow → liquidity → spread
→ watchlist priority → symbol**) → take the best candidate → Risk Engine → one
Approved Intent → existing execution pipeline. **One autonomous position maximum
is preserved** (the risk engine's concurrency + unresolved-order gates).

## Runtime refresh mechanism — decision

**Chosen: Option B (cached read + TTL refresh), plus write-invalidation.**

- The provider caches the universe for `AUTOMATION_WATCHLIST_REFRESH_MS`
  (default 30s, clamped 15–60s).
- Every watchlist **write** (via the service) calls
  `invalidateAutomationUniverseCache()` so operator changes are effective
  **immediately**, not merely within the TTL.
- The TTL refresh catches out-of-band DB edits.

Rationale over a Mongo change stream: change streams require a replica set
(local standalone Mongo and `mongodb-memory-server` do not provide one without
extra setup), add a long-lived cursor to supervise, and buy little for a
human-timescale list. Option B is the simplest **reliable** choice. **No server
restart is ever required** to pick up a watchlist change.

## Fail-closed behavior

- **Empty watchlist** (none enabled+automationEnabled) → `WATCHLIST_EMPTY`
  logged, outcome `WATCHLIST_EMPTY`, **no evaluation, no broker requests**.
- **All symbols disabled** → same as empty.
- **Mongo down / load failure** → empty universe (fail closed).
- Disabled symbols (`automationEnabled=false` or `enabled=false`) are never evaluated.

## Structured logging (no `console.log`)

`WATCHLIST_LOADED`, `WATCHLIST_SYMBOL_COUNT`, `WATCHLIST_REFRESH`,
`WATCHLIST_EMPTY`, `WATCHLIST_SYMBOL_SKIPPED`, `WATCHLIST_SYMBOL_EVALUATED`,
`WATCHLIST_CANDIDATE_SELECTED` — all via the redacted `logAutomationEvent` journal.

## REST API (Control Center)

`GET /api/watchlist`, `GET /api/watchlist/universe`, `POST /api/watchlist/refresh`,
`POST /api/watchlist`, `PATCH /api/watchlist/:symbol`,
`POST /api/watchlist/:symbol/automation`, `DELETE /api/watchlist/:symbol`.
The client control center lives at `client/src/components/watchlist/WatchlistControlCenter.tsx`
(status chips: 🟢 Monitoring · 🟡 Waiting for Baseline · 🔵 Evaluating · 🟠 Position Open · 🔴 Disabled).

## Preserved (unchanged)

Execution gateway, broker adapter, monitoring scheduler, exit engine, risk
engine, manual trading, broker reconciliation, position lifecycle, restart
recovery. Only the **source** of the automation universe changed.

## Execution controls (submission semantics)

| `AUTOMATION_ENABLED` | `AUTOMATION_SUBMIT_APPROVED_INTENTS` | Behavior |
|---|---|---|
| `false` | any | No init, no evaluation, no submission. |
| `true` | `false` (default) | Evaluate the watchlist, create governed `APPROVED_AWAITING_EXECUTION` intents, **do not submit**. |
| `true` | `true` | Full autonomous paper lifecycle (submit → fill → monitor → exit). |

Watchlist `automationEnabled` never overrides the global emergency stop or the
submission flag; it only opts a symbol into evaluation. Submission must be turned
on intentionally by the operator — never during deployment.

## cURL — managing the automation universe

```bash
# Read the watchlist (control center)
curl -s localhost:4000/api/watchlist

# Resolved automation universe (what the scheduler will evaluate now)
curl -s localhost:4000/api/watchlist/universe

# Add a symbol (research on; automation OFF by default)
curl -s -X POST localhost:4000/api/watchlist \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"SPY","automationEnabled":false}'

# Enable automation for a symbol
curl -s -X POST localhost:4000/api/watchlist/SPY/automation \
  -H 'Content-Type: application/json' -d '{"enabled":true}'

# Update priority / DTE / spread / confidence
curl -s -X PATCH localhost:4000/api/watchlist/SPY \
  -H 'Content-Type: application/json' \
  -d '{"priority":10,"minDTE":7,"maxDTE":21,"maxSpreadPercent":8,"minConfidence":0.6}'

# Disable automation (keep researching it)
curl -s -X POST localhost:4000/api/watchlist/SPY/automation \
  -H 'Content-Type: application/json' -d '{"enabled":false}'

# Remove entirely
curl -s -X DELETE localhost:4000/api/watchlist/SPY
```

## Pre-market checklist

1. `ALPACA_PAPER=true` and base URL is `paper-api.alpaca.markets`.
2. `GET /api/automation/health` → all gates `pass`, `automationReady: true`, reconciliation `clean`.
3. Both schedulers `ACTIVE` (`GET /api/automation/scheduler` → state ACTIVE; `MONITOR_HEARTBEAT` + `EVALUATION_HEARTBEAT` in logs, each `ownsLease: true`).
4. No unknown broker positions/orders adopted (reconciliation `CLEAN` with `brokerPositions: 0` for options).
5. Curate the watchlist: enable automation on **one or a few liquid symbols**; verify `GET /api/watchlist/universe`.
6. Emergency stop known/disabled for the session.
7. To go live: set `AUTOMATION_ENABLED=true` and `AUTOMATION_SUBMIT_APPROVED_INTENTS=true` **intentionally**.

## Paper-smoke runbook

During an open regular options session, with a small enabled watchlist and
submission on, observe (do not force a signal):

```
watchlist loaded → baseline initialized → window completed → deterministic signal
→ ranked candidate → risk approved → approved intent → ONE paper order
→ broker reconciliation → position OPEN → monitoring → deterministic exit
→ position CLOSED → realized P&L + risk counters (once)
```

A no-signal session is a **safe success**: report
`NO VALID SIGNAL — SYSTEM REMAINED HEALTHY AND SAFE`.

## Technical debt

- `maxPositionSize` is recorded but not yet enforced in position sizing (sizing
  is owned by the untouched risk engine; wiring it is a future, explicit change).
- `POSITION_OPEN` telemetry is set at approved-intent time; a monitor-side hook
  could set/clear it from true position lifecycle without touching the monitor's
  decisions.
- The legacy EQUITY_MOMENTUM path (`processUniverseTick`) still reads the env
  universe. It is inactive under the current entitlement and left untouched.
- Reconciliation's broker-position matching still consults the env universe as a
  safety fallback; it is a preserved component and out of scope here.

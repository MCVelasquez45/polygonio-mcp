# Sprint 2F — Final Production Alignment

Verification + safe alignment sprint. **No redesign of the deterministic engine.**
The system already had most single-source-of-truth invariants; this sprint proves
them, closes small gaps, and adds a composite health surface.

## Single source of truth — verified

| Concern | Single implementation | Evidence |
|---|---|---|
| Automation universe | `WatchlistService` → `AutomationUniverseProvider.getAutomationUniverse()` | evaluator uses only the provider; env symbols ignored (tested) |
| Scheduler | one evaluation controller + one monitor controller (DB leases) | `SCHEDULER_STARTED` / `MONITOR_STARTED`, distinct owners |
| Execution | one `ExecutionGateway` / broker adapter; no direct Alpaca | `orderSubmission` imports only `PaperBrokerAdapter` |
| Massive requests | one shared **request manager** in `massive.ts`: queue + priority + **inflight dedup** + retry/backoff + response cache | `getMassiveRequestStats()`; orchestrator adds chain/reference/quote caches |
| Submission gate | one env flag `AUTOMATION_SUBMIT_APPROVED_INTENTS` (operator control) | line 204 `schedulerController`; **no Sprint 1 guard remains** |

## Changes

- **Watchlist schema (additive)** — added `allowedStrategies`, `minimumOpenInterest`,
  `minimumVolume`, `maximumIV`, `riskProfile`; API responses expose `ticker`
  (alias of `symbol`, the canonical key). `minimumOpenInterest`/`minimumVolume`
  are wired into the per-symbol effective contract config (same pattern as
  DTE/spread); `maximumIV`/`riskProfile`/`allowedStrategies` are recorded metadata
  (not wired into the deterministic selector — no engine change). The primary
  `strategy` field remains the activation gate.
- **No hardcoded/demo symbols** — the launch seeder now **requires explicit
  symbols** (no `SPY` default, never seeds demos); preflight probes Massive with
  the **first watchlist symbol** instead of a hardcoded ticker.
- **Stale Sprint 1 log notes** removed/corrected (they were cosmetic; submission
  was already wired via the env flag).
- **`GET /api/system/health`** — composite GREEN/YELLOW/RED for mongo, risk,
  automation, signalMode, submission, scheduler, monitor, heartbeat, broker,
  execution, alpaca, massive, queue, rateLimit, cache, watchlist, websocket.
  Fast + read-only (in-process signals + last-known broker/market truth).

## Audit result (no demo symbols in the automation universe)

`SPY`/`AMD` references elsewhere in the repo are in **unrelated features** — GPT
prompt examples (`deskInsight`, `watchlistReports`), the options-research checklist
(`optionsChecklist` CONTEXT_SYMBOLS), futures ETF mapping (`polygonGateway`), and
the strategy NLP parser default — none feed the automation universe. Legacy
`AUTOMATION_UNDERLYINGS` / `resolveUniverse` remain only in the **inactive**
equity-momentum path (`processUniverseTick`), which the production config never
selects (OPTIONS_NATIVE_FLOW default; startup warns if the env var is set).

## Deliberately NOT done (rationale — night before launch, proven runtime)

These directive items would **redesign working, proven subsystems** and risk the
launch; they are documented as post-launch hardening, not silently claimed:

- **New central request manager** — one already exists in `massive.ts` (queue +
  dedup + backoff + cache). Building a second would create the duplication the
  sprint forbids. No 429/rate-limit errors were observed in any runtime boot.
- **WebSocket single-subscription rearchitecture** — the shared live feed already
  exists; a full client+server rewrite is high-risk and out of scope for alignment.
- **Renaming `symbol`→`ticker` across the stack** — a breaking redesign; `symbol`
  IS the ticker and `ticker` is exposed as an alias instead.
- **Failing startup** on deprecated env vars — kept as a loud warning; a hard
  fail could block launch for a benign leftover.

## Verification

- server `tsc` 0 · client strict `tsc` 0 · client build 0
- server tests **333 pass / 0 fail** · client tests **9 pass**
- Live boot: `/api/system/health` → 17/18 GREEN (submission YELLOW by design);
  schedulers ACTIVE, heartbeats fresh, Alpaca paper, Massive OK, queue depth 0,
  watchlist [SPY]; graceful shutdown released both leases.

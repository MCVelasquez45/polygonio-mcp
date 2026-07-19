# Phase 2C — Live-Data Automated Paper Trading

Phase 2C connects the deterministic decision engine to real execution: a
complete paper-options lifecycle driven by **live Massive options data** and
**Alpaca paper-broker truth**. The broker, mark, and clock paths in normal
runtime are live (not simulated). The **entry signal** is the exception — see
"Entry-signal wiring status" below: the options-native flow engine is
implemented and unit-tested but is **not yet wired** into the production
evaluation pipeline, which still runs the equity-momentum bar path.

```
market opens (authoritative broker clock)
 → options-native flow windows evaluated (authorized data only)  [TARGET — not yet wired]
 → deterministic signal → contract → risk decision (persisted)
 → approved intent submitted to Alpaca paper (idempotent)
 → broker order reconciled → partial/full fill persisted
 → automation position OPEN, monitored from real quotes
 → deterministic exit triggered → exit order submitted + reconciled
 → position CLOSED from broker truth
 → realized P&L computed → session risk counters updated
 → full lifecycle shown in the Portfolio command center
```

## Entry-signal wiring status — options-native signal NOT yet wired

> **Runtime-readiness note (verified 2026-07-14).** The production evaluation
> pipeline (`schedulerController → defaultEvaluateSession → processUniverseTick`)
> runs the **equity-momentum bar strategy** (`evaluateStrategy` over underlying
> 5-minute aggregates from `fetchUnderlyingBars`). The Options Advanced plan does
> **not** authorize real-time stock intraday aggregates, so `assessSymbol` gates
> every symbol closed (`UNDERLYING_DATA_NOT_REALTIME` / `UNDERLYING_DATA_UNAUTHORIZED`)
> and the wired evaluator can only ever produce `NO_ELIGIBLE_SYMBOLS`.
>
> The `OPTIONS_NATIVE_FLOW` engine below (`optionsFlowSignal.service.ts`,
> `getSignalMode`, `getOptionsFlowConfig`) is **fully implemented and unit-tested
> but imported nowhere in the live path** — `getSignalMode()` is never consumed
> by `processUniverseTick`. Until the flow engine is wired (baseline-snapshot
> persistence + `buildFlowWindowFromSnapshots` + `evaluateOptionsFlow` +
> contract selection from the flow direction, all restart-durable), the entry
> side is **NOT launch-ready** and the recommendation remains NO-GO.

The Options Advanced plan does **not** authorize real-time stock intraday
aggregates (verified in commit `66a5aa9`). The **intended** default signal mode
is therefore `OPTIONS_NATIVE_FLOW`
(`server/.../services/optionsFlowSignal.service.ts`), which derives direction
**entirely from authorized real-time options data**:

- Completed observation windows (`AUTOMATION_OPTIONS_FLOW_WINDOW_MINUTES`, default 5),
  compared to a baseline window (`AUTOMATION_OPTIONS_BASELINE_WINDOW_MINUTES`, default 30).
- Window flow is computed by **differencing cumulative day volume** between two
  authorized chain snapshots — genuine intra-window activity, never open
  interest, never delayed underlying context.
- Deterministic features: call/put premium, call-to-put premium ratio, net
  directional premium (tilt), call/put volume, volume acceleration, IV, IV
  skew, OI context, contracts/expirations represented, provider timestamps,
  window completeness.
- Direction: `BULLISH` when tilt ≥ `netPremiumTiltMin` **and** call/put volume
  ratio ≥ `volumeRatioMin`; `BEARISH` mirror; otherwise `NO_TRADE`. A
  conviction score gates low-signal windows. **No AI. No guessing.** Balanced,
  stale, incomplete, or insufficient windows are `NO_TRADE`/`DATA_REJECTED`.

`EQUITY_MOMENTUM` remains available but is warned at startup as unauthorized.

## Market-hours operation

`marketSession.service.ts` derives the session phase purely from the
**authoritative broker clock's `next_close`** (holiday/early-close aware — no
hardcoded 9:30–16:00):

| Phase | Trigger (minutes to close) | Behavior |
|---|---|---|
| `PRE_CUTOFF` | > final-entry cutoff | entries allowed |
| `POST_ENTRY_CUTOFF` | ≤ 45 (default) | no new entries; keep monitoring |
| `CANCEL_ENTRIES` | ≤ 20 | cancel unfilled entry orders |
| `FLATTEN` | ≤ 15 | exit all automation positions |
| `CLOSED` | market closed | no entries, no ordinary exits |

No automation position is intentionally held overnight in V1.

## Schedulers + single-owner leases

Two independent boot-time schedulers, each holding its own database-backed
single-owner lease (`schedulerLease.model.ts`), together make the lifecycle
autonomous. A crashed owner's lease expires and is reclaimable; **two processes
can never drive the same scope** (scopes `automation-scheduler` and
`automation-monitor`). Both start only after initialization + startup
reconciliation succeed, and both are gated on automation-READY + the
authoritative market clock every tick (fail closed).

| Scheduler | File | Owns | Per tick |
|---|---|---|---|
| Evaluation | `schedulerController.service.ts` | Entries | evaluate → risk → approve → submit (once per window) |
| Monitoring | `monitorController.service.ts` | Everything after a fill | monitor stop/target → cancel unfilled entries → reconcile `EXITING` → flatten before close |

The monitoring scheduler drives `automation.scheduler.ts::runSchedulerTick`
with **no entry evaluator** (entries are the evaluation scheduler's exclusive
job), for every session that owns a live position. Its authoritative option
mark is a fail-closed provider that reuses the entitled option-chain fetch; any
missing/stale quote suppresses price triggers rather than inventing a mark.
Every monitoring tick emits a structured `MONITOR_HEARTBEAT` (lease, Mongo,
broker, broker-truth freshness, market phase, open/EXITING/MANUAL_REVIEW/stale
position counts).

## Order + fill lifecycle (broker truth only)

- Entries submit through the **existing** `submitIntent` (persist-then-act,
  idempotent `client_order_id`, ambiguous-failure parking). Phase 2C extends
  the submittable states to include `APPROVED_AWAITING_EXECUTION`.
- Entry limit price: deterministic `AUTOMATION_ENTRY_LIMIT_POLICY` (MID default)
  from authoritative bid/ask, capped by `AUTOMATION_ENTRY_MAX_SLIPPAGE_PCT`.
- Fills come only from broker responses (`recordBrokerOrderSnapshot` rejects any
  payload lacking broker identity). Partial fills advance quantity/avg price;
  duplicate/out-of-order events never regress a terminal state.
- Positions (`automationPosition.model.ts`) transition
  `PENDING_ENTRY → OPEN → EXITING → {CLOSED | MANUAL_REVIEW}`, always from broker
  truth. Ownership is proven by the entry `client_order_id`; manual positions are
  never managed.

## Exits

`exitEngine.service.ts` (pure) ranks triggers:

```
EMERGENCY_STOP > END_OF_DAY > HARD_STOP > BROKER_MANUAL_CLOSE
  > OPERATOR_CLOSE > PROFIT_TARGET > STRATEGY_INVALIDATION
```

The highest-priority active trigger wins; once a position is `EXITING`, no
second exit is created (atomic claim). Stop/target are snapshotted at first fill
(`AUTOMATION_STOP_LOSS_PCT` / `AUTOMATION_PROFIT_TARGET_PCT`) so later config
changes never alter an open trade. Price triggers are suppressed when the quote
is stale (data-outage safety); the position is never abandoned.

### EXITING is never a terminal trap (exit recovery)

Each exit order is submitted through the durable intent journal with a
**position-and-attempt-scoped** `client_order_id` (`exit:{positionId}:{attempt}`),
so every position maps to exactly one deterministic exit identity per attempt —
no collision, even for two same-underlying positions. `reconcileExit` drives an
`EXITING` position to a terminal resolution deterministically:

| Broker truth for the exit order | Action |
|---|---|
| Fully filled | `CLOSED` (realized P&L recorded once) |
| Rejected / cancelled / expired, **zero** fill, attempts remain | retry a new exit order |
| Rejected / cancelled / expired, retries exhausted | `MANUAL_REVIEW` |
| Terminal after a **partial** fill | `MANUAL_REVIEW` (never auto-retry — over-sell safety) |
| Still working, within `AUTOMATION_EXIT_TIMEOUT_MS` | keep monitoring |
| Still working / broker unreachable, past timeout | `MANUAL_REVIEW` |

A position therefore **never remains indefinitely in `EXITING`** and is never
orphaned: it is either closed, retried, or handed to an operator with a durable
`manualReviewReason`. Retries are bounded by `AUTOMATION_MAX_EXIT_RETRIES`.

## Risk-accounting feedback loop

`riskAccounting.service.ts` closes the loop the readiness review flagged. After a
broker-confirmed close, realized P&L is computed from broker fills:

```
entryCost    = entryPrice × qty × 100 + entryFees
exitProceeds = exitPrice  × qty × 100 − exitFees
realizedPnl  = exitProceeds − entryCost
```

> Fees: Realized paper P&L currently uses broker-confirmed entry and exit
> prices. The integration does not yet ingest a separate commission or
> regulatory-fee source. Fee fields default to zero until such a source is
> implemented (see Known limitations).

and the session counters are updated **atomically, once** (idempotent
`riskCounted` guard):

- `dailyRealizedPnl`, `dailyTradeCount` (one per completed round-trip),
- `consecutiveLossCount` (WIN → 0, LOSS → +1, BREAKEVEN → unchanged),
- `peakEquity`, `currentDrawdown`, `maxDrawdown`, `lastTradeResult`.

The risk engine reads these exact fields on its next decision, so completed
outcomes genuinely constrain future trading (proven by test). Daily resets use
the exchange trading date; restart can rebuild counters from durable closed
trades.

## Preserved safety boundaries

MongoDB-required gate · paper-only Alpaca guard (now also refuses `mock` in
production) · idempotent intents · persist-before-act · broker-truth fills ·
startup reconciliation · manual-review handling · emergency stop · data
completeness gates · options-entitlement alignment · configurable universe ·
deterministic selection/risk · **AI excluded from signal, order, risk, and exit
authority**.

## Environment

See `server/.env.example` (Phase 2C block). Startup validation
(`validateAutomationConfig`) fails closed on contradictory cutoffs, non-positive
stop/target/timeout, invalid exit retry/timeout, `AUTOMATION_MAX_CONCURRENT_POSITIONS ≠ 1`
(the lifecycle is validated for exactly one concurrent position — see Known
limitations), and `AUTOMATION_BROKER=mock` in production; it warns on
`EQUITY_MOMENTUM` and non-`options-advanced` profiles.

## Known limitations

- **Single concurrent position.** The autonomous lifecycle is validated and
  supported for exactly one open automation position (`AUTOMATION_MAX_CONCURRENT_POSITIONS=1`).
  Startup **refuses** any other value. Multi-position support (independent exit
  keys already in place) is a future, explicitly-designed sprint.
- **Live commission/exchange fees.** Realized paper P&L currently uses
  broker-confirmed entry and exit prices. The integration does not yet ingest a
  separate commission or regulatory-fee source. Fee fields default to zero until
  such a source is implemented. The `entryFees`/`exitFees` fields are ready for a
  live fee source.
- **Live option-mark provider** reuses the option-chain fetch and finds the held
  contract in-chain; if the contract's DTE drifts outside the configured chain
  window the mark returns stale (price triggers suppressed) until end-of-day
  flatten. Positions are short-dated and flattened intraday, so this is bounded.

## Tests

`server/tests/automation2c.*.test.mjs`: signal engine, market-session phases,
exit engine, risk feedback (pure + persisted), full lifecycle (approved → submit
→ fill → OPEN → target → exit → CLOSED → risk), scheduler lease, portfolio
ownership, runtime authenticity. Run `npm run test:automation`. See
`test-to-requirement matrix` in the PR body.

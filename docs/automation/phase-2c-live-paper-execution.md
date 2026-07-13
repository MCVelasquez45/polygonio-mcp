# Phase 2C — Live-Data Automated Paper Trading

Phase 2C connects the deterministic decision engine to real execution: a
complete paper-options lifecycle driven by **live Massive options data** and
**Alpaca paper-broker truth**. Nothing in normal runtime is simulated.

```
market opens (authoritative broker clock)
 → options-native flow windows evaluated (authorized data only)
 → deterministic signal → contract → risk decision (persisted)
 → approved intent submitted to Alpaca paper (idempotent)
 → broker order reconciled → partial/full fill persisted
 → automation position OPEN, monitored from real quotes
 → deterministic exit triggered → exit order submitted + reconciled
 → position CLOSED from broker truth
 → realized P&L computed → session risk counters updated
 → full lifecycle shown in the Portfolio command center
```

## Data blocker resolved — options-native signal

The Options Advanced plan does **not** authorize real-time stock intraday
aggregates (verified in commit `66a5aa9`). The default signal mode is therefore
`OPTIONS_NATIVE_FLOW` (`server/.../services/optionsFlowSignal.service.ts`),
which derives direction **entirely from authorized real-time options data**:

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

## Scheduler + single-owner lease

`automation.scheduler.ts` runs one tick: market-session gate → entry evaluation
(PRE_CUTOFF only) → cancel unfilled entries (cancel window) → monitor live
positions → flatten (flatten window). `schedulerLease.model.ts` provides a
database-backed lease (`acquireSchedulerLease`) so **two processes can never
submit the same trade**; a crashed owner's lease expires and is reclaimable.
The scheduler starts only after initialization + startup reconciliation succeed.

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
  `PENDING_ENTRY → OPEN → EXITING → CLOSED`, always from broker truth. Ownership
  is proven by the entry `client_order_id`; manual positions are never managed.

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

## Risk-accounting feedback loop

`riskAccounting.service.ts` closes the loop the readiness review flagged. After a
broker-confirmed close, realized P&L is computed from broker fills:

```
entryCost    = entryPrice × qty × 100 + entryFees
exitProceeds = exitPrice  × qty × 100 − exitFees
realizedPnl  = exitProceeds − entryCost
```

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
stop/target/timeout, and `AUTOMATION_BROKER=mock` in production; it warns on
`EQUITY_MOMENTUM` and non-`options-advanced` profiles.

## Tests

`server/tests/automation2c.*.test.mjs`: signal engine, market-session phases,
exit engine, risk feedback (pure + persisted), full lifecycle (approved → submit
→ fill → OPEN → target → exit → CLOSED → risk), scheduler lease, portfolio
ownership, runtime authenticity. Run `npm run test:automation`. See
`test-to-requirement matrix` in the PR body.

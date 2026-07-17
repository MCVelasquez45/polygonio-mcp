# Trading Session Capture

Milestone: Version 2, Milestone 1

Trading Session Capture creates an immutable daily intelligence record from evidence already produced by the Version 1 automation system.

## Purpose

- Preserve the trading day.
- Summarize evaluations, rejections, trades, orders, provider state, and health.
- Link back to source evidence.
- Support later trade reports, daily reports, analytics, and advisory recommendations.

## Non-Goals

- No trade execution.
- No broker calls.
- No new market-data calls.
- No strategy optimization.
- No threshold changes.
- No report generation beyond the session summary.

## Source Ownership

See `docs/architecture/v2-trading-session-source-map.md`.

The session record prefers references plus summaries:

- References point to V1 evidence records.
- Summaries make the day queryable.
- Missing evidence is represented as `null` or warning codes.

## Mongo Schema

Model:

```text
server/src/features/intelligence/models/tradingSession.model.ts
```

Collection:

```text
intelligence_trading_sessions
```

Key fields:

- `sessionId`
- `tradingDate`
- `environment`
- `automationSessionId`
- `status`
- `evaluationSummary`
- `tradeSummary`
- `orderSummary`
- `providerSummary`
- `automationHealth`
- `references`
- `warnings`
- `errors`
- `generation`

## Index Strategy

- Unique `sessionId`.
- Unique `tradingDate + environment + automationSessionId`.
- Query indexes on `tradingDate`, `status`, and `updatedAt`.

## Immutability

Before finalization, capture can update the session record.

After `FINALIZED`, normal saves and update queries are blocked. Future regeneration should use explicit amendment/version behavior rather than silently overwriting finalized evidence.

## Finalization

Finalization is deterministic and idempotent. The gate records reasons when it cannot finalize.

Blocked examples:

- Market status is open or unavailable.
- Scheduler evaluation is in flight.
- Reconciliation is not clean.
- Active non-recovery positions remain.
- Order intents remain unresolved.
- Manual-review state exists.

## Backfill

Backfill is manually invoked:

```bash
npm --prefix server run intelligence:backfill-session -- 2026-07-16
```

Expected known paper-trading outcome if all V1 evidence is present:

```text
XLE bullish call: +$2.00, END_OF_DAY
SPY bearish put: -$58.00, OVERNIGHT_RECOVERY
Daily realized P/L: -$56.00
```

These values are not hardcoded into production logic. The backfill derives totals from `AutomationPosition.realizedPnl`.

## Known Limitations

- V1 does not persist account-level portfolio snapshots by trading date.
- V1 provider error counts are not persisted; runtime provider counters are available only for the current process.
- Market open/close timestamps are not persisted as standalone daily fields.
- Historical watchlist state is reconstructed from evaluation `configuredSymbols`; current watchlist is only a fallback.
- This milestone provides a minimal Sessions UI only.

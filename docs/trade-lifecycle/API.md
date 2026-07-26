# Trade Lifecycle API

All endpoints are read-only.

## `GET /api/trade-lifecycle/status`

Returns feature flags, AI status, paper-trading status, market state, current
strategy/regime, next evaluation, latest AI decision, lifecycle counts, and
scheduler status.

## `GET /api/trade-lifecycle/active`

Returns lifecycle records in active states from entry through pending exit.

## `GET /api/trade-lifecycle/pending`

Returns lifecycle records waiting for risk, entry, or execution progress.

## `GET /api/trade-lifecycle/history`

Returns archived or post-exit lifecycle records.

## `GET /api/trade-lifecycle/timeline`

Returns lifecycle journal events and automation audit context. Use `tradeId` to
filter to one trade.

## `GET /api/trade-lifecycle/evaluations`

Returns lifecycle records with stored evaluation summaries and matching trade
reports when available.

# Enterprise Trade Lifecycle Manager

The Trade Lifecycle Manager is an additive owner layer for autonomous paper
trades. It does not decide entries, duplicate execution, or call Alpaca
directly. It reads the existing automation position, order intent, risk,
strategy, event, and evaluation records, then persists a richer lifecycle state
and append-only journal.

## Architecture

Approved autonomous trade evidence flows through the existing platform.

Massive Data -> Event Intelligence -> Decision Intelligence -> Strategy
Orchestrator -> Enterprise Risk Engine -> Trade Lifecycle Manager -> existing
automation order-intent execution path -> Alpaca Paper -> Trade Evaluation ->
Learning Journals.

The lifecycle service owns monitoring records and recommendations. Broker order
submission remains delegated to the existing durable order-intent services.

## Lifecycle States

Trades move through explicit states:

`NEW -> PENDING_ENTRY -> ENTRY_SUBMITTED -> ENTRY_FILLED -> MONITORING`

`PARTIAL_EXIT -> EXIT_PENDING -> EXIT_FILLED -> EVALUATION -> ARCHIVED`

Transitions are monotonic. When an existing automation position is already
farther along, the lifecycle service records each intermediate state in order so
the journal never has a gap.

## Timeline

Every lifecycle transition, monitoring decision, confidence change, and
evaluation result is appended to `trade_lifecycle_journal`. Existing automation
audit events remain unchanged and are included in timeline reads for operator
context.

## Journal

The lifecycle journal stores:

- Trade ID and automation position link
- State and previous state
- Recommendation/action
- Risk, entry, execution, confidence, and evaluation payloads
- Human-readable reasoning

The journal model rejects update and delete query mutations.

## API

Read-only endpoints:

- `GET /api/trade-lifecycle/status`
- `GET /api/trade-lifecycle/active`
- `GET /api/trade-lifecycle/pending`
- `GET /api/trade-lifecycle/history`
- `GET /api/trade-lifecycle/timeline?tradeId=<id>`
- `GET /api/trade-lifecycle/evaluations`

## Feature Flags

Safe defaults:

- `TRADE_LIFECYCLE_ENABLED=true`
- `TRADE_LIFECYCLE_AUTOSTART=false`
- `AUTONOMOUS_MONITORING=true`
- `AUTONOMOUS_ENTRY_ENABLED=false`
- `AUTONOMOUS_EXIT_ENABLED=false`

Autonomous order placement is disabled unless explicitly enabled. Even then,
lifecycle requests route through existing order-intent execution services.

## Operator Guide

Open the existing Automation page. The Trade Lifecycle panel shows AI status,
paper trading mode, market state, strategy, regime, next evaluation, current
recommendation, open trades, pending trades, rejected items, timeline events,
and latest evaluations.

Expand an open trade to inspect entry, confidence, risk decision, exit
recommendation, and journal reasoning.

## Example

An active trade can show:

`PENDING_ENTRY -> ENTRY_SUBMITTED -> ENTRY_FILLED -> MONITORING`

Monitoring may recommend `HOLD`, `MOVE_STOP`, `TAKE_PROFIT`, `SCALE_OUT`,
`EXIT`, `WAIT`, or `NO_ACTION`. Exit recommendations require multi-factor
reasoning and never rely only on P/L.

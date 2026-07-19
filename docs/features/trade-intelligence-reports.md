# Trade Intelligence Reports

Milestone: Version 2, Milestone 2

Trade Intelligence Reports create one permanent report for every closed automation trade. Reports consume finalized trading sessions and persisted Version 1 evidence. They do not execute trades, call brokers, fetch market data, change strategy rules, or modify Version 1 schemas.

## Purpose

- Preserve one auditable report per completed trade.
- Make trade-level performance, execution, risk, signal, and evidence replay queryable.
- Provide the source of truth for future daily, weekly, monthly, strategy, missed-opportunity, and AI Coach layers.

## Boundaries

The report generator does not modify:

- Signal or evaluation logic.
- Contract selection.
- Risk decisions.
- Broker adapters.
- Order intents.
- Monitoring or exit behavior.
- Reconciliation.
- GPT prompts.
- Version 1 Mongo schemas.

## Generation Flow

```text
Finalized TradingSession
  ↓
Closed AutomationPosition
  ↓
Join persisted evidence
  ↓
Build deterministic report
  ↓
Store immutable TradeReport
```

Source joins:

- `AutomationPosition` is the trade spine.
- `TradingSession` provides trading date, environment, and source window.
- `TradeCandidate` provides signal and indicator context.
- `ContractSelection` provides selected contract, ranking, liquidity, delta, IV, and rejected alternatives.
- `RiskDecision` provides risk checks and sizing evidence.
- `OrderIntent` provides intended order behavior.
- `BrokerOrder` provides broker-derived order/fill state.
- `AutomationEvent` provides timeline replay and warnings.
- `UniverseEvaluation` provides ranking and selected-opportunity context.

## Mongo Schema

Model:

```text
server/src/features/intelligence/models/tradeReport.model.ts
```

Collection:

```text
intelligence_trade_reports
```

Key sections:

- Identity.
- Lifecycle.
- Execution.
- Market context.
- Greeks.
- Signal intelligence.
- Performance.
- Deterministic grades.
- Lessons.
- Timeline.
- Evidence references.
- Warnings.
- Generation metadata.

## Index Strategy

- Unique `reportId`.
- Unique `tradeId`.
- Query indexes on `sessionId`, `tradingDate`, underlying, and overall grade.

The uniqueness rule enforces one report per closed automation position.

## Immutability

Generated reports are permanent by default. Normal save/update paths block mutation of reports with status `GENERATED`.

Future regeneration should create an explicit report version or amendment workflow. It should not silently overwrite a historical report.

## Deterministic Grading

No GPT is used.

Grades are deterministic and explainable:

- Entry: candidate status, risk approval, selected contract spread/liquidity, universe rank.
- Exit: exit reason, realized P/L, close timestamp.
- Risk: risk decision, failed checks, adverse excursion, overnight recovery.
- Execution: fills, partials, rejects, retries, slippage.
- Market: market status and persisted liquidity.
- Overall: average of available component scores.

Each grade stores:

- Letter grade.
- Numeric score.
- Reasons.
- Missing inputs.

## Timeline Replay

The timeline is built from persisted timestamps:

- Signal evaluation.
- Contract selection.
- Risk decision.
- Universe evaluation.
- Order intents.
- Broker order status history.
- Position open/close.
- Relevant automation events.

Every timeline event records source type and source ID when available.

## Backfill

Backfill is explicit and never runs at startup:

```bash
npm --prefix server run intelligence:backfill-trades -- 2026-07-16
```

Expected July 16, 2026 paper-trading reports if evidence is present:

```text
XLE bullish call: +$2.00, END_OF_DAY
SPY bearish put: -$58.00, OVERNIGHT_RECOVERY
```

These values are not hardcoded into production logic. The backfill derives them from `AutomationPosition.realizedPnl` and `AutomationPosition.exitReason`.

## Known Limitations

- SPY, sector, and VIX context are not persisted by Version 1 and are recorded as unavailable.
- Theta, gamma, and vega are not persisted in the contract-selection snapshot and are recorded as unavailable.
- Report lessons are deterministic evidence summaries, not GPT-generated analysis.
- Grade formulas are intentionally conservative baseline heuristics. Future research should validate them before changing production interpretation.

## Future Daily Reports

Daily reports should consume `intelligence_trade_reports` rather than rejoining raw V1 trade evidence. This keeps daily/weekly/monthly analytics stable and prevents drift between report layers.

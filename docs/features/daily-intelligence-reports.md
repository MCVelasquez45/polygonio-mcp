# Daily Intelligence Reports

Milestone: Version 2, Milestone 3

Daily Intelligence Reports are immutable executive summaries for one trading day. Each report aggregates one `TradingSession` plus its linked `TradeReport` documents. It is the source for future AI Coach, weekly, monthly, strategy, historical, and executive reporting layers.

## Purpose

- Preserve one auditable daily report per trading session.
- Summarize daily trading, performance, capital, execution, market, evidence quality, warnings, and trade references.
- Keep higher-level analytics from reading raw Version 1 records directly.
- Provide deterministic, explainable grades without GPT or subjective interpretation.

## Boundaries

The Daily Report generator does not:

- Execute trades.
- Query brokers.
- Query market-data providers.
- Read live runtime state.
- Modify Version 1 schemas.
- Modify Version 1 APIs.
- Change signal, risk, monitoring, broker, reconciliation, or GPT prompt behavior.

It consumes only:

- `intelligence_trading_sessions`
- `intelligence_trade_reports`

## Aggregation Flow

```text
TradingSession
  +
TradeReports for sessionId
  |
  v
Deterministic aggregation
  |
  v
DailyReport
  |
  v
Future weekly/monthly/strategy/AI Coach layers
```

The report generator uses the Trading Session as the daily spine and Trade Reports as the trade-level source of truth. It does not rejoin `AutomationPosition`, broker orders, risk decisions, candidate evaluations, or provider data.

## Mongo Schema

Model:

```text
server/src/features/intelligence/models/dailyReport.model.ts
```

Collection:

```text
intelligence_daily_reports
```

Key sections:

- Identity.
- Executive summary.
- Trading summary.
- Performance.
- Capital.
- Execution.
- Market.
- Deterministic grades.
- Evidence quality.
- Trade report references.
- Timeline.
- Warnings.
- Generation metadata.

## Index Strategy

Unique keys:

```text
reportId
sessionId
```

Query indexes:

```text
tradingDate + environment
grades.overall.grade + tradingDate
```

The uniqueness rule enforces one Daily Report per Trading Session.

## Immutability

Generated reports are immutable by default:

- Existing `GENERATED` reports cannot be changed through normal save paths.
- Query updates exclude `GENERATED` reports.
- Repeated generation returns the existing report idempotently.

Future regeneration should create an explicit version or amendment workflow rather than silently overwriting a generated report.

## Deterministic Grading

No GPT is used.

Component grades:

- Execution: order count, fill rate, partials, cancellations, rejects, retries.
- Risk: risk approval evidence and overnight recovery evidence from Trade Reports.
- Market: session market status and trade-level market grades.
- Trade Quality: average of Trade Report overall grades.
- Performance: net P/L, win rate, and profit factor.
- Evidence: completeness score from expected session and trade evidence.
- Overall: average of available component grade scores.

Every grade includes:

- Letter grade.
- Numeric score when available.
- Reasons.
- Missing inputs.

## Executive Summary

The executive summary is factual and deterministic. It includes:

- Overall grade.
- Market summary.
- Session summary.
- Primary lesson.
- Best decision.
- Worst decision.
- Highlights.
- Key findings.

Example for the first paper-trading milestone:

```text
2 trade report(s), 1 win(s), 1 loss(es), net -$56.00.
Primary lesson: Overnight exposure reduced performance.
Best decision: XLE produced the strongest realized outcome.
Worst decision: SPY produced the weakest realized outcome.
```

These sentences are generated from report evidence, not hardcoded into production logic.

## Timeline

The daily timeline currently includes:

- Trading session started.
- Each trade opened.
- Each trade closed.
- Trading session finalized.

Each event stores:

- Timestamp.
- Label.
- Source type.
- Source ID.
- Severity.

## Backfill

Backfill is explicit and never runs at startup:

```bash
npm --prefix server run intelligence:backfill-daily -- 2026-07-16
```

The command:

- Builds the server.
- Connects to Mongo.
- Syncs Daily Report indexes.
- Generates or returns the Daily Report for each Trading Session on the date.
- Never calls the broker.
- Never changes execution state.

Expected July 16, 2026 output when Session and Trade Reports exist:

```text
Trades closed: 2
Wins: 1
Losses: 1
Net P/L: -$56.00
Largest winner: XLE
Largest loser: SPY
```

## Known Limitations

- SPY trend, VIX, and sector leadership are not persisted in the current upstream intelligence records.
- Timeout count is not exposed as a daily-level captured field.
- Portfolio snapshot data is unavailable when the Trading Session did not capture it.
- Grade formulas are baseline deterministic heuristics and should be validated with larger cohorts before being used for production rule changes.
- Daily Reports do not yet include rejected-opportunity analytics; that belongs to later missed-opportunity and strategy analytics milestones.

## Future AI Coach Integration

The AI Coach should consume Daily Reports rather than raw trades. It must remain advisory and must not automatically change thresholds, enable strategies, disable filters, change sizing, or submit orders.

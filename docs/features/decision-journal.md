# Decision Journal

Milestone: Version 2, Milestone 4

The Decision Journal records one immutable entry per persisted automation decision. It answers what the system knew, what it decided, and why, using deterministic evidence instead of AI explanations.

## Purpose

- Preserve decision evidence before higher-level analysis.
- Make accepted and rejected opportunities queryable.
- Support future confidence calibration, strategy analytics, missed-opportunity analysis, AI Coach, and model-training datasets.
- Keep the intelligence layer observational and separate from Version 1 execution behavior.

## Boundaries

The Decision Journal does not:

- Execute trades.
- Submit, cancel, or modify orders.
- Query brokers.
- Query market-data providers.
- Change signal, evaluation, risk, monitoring, reconciliation, or GPT prompt behavior.
- Modify Version 1 schemas or APIs.

## Capture Lifecycle

```text
Persisted V1 decision evidence
  |
  v
Decision Journal service
  |
  v
Immutable journal entries
  |
  v
Future comparison against Trade Reports and Daily Reports
```

The service currently supports explicit backfill from persisted evidence. It also exposes a capture method that can be called by future pre-execution integration points without changing trading decisions.

## Mongo Schema

Model:

```text
server/src/features/intelligence/models/decisionJournal.model.ts
```

Collection:

```text
intelligence_decision_journal
```

Key sections:

- Identity.
- Decision context.
- Evaluation.
- Decision inputs.
- Decision outcome.
- Risk snapshot.
- Execution references.
- Evidence quality.
- Timeline.
- Generation metadata.

## Index Strategy

Unique key:

```text
decisionId
```

Query indexes:

```text
sessionId + timestamp
automationSessionId + timestamp
tradeId + timestamp
context.symbol + timestamp
decisionType
```

The deterministic `decisionId` prevents duplicate journal entries during reruns.

## Immutability

Journal entries are immutable by default:

- Existing entries cannot be changed through normal save paths.
- Query updates are filtered out.
- Backfill returns existing entries idempotently.

Future correction workflows should create explicit amendments or versions rather than rewriting a captured decision.

## Reason Codes

Reason codes are copied from persisted automation evidence. Examples:

- `NO_SIGNAL`
- `LOW_LIQUIDITY`
- `HIGH_SPREAD`
- `NO_CONTRACT_PASSED_FILTERS`
- `RISK_MAX_TRADES`
- `RISK_INSUFFICIENT_BUYING_POWER`
- `MARKET_CLOSED`
- `EMERGENCY_STOP`
- `END_OF_DAY`
- `OVERNIGHT_RECOVERY`

The UI renders both raw reason codes and deterministic human-readable translations.

## Timeline

Each journal entry includes a compact timeline event that references the source record:

- `UniverseEvaluation`
- `TradeCandidate`
- `ContractSelection`
- `RiskDecision`
- `OrderIntent`
- `AutomationPosition`
- `AutomationEvent`

Trade Reports and Daily Reports can later compare decisions with outcomes.

## Backfill

Backfill is explicit and never runs at startup:

```bash
npm --prefix server run intelligence:backfill-decisions -- 2026-07-16
```

The command:

- Builds the server.
- Connects to Mongo.
- Syncs Decision Journal indexes.
- Generates or returns deterministic journal entries for Trading Sessions on the date.
- Never calls the broker.
- Never changes execution state.

## Future AI Coach Integration

The AI Coach should compare:

```text
Decision Journal -> Trade Reports -> Daily Reports -> Lesson
```

It must remain advisory and must never automatically change thresholds, strategy rules, risk controls, sizing, or order behavior.

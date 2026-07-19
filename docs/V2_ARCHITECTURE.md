# AI-Trader V2 Architecture

Version 2: Institutional Trading Intelligence Platform

V2 observes and preserves evidence from the validated V1 autonomous paper-trading engine. V2 does not execute trades, modify trading rules, alter broker behavior, or change Version 1 schemas.

```text
V1 Automation                 V2 Intelligence
-------------                 ---------------
Market data             ┐
Evaluation              │
Signal                  │
Risk                    ├── persisted evidence ──► Trading Session Capture
Order intent            │                             │
Broker submission       │                             └── Trade Intelligence Reports
Monitoring              │                                           │
Exit/reconciliation     ┘                                           └── Daily Intelligence Reports
Evaluation records      ─────────────────────────────► Decision Journal
```

## Milestone 1 Scope

Implemented:

- Trading session Mongo model.
- Idempotent session creation.
- Deterministic summaries from persisted V1 records.
- Finalization gate.
- Immutable finalized sessions.
- Read APIs.
- Token-gated capture/finalization/backfill APIs.
- Minimal Trading Intelligence Sessions UI.
- Explicit July 16, 2026 backfill command.

## Milestone 2 Scope

Implemented:

- Trade Intelligence Reports.
- One immutable report per closed automation trade.
- Deterministic report generator from persisted evidence.
- Deterministic grade engine, no GPT.
- Chronological trade timeline replay.
- Read APIs and admin-gated generation/backfill APIs.
- Minimal Trading Intelligence Trade Reports UI.
- Explicit July 16, 2026 trade-report backfill command.

## Milestone 3 Scope

Implemented:

- Daily Intelligence Reports.
- One immutable report per Trading Session.
- Deterministic aggregation from Trading Session and Trade Reports.
- Deterministic daily grading, no GPT.
- Factual executive summary generation.
- Read APIs and admin-gated generation/backfill APIs.
- Minimal Trading Intelligence Daily Reports UI.
- Explicit July 16, 2026 daily-report backfill command.

## Milestone 4 Scope

Implemented:

- Decision Journal.
- One immutable journal entry per persisted automation decision source.
- Deterministic entries from universe evaluations, candidates, selections, risk decisions, order intents, position exits, and relevant automation events.
- Read APIs and admin-gated backfill API.
- Minimal Trading Intelligence Decision Journal UI.
- Explicit July 16, 2026 decision-journal backfill command.

Not implemented:

- Missed Opportunity Analytics.
- AI Coach.
- Historical Intelligence Workspace.

## Milestone 5 Scope

Implemented:

- Strategy Analytics.
- Deterministic cohort analysis across trade reports, daily reports, sessions, and decision journals.
- Daily, weekly, monthly, and rolling aggregation windows.
- Read APIs and admin-gated generation/backfill APIs.
- Minimal Trading Intelligence Strategy Analytics UI.
- Explicit July 16, 2026 strategy-analytics backfill command.

Not implemented:

- Missed Opportunity Analytics.
- AI Coach.
- Historical Intelligence Workspace.

## Boundaries

The intelligence layer does not modify:

- Evaluation logic.
- Signal logic.
- Contract-selection logic.
- Risk logic.
- Position sizing.
- Broker adapters.
- Order-intent behavior.
- Monitoring or exit logic.
- Reconciliation behavior.
- GPT prompts.
- Existing Mongo schemas.

## Event Flow

1. V1 automation persists evaluations, candidates, selections, risk decisions, intents, broker orders, positions, and events.
2. V2 capture locates the intended trading date and automation session.
3. V2 capture reads persisted records and builds stable summaries.
4. V2 stores references to source records instead of embedding raw datasets.
5. V2 finalization checks market status, scheduler state, reconciliation state, active positions, and unresolved intents.
6. Once finalized, normal service calls cannot silently mutate the session.
7. V2 trade reporting reads finalized session references and closed automation positions.
8. V2 trade reporting joins persisted candidate, selection, risk, intent, broker-order, event, and universe-ranking evidence.
9. V2 trade reporting stores one immutable report per closed trade.
10. V2 daily reporting reads the Trading Session and linked Trade Reports.
11. V2 daily reporting stores one immutable executive report per Trading Session.
12. V2 decision journaling reads persisted pre-execution and lifecycle decision evidence.
13. V2 decision journaling stores immutable entries keyed by source record.
14. V2 strategy analytics aggregates trade, daily, and decision evidence into deterministic cohorts.
15. V2 strategy analytics stores immutable cohort snapshots per aggregation window.

## Collection

Collection: `intelligence_trading_sessions`

Primary unique key:

```text
sessionId
```

Duplicate prevention:

```text
tradingDate + environment + automationSessionId
```

This allows one session record per trading date, environment, and automation lifecycle.

Collection: `intelligence_trade_reports`

Primary unique keys:

```text
reportId
tradeId
```

Duplicate prevention:

```text
one generated report per AutomationPosition._id
```

Reports link to sessions with `sessionId` rather than mutating finalized session records.

Collection: `intelligence_daily_reports`

Primary unique keys:

```text
reportId
sessionId
```

Duplicate prevention:

```text
one generated Daily Report per TradingSession.sessionId
```

Daily Reports link to Trade Reports through `tradeReportIds` and compact report references.

Collection: `intelligence_decision_journal`

Primary unique key:

```text
decisionId
```

Duplicate prevention:

```text
one generated journal entry per source decision record
```

Decision Journal entries link to sessions, trades, reports, order intents, broker orders, and source records when those references are persisted.

## Lifecycle

- `INITIALIZING`: session exists but complete market/evaluation evidence has not been captured.
- `OPEN`: market evidence shows the session is still open.
- `CLOSING`: market evidence shows closed; session is not finalized yet.
- `FINALIZING`: finalization attempt is in progress.
- `FINALIZED`: immutable baseline record.
- `FINALIZATION_FAILED`: finalization was attempted and deferred/failed with reasons captured.

## Finalization Gate

Finalization requires:

- Market status is `CLOSED`.
- Scheduler has no in-flight evaluation tick.
- Reconciliation is clean.
- No unresolved active automation position remains, except positions classified as overnight recovery are captured as warnings.
- No unresolved order intents remain.
- Manual-review state is not active.
- Emergency-stop state is captured.

Historical backfill can finalize with warnings only when persisted closed-position evidence exists.

## Backfill

Backfill is explicit and never runs at startup:

```bash
npm --prefix server run intelligence:backfill-session -- 2026-07-16
npm --prefix server run intelligence:backfill-trades -- 2026-07-16
npm --prefix server run intelligence:backfill-daily -- 2026-07-16
npm --prefix server run intelligence:backfill-decisions -- 2026-07-16
npm --prefix server run intelligence:backfill-analytics -- 2026-07-16
```

The commands read persisted V1 evidence and write V2 intelligence records. They never call the broker and never change execution state.

## Trade Report Grading

Trade Report grades are deterministic:

- Entry grade: candidate, risk approval, contract spread/liquidity, universe rank.
- Exit grade: exit reason, realized P/L, close timestamp.
- Risk grade: risk approval, failed checks, adverse excursion, overnight recovery.
- Execution grade: fills, partials, rejects, retries, slippage.
- Market grade: market status and persisted liquidity.
- Overall grade: average of available component scores.

No GPT is used for grading or lessons in Milestone 2.

## Daily Report Aggregation

Daily Reports consume only `intelligence_trading_sessions` and `intelligence_trade_reports`.

They aggregate:

- Trading summary.
- Performance and expectancy.
- Capital evidence when captured.
- Execution evidence.
- Market status and available market regime evidence.
- Evidence quality.
- Trade references.
- Daily timeline.
- Deterministic grades.
- Factual executive summary.

Daily Reports do not rejoin raw V1 trade records and do not query providers or brokers.

## Daily Report Grading

Daily Report grades are deterministic:

- Execution: order count, fill rate, partials, cancellations, rejects, and retries.
- Risk: risk approval and overnight recovery evidence from Trade Reports.
- Market: session market status and trade-level market grades.
- Trade quality: average Trade Report overall grade.
- Performance: net P/L, win rate, and profit factor.
- Evidence: completeness score from expected session and trade fields.
- Overall: average of available component scores.

No GPT is used for daily grading or executive summary generation in Milestone 3.

## Decision Journal Capture

Decision Journal entries consume persisted decision sources:

- Universe evaluations.
- Trade candidates.
- Contract selections.
- Risk decisions.
- Order intents.
- Automation positions.
- Relevant automation events.

The journal does not change the evaluation or execution pipeline. Historical backfill reconstructs entries from persisted evidence and records missing fields instead of guessing.

## Failure Recovery

- Duplicate session creation returns the existing session.
- Duplicate finalization of a finalized session is idempotent.
- Failed finalization records gate reasons in warnings.
- Retry uses the same session record.
- Future amendment/version workflows should create explicit report versions rather than overwriting finalized evidence.

## Future Handoff

Milestone 5, Missed Opportunity Analytics, should compare Decision Journal entries against Trade Reports and market evidence cohorts without changing execution behavior.

Weekly, monthly, strategy, historical, and AI Coach layers should consume `intelligence_daily_reports` rather than raw trades. The AI Coach remains advisory and must not automatically change production rules.

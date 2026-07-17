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
Broker submission       │                             └── future reports/analytics
Monitoring              │
Exit/reconciliation     ┘
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

Not implemented:

- Trade Intelligence Reports.
- Daily Trading Report.
- Decision Journal UI.
- Missed Opportunity Analytics.
- Strategy Analytics.
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
```

The command reads persisted V1 evidence and writes the V2 session record. It never calls the broker and never changes execution state.

## Failure Recovery

- Duplicate session creation returns the existing session.
- Duplicate finalization of a finalized session is idempotent.
- Failed finalization records gate reasons in warnings.
- Retry uses the same session record.
- Future amendment/version workflows should create explicit report versions rather than overwriting finalized evidence.

## Future Handoff

Milestone 2, Trade Intelligence Reports, should consume finalized trading sessions and their source references. It should not query broker/provider APIs to reconstruct history unless a new audited evidence-capture field is added first.

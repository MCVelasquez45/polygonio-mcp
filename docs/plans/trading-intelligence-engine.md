# Trading Intelligence Engine Plan

Base milestone: `v1.0.1-production-hardened`

This branch is reserved for the Trading Intelligence and Daily Reporting Layer. No production trading rules, thresholds, broker execution logic, GPT prompt formats, or risk controls should be changed as part of this planning document.

## Guardrails

- Treat every evaluation, rejection, submitted order, canceled order, filled order, open position, and closed position as a research data point.
- Do not optimize from one trade, one trading day, or anecdotal evidence.
- Prefer instrumentation and experiments before changing production behavior.
- Use feature flags for behavior changes.
- Keep the AI Coach advisory only. It must never automatically change production rules or thresholds.

## Milestone 1: Trading Session Capture

Capture a normalized trading-session record for each automation run.

Implementation status: Milestone 1 is implemented in the `intelligence_trading_sessions` collection with read APIs and a minimal Sessions UI. See `docs/features/trading-session-capture.md`.

Initial scope:

- Session open, close, and market regime metadata.
- Universe evaluated and symbols scanned.
- Signal decisions, no-signal decisions, and risk rejections.
- Selected contracts, rejected contracts, and no-contract-selected outcomes.
- Order lifecycle events and broker reconciliation status.
- Position lifecycle events and exit reasons.

Success metric:

- A full trading day can be reconstructed from persisted records without reading logs.

## Milestone 2: Trade Intelligence Reports

Generate per-trade reports that explain why a trade happened and how it behaved.

Implementation status: Milestone 2 is implemented in the `intelligence_trade_reports` collection with read APIs, admin-gated generation/backfill, deterministic grading, timeline replay, and a minimal Trade Reports UI. See `docs/features/trade-intelligence-reports.md`.

Initial scope:

- Entry thesis and contract-selection attribution.
- Risk decision and sizing rationale.
- Execution quality, fill quality, and missed-fill context.
- Hold rationale timeline.
- Exit trigger and realized outcome.

Success metric:

- Every closed trade has a human-readable report backed by stored facts.

## Milestone 3: Daily Trading Report

Create an end-of-day report across all evaluations and trades.

Implementation status: Milestone 3 is implemented in the `intelligence_daily_reports` collection with read APIs, admin-gated generation/backfill, deterministic grading, factual executive summaries, and a minimal Daily Reports UI. See `docs/features/daily-intelligence-reports.md`.

Initial scope:

- Executed trades and rejected opportunities.
- Win/loss and expectancy summary.
- Slippage, fill rate, cancellation reasons, and timeout outcomes.
- Strategy/filter contribution by symbol and regime.
- Risk exposure and drawdown context.

Success metric:

- The report identifies what happened, what was missed, and what data is still missing.

## Milestone 4: Decision Journal

Build a durable journal for automation decisions and operator interventions.

Implementation status: Milestone 4 is implemented in the `intelligence_decision_journal` collection with read APIs, admin-gated backfill, deterministic reason-code capture, source timelines, and a minimal Decision Journal UI. See `docs/features/decision-journal.md`.

Initial scope:

- Evaluation snapshots.
- Risk decisions.
- Broker actions.
- Operator actions and confirmations.
- Reconciliation corrections.
- Data-provider availability and delay state.

Success metric:

- A reviewer can trace any trade or rejection from market context to final outcome.

## Milestone 5: Strategy Analytics

Analyze strategy, symbol, regime, timing, confidence, DTE, delta, IV, weekday, exit-reason, and risk-profile cohorts across the historical evidence.

Implementation status: Milestone 5 is implemented in the `intelligence_strategy_analytics` collection with read APIs, admin-gated generation/backfill, deterministic cohort ranking, and a minimal Strategy Analytics UI. See `docs/features/strategy-analytics.md`.

Initial scope:

- Deterministic aggregation from Trade Reports, Daily Reports, and Decision Journals.
- Cohort ranking by strategy, symbol, sector, market regime, confidence, DTE, delta, IV, weekday, time of day, exit reason, and risk profile.
- Evidence-quality score and missing-data warnings.
- Daily, weekly, monthly, and rolling windows.

Success metric:

- A reviewer can compare cohort performance without re-reading raw trade logs.

## Milestone 6: Missed Opportunity Analytics

Analyze false negatives, rejected opportunities, missed fills, and opportunity cost.

Initial scope:

- Rejected contracts and their subsequent price behavior.
- No-signal outcomes and subsequent underlying moves.
- Fill failures and subsequent mid/mark behavior.
- Exit quality versus available alternatives.

Success metric:

- Missed-opportunity findings are backed by cohort-level evidence, not individual anecdotes.

## Milestone 7: AI Coach

Generate advisory recommendations for human review.

Initial scope:

- Hypothesis.
- Evidence.
- Missing evidence.
- Data required.
- Suggested instrumentation.
- Expected upside.
- Risks introduced.
- Success metric.
- Rollback criteria.

Success metric:

- Recommendations are actionable, measurable, and explicitly marked as advisory.

The AI Coach must not directly alter thresholds, enable strategies, disable filters, change sizing, or submit orders.

## Milestone 8: Historical Intelligence Workspace

Build a review workspace for historical sessions, trades, rejected opportunities, and strategy cohorts.

Initial scope:

- Session browser.
- Trade and rejection timelines.
- Cohort filters by symbol, strategy, regime, and decision outcome.
- Drill-down from daily report to decision journal records.
- Exportable research views for human review.

Success metric:

- A reviewer can compare executed trades and rejected opportunities across multiple sessions without reading raw logs or Mongo records.

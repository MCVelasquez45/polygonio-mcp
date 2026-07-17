# Trading Intelligence Engine Plan

Base milestone: `v1.0-autonomous-trading`

This branch is reserved for the Trading Intelligence and Daily Reporting Layer. No production trading rules, thresholds, broker execution logic, GPT prompt formats, or risk controls should be changed as part of this planning document.

## Guardrails

- Treat every evaluation, rejection, submitted order, canceled order, filled order, open position, and closed position as a research data point.
- Do not optimize from one trade, one trading day, or anecdotal evidence.
- Prefer instrumentation and experiments before changing production behavior.
- Use feature flags for behavior changes.
- Keep the AI Coach advisory only. It must never automatically change production rules or thresholds.

## Milestone 1: Trading Session Capture

Capture a normalized trading-session record for each automation run.

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

Initial scope:

- Entry thesis and contract-selection attribution.
- Risk decision and sizing rationale.
- Execution quality, fill quality, and missed-fill context.
- Hold rationale timeline.
- Exit trigger and realized outcome.

Success metric:

- Every closed trade has a human-readable report backed by stored facts.

## Milestone 3: Daily End-of-Day Report

Create an end-of-day report across all evaluations and trades.

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

Initial scope:

- Evaluation snapshots.
- Risk decisions.
- Broker actions.
- Operator actions and confirmations.
- Reconciliation corrections.
- Data-provider availability and delay state.

Success metric:

- A reviewer can trace any trade or rejection from market context to final outcome.

## Milestone 5: Strategy and Missed-Opportunity Analytics

Analyze filter value, false positives, false negatives, and opportunity cost.

Initial scope:

- Rejected contracts and their subsequent price behavior.
- No-signal outcomes and subsequent underlying moves.
- Fill failures and subsequent mid/mark behavior.
- Exit quality versus available alternatives.
- Regime dependence by trend, flow, relative volume, and market timing.

Success metric:

- Recommendations are backed by cohort-level evidence, not individual anecdotes.

## Milestone 6: AI Coach Recommendations

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

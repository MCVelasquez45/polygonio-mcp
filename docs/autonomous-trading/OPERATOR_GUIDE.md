# Autonomous Trading Operator Guide

## What It Does

The autonomous trading system watches configured symbols, reads market events, ranks opportunities, compares strategies, asks the Risk Engine for approval, creates lifecycle records, and either simulates execution in Shadow Mode or delegates approved paper orders to the existing Execution Gateway.

## What It Does Not Do

- It does not submit live-money orders.
- It does not let AI components call Alpaca directly.
- It does not bypass Risk Engine approval.
- It does not claim manual trades.

## Modes

Manual: the operator controls order submission.

Shadow: the full AI pipeline runs, but no broker order is submitted.

Autonomous Paper: approved entries and exits may submit Alpaca Paper orders when all gates pass.

## How an Event Becomes a Recommendation

1. Event Intelligence detects and explains a market event.
2. Decision Intelligence ranks opportunities.
3. Strategy Orchestrator compares strategy candidates.
4. Risk Engine approves or rejects the recommendation.
5. Trade Lifecycle Manager creates or monitors lifecycle records.
6. Execution Gateway submits paper orders only when enabled and approved.
7. Trade Evaluation measures completed outcomes.

## Risk Approval

Risk approval confirms that the trade fits portfolio limits, liquidity limits, Greeks limits, buying power, confidence thresholds, and open-position rules. A rejection is not an error; it is the Risk Engine doing its job.

## Entries

Shadow entries create simulated execution records. Autonomous Paper entries require all strict entry gates to pass.

## Monitoring and Exits

Open automation-owned positions are monitored by the existing Trade Lifecycle Manager. Lifecycle actions include `HOLD`, `TAKE_PROFIT`, `MOVE_STOP`, `EXIT`, and `WAIT`.

## Pausing and Emergency Stop

Use existing Automation controls for pause/resume and Emergency Stop. Emergency Stop blocks new autonomous execution and is displayed at the top of the Automation workspace.

## Rejection Reason Codes

Common codes:

- `MAX_SECTOR_EXPOSURE`: portfolio exposure is above the configured limit.
- `HIGH_SPREAD`: bid/ask spread is too wide.
- `MARKET_NOT_OPEN`: entry gate blocked because the market is closed.
- `BROKER_TRUTH_STALE`: broker state is not current.
- `DUPLICATE_ORDER_INTENT`: duplicate execution was prevented.

## Inspecting a Timeline

Open the Automation workspace, review System Activity Timeline, then expand Intelligence Details for linked Event, Decision, Strategy, Risk, Lifecycle, Execution, and Evaluation IDs.

## Daily Checklist

### Before Market Open

- Confirm Alpaca Paper mode.
- Confirm Massive data health.
- Confirm automation owner and leases.
- Confirm broker truth is current.
- Confirm risk limits.
- Confirm Emergency Stop is inactive.
- Confirm operating mode.
- Review overnight events.

### During Market Hours

- Review current AI activity.
- Review pending risk approvals.
- Review active lifecycle actions.
- Check stale-data warnings.
- Review recent rejection reasons.
- Confirm no execution contradictions.

### After Market Close

- Review completed trades.
- Review open overnight positions.
- Review strategy and risk performance.
- Review failed or blocked pipelines.
- Review daily report.
- Confirm lifecycle and evaluation journals are complete.

## Common Failure States

- Market closed
- Broker unavailable
- Broker truth stale
- MongoDB disconnected
- Lease not owned
- Emergency Stop active
- Risk approval expired
- Duplicate order intent
- Execution timeout
- Evaluation failure

## Troubleshooting

1. Check Autonomous Trader Status.
2. Read Current AI Activity.
3. Review Pending Trades blocking reason.
4. Open System Activity Timeline.
5. Expand Risk Review and Execution Details.
6. Confirm feature flags.
7. Retry only after the blocking condition is corrected.

## Example UI State

```text
Autonomous Trader: Running
Mode: Shadow
Market: Closed
Broker: Alpaca Paper
Emergency Stop: Inactive
SHADOW MODE - No broker orders will be submitted.
```

## Example API Response

```json
{
  "status": {
    "status": "Running",
    "mode": "Shadow",
    "market": "Closed",
    "currentActivity": "The system is monitoring OXY, CVX, XLE, SPY, and QQQ."
  }
}
```


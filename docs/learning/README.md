# Enterprise Learning Intelligence

Learning Intelligence is the evidence layer that turns completed paper-trade history into reusable insights.

It never executes trades, never calls Alpaca, never bypasses Risk or Lifecycle, and never mutates trade reports. It reads completed Trade Evaluation reports and creates append-only learning artifacts.

## Architecture

Source flow:

```text
Completed Trade Evaluation
        ↓
Learning Artifact Synchronizer
        ↓
Append-only Trade Reviews
        ↓
Versioned Learning Datasets
        ↓
Calibration, Scorecards, Regime Analytics, Event Analytics
        ↓
Operator Cockpit + read-only APIs
```

Code lives under:

```text
server/src/features/learning/
```

The module contains controllers, analytics, scorecards, calibration, datasets, journal, routes, storage, types, tests, docs, and a safe scheduler.

## Trade Review

Each completed trade report can produce one append-only learning review.

Captured fields include:

- Entry and exit timestamps
- Entry strategy and winning strategy
- Market regime, Fed event, news event, sector, symbol, direction
- Confidence, evidence score, risk score
- Entry reason and exit reason
- Maximum favorable/adverse excursion
- Holding time
- Expected and actual return
- Win/loss/partial-win classification
- Why the trade succeeded
- Why the trade failed
- What could improve
- Evidence references back to trade report, position, risk decision, candidate, contract selection, universe evaluation, and event IDs

Collection:

```text
learning_trade_reviews
```

Review records are append-only. Update operations are blocked by the model.

## Calibration

Confidence calibration compares predicted confidence with realized success rate.

Example:

```json
{
  "confidenceBand": "90-100%",
  "predictedConfidence": 0.95,
  "actualSuccessRate": 0.61,
  "calibrationError": 0.34,
  "verdict": "Overconfident"
}
```

Verdicts:

- Overconfident
- Underconfident
- Well calibrated
- Insufficient data

## Scorecards

Strategy scorecards are generated for:

- Last 30 days
- Last 90 days
- Lifetime

Metrics include:

- Total trades
- Wins and losses
- Win rate
- Average return
- Median return
- Average hold time
- Average risk
- Largest winner
- Largest loser
- Sharpe, when enough returns exist
- Max drawdown

## Market Regime Analytics

Regime analytics group learning reviews by market regime and derived tags such as:

- Trending
- Range
- High volatility
- Low volatility
- Risk on
- Risk off
- News driven
- Fed
- Energy rotation
- Sector rotation

Each group reports trades, win rate, and average return.

## Event Analytics

Event analytics classify reviews into event families:

- Fed
- CPI
- PPI
- Jobs
- Oil
- Earnings
- Breaking News
- Sentiment
- Options Flow

The response also lists the most common strategies used for each event group.

## Dataset Design

Each completed trade can produce one versioned dataset row.

Collection:

```text
learning_datasets
```

Dataset records include:

- Market snapshot
- Technical indicators
- Massive-derived data references
- News and sentiment context
- Event Intelligence references
- Decision Intelligence reference
- Strategy ranking context
- Risk package summary
- Lifecycle evidence
- Execution result
- Trade Evaluation outcome

Historical datasets are never mutated. New schema versions should create new dataset IDs.

## JSON Schemas

Trade review identity:

```json
{
  "reviewId": "learning-review:report:trade-1:v1",
  "schemaVersion": 1,
  "sourceReportId": "report:trade-1",
  "sourceTradeId": "trade-1"
}
```

Dataset identity:

```json
{
  "datasetId": "learning-dataset:report:trade-1:v1",
  "schemaVersion": 1,
  "version": "learning-dataset-v1",
  "sourceReportId": "report:trade-1",
  "sourceTradeId": "trade-1"
}
```

## API

All endpoints are read-only.

### GET `/api/learning/status`

Purpose: Show whether learning artifacts are current with completed trade reports.

```bash
curl -s https://example.com/api/learning/status
```

Example:

```json
{
  "status": "CURRENT",
  "completedTrades": 12,
  "tradeReviews": 12,
  "datasets": 12,
  "pendingReviews": 0,
  "pendingDatasets": 0
}
```

### GET `/api/learning/trades`

Purpose: List append-only trade reviews.

```bash
curl -s "https://example.com/api/learning/trades?limit=20"
```

### GET `/api/learning/scorecards`

Purpose: Strategy performance by window.

```bash
curl -s https://example.com/api/learning/scorecards
```

### GET `/api/learning/calibration`

Purpose: Confidence calibration buckets.

```bash
curl -s https://example.com/api/learning/calibration
```

### GET `/api/learning/regimes`

Purpose: Performance by market regime.

```bash
curl -s https://example.com/api/learning/regimes
```

### GET `/api/learning/events`

Purpose: Event-family performance and strategy usage.

```bash
curl -s https://example.com/api/learning/events
```

### GET `/api/learning/datasets`

Purpose: Versioned reusable learning dataset rows.

```bash
curl -s "https://example.com/api/learning/datasets?limit=20"
```

## Examples

Question: Which strategy performs best after Fed announcements?

Use:

```bash
curl -s https://example.com/api/learning/events | jq '.events[] | select(.event=="Fed")'
```

Question: What confidence values are reliable?

Use:

```bash
curl -s https://example.com/api/learning/calibration
```

Question: Why did this trade fail?

Use:

```bash
curl -s "https://example.com/api/learning/trades?limit=100" | jq '.reviews[] | select(.sourceTradeId=="trade-id")'
```

## Scheduler

The server starts a learning synchronizer after startup. It scans completed generated trade reports and inserts missing learning reviews/datasets.

Environment:

- `LEARNING_SYNC_ENABLED=false` disables the synchronizer.
- `LEARNING_SYNC_INTERVAL_MS` sets the interval, minimum 60 seconds.

The synchronizer does not execute trades and does not call broker or market-data providers.

## Privacy and Safety

Learning artifacts store evidence references and summarized performance. They must not store credentials, API keys, JWTs, tokens, sensitive headers, or raw provider payloads.

Learning Intelligence is an advisory layer. Future strategy changes must still pass through Decision Intelligence, Strategy Orchestrator, Risk, Lifecycle, Execution Gateway, and Paper Trading controls.

# Enterprise Risk Intelligence Engine

V2-BL-007 adds the read-side risk approval authority for AI-Trader Enterprise.
It answers "can we safely take this trade?" after upstream systems have already
answered "should we consider this trade?"

The engine never executes trades, never submits broker orders, and never bypasses
Manual Trading or the Execution Gateway. It returns immutable approval packages
with either `APPROVE` or `REJECT`.

## Architecture

```text
Massive
  |
Event Intelligence
  |
Decision Intelligence
  |
Strategy Orchestrator
  |
Enterprise Risk Intelligence Engine
  |
Execution Gateway
  |
Alpaca Paper
```

The Risk Engine is additive under `server/src/features/riskEngine/`:

- `controllers/`: builds risk inputs from Strategy Orchestrator recommendations
- `portfolio/`: reads persisted portfolio and session state
- `approval/`: deterministic approval pipeline
- `limits/`: configurable enterprise rules and reason text
- `greeks/`: portfolio Greeks aggregation
- `correlation/`: correlated-position detection
- `positionSizing/`: contracts, dollar risk, and allocation math
- `journal/` and `storage/`: append-only approval history
- `routes/`: read-only HTTP API
- `scheduler/`: optional gated background review
- `types/`: approval package and portfolio schemas

## Approval Flow

```text
Recommendation Package
  |
Validate Portfolio
  |
Validate Buying Power
  |
Validate Exposure
  |
Validate Greeks
  |
Validate Liquidity
  |
Validate Correlation
  |
Validate Daily Loss
  |
Validate Risk Budget
  |
APPROVE or REJECT
```

Every failed check becomes a reason code with supporting metrics and a suggested
improvement. The approval output is safe for the Execution Gateway to consume,
but this PR does not modify that gateway.

## Portfolio Model

The portfolio snapshot stores:

- Current positions
- Buying power when available from persisted state
- Sector, ticker, strategy, and macro exposure
- Long versus short exposure
- Open trade count and maximum concurrent trades
- Daily realized and unrealized loss
- Risk consumed and remaining risk budget
- Portfolio Greeks: delta, gamma, theta, vega, rho

The engine reads persisted automation positions and sessions. It does not query
broker order submission paths.

## Risk Rules

Rules are configurable through environment variables with conservative defaults:

| Rule | Environment variable | Default |
| --- | --- | --- |
| Maximum contracts | `RISK_MAX_CONTRACTS` | `10` |
| Maximum dollar risk | `RISK_MAX_DOLLAR_RISK` | `750` |
| Maximum daily loss | `RISK_MAX_DAILY_LOSS` | `1500` |
| Maximum position size | `RISK_MAX_POSITION_SIZE_PCT` | `0.05` |
| Maximum sector exposure | `RISK_MAX_SECTOR_EXPOSURE_PCT` | `0.35` |
| Maximum correlation | `RISK_MAX_CORRELATION` | `0.75` |
| Maximum gamma | `RISK_MAX_GAMMA` | `0.35` |
| Maximum theta | `RISK_MAX_THETA_ABS` | `300` |
| Maximum delta | `RISK_MAX_DELTA_ABS` | `300` |
| Maximum vega | `RISK_MAX_VEGA_ABS` | `500` |
| Maximum open trades | `RISK_MAX_OPEN_TRADES` | `8` |
| Minimum confidence | `RISK_MIN_CONFIDENCE` | `0.6` |
| Maximum spread | `RISK_MAX_SPREAD_PCT` | `0.18` |
| Minimum volume | `RISK_MIN_VOLUME` | `100` |
| Minimum open interest | `RISK_MIN_OPEN_INTEREST` | `250` |
| Maximum IV | `RISK_MAX_IV` | `1.2` |

Feature flags:

```text
RISK_ENGINE_ENABLED=true
RISK_ENGINE_APPROVAL_REQUIRED=true
RISK_ENGINE_AUTO_START=false
PORTFOLIO_RISK_TRACKING=true
CORRELATION_ENGINE=true
GREEKS_AGGREGATION=true
```

`RISK_ENGINE_AUTO_START` defaults to `false`; scheduled reviews must be enabled
explicitly.

## Position Sizing

Position sizing uses:

- Portfolio size
- Confidence
- Expected return
- Maximum dollar risk
- Maximum position size
- Unit contract risk
- Current portfolio heat
- Market regime

High-volatility, risk-off, macro-driven, news-driven, and sector-rotation
regimes reduce size before approval.

## JSON Schemas

Approval package:

```json
{
  "approved": false,
  "approvalId": "uuid",
  "recommendationId": "strategy-risk-package-id",
  "suggestedPositionSize": {
    "suggestedContracts": 2,
    "dollarRisk": 350,
    "capitalAllocation": 350,
    "expectedPortfolioImpact": 0.0035,
    "explanation": "Sized by confidence, return, heat, regime, and unit risk."
  },
  "portfolioRisk": {
    "dailyRealizedLoss": 0,
    "dailyUnrealizedLoss": 0,
    "riskConsumed": 0,
    "remainingRiskBudget": 1150,
    "maximumConsecutiveLosses": 3,
    "consecutiveLosses": 0,
    "maximumOpenRisk": 6000,
    "openRisk": 1200
  },
  "sectorExposure": {
    "Energy": 1200
  },
  "correlationRisk": {
    "score": 0.44,
    "correlatedSymbols": ["XLE"],
    "explanation": "OXY overlaps with Energy exposure."
  },
  "liquidityRisk": {
    "code": "PASSED",
    "passed": true,
    "explanation": "Liquidity metrics satisfy limits.",
    "supportingMetrics": {},
    "suggestedImprovement": null
  },
  "greekRisk": {},
  "buyingPowerRisk": {},
  "remainingRiskBudget": 1150,
  "reasons": [],
  "warnings": [],
  "timestamp": "2026-07-25T14:00:00.000Z"
}
```

Journal record:

```json
{
  "approvalId": "uuid",
  "timestamp": "2026-07-25T14:00:00.000Z",
  "recommendation": {},
  "approval": {},
  "rejection": [],
  "reasonCodes": [],
  "portfolioSnapshot": {},
  "exposure": {},
  "greeks": {},
  "buyingPower": null,
  "riskBudget": {},
  "ruleVersion": "risk-v1",
  "schemaVersion": 1
}
```

## API

All endpoints are read-only:

- `GET /api/risk-engine/status`
- `GET /api/risk-engine/portfolio`
- `GET /api/risk-engine/exposure`
- `GET /api/risk-engine/greeks`
- `GET /api/risk-engine/risk-budget`
- `GET /api/risk-engine/rules`
- `GET /api/risk-engine/history`
- `GET /api/risk-engine/approval-queue`

`approval-queue?preview=true` computes a non-persisted preview of the latest
pending Strategy Orchestrator recommendation. It does not create journal records.

## Reason Codes

- `MAX_SECTOR_EXPOSURE`
- `MAX_POSITION_SIZE`
- `LOW_LIQUIDITY`
- `HIGH_SPREAD`
- `HIGH_IV`
- `LOW_CONFIDENCE`
- `MAX_DAILY_LOSS`
- `INSUFFICIENT_BUYING_POWER`
- `HIGH_CORRELATION`
- `MAX_GAMMA`
- `MAX_DELTA`
- `MAX_THETA`
- `MAX_VEGA`
- `MARKET_CLOSED`
- `NEWS_LOCKOUT`
- `MAX_OPEN_TRADES`
- `MAX_DOLLAR_RISK`
- `NO_ACTIONABLE_RECOMMENDATION`
- `MISSING_LIQUIDITY_DATA`

## Examples

High spread rejection:

```json
{
  "approved": false,
  "status": "REJECT",
  "reasons": [
    {
      "code": "HIGH_SPREAD",
      "explanation": "The bid/ask spread is too wide for controlled execution risk.",
      "supportingMetrics": {
        "spreadPct": 0.4,
        "maximumSpreadPct": 0.18
      },
      "suggestedImprovement": "Use a tighter contract or wait for a narrower spread."
    }
  ]
}
```

Energy correlation:

```text
Existing: XLE, CVX
Incoming: OXY
Result: HIGH_CORRELATION when score exceeds configured limit
Action: reduce size or reject
```

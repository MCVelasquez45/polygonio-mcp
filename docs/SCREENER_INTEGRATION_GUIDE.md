# Integrating Python Screeners into Lab/Engine

## Overview
Your Python screeners (`0dte-covered-call`, `advanced-covered-call`) are **complete strategies**. This guide shows how to integrate them into the Lab/Engine workflow.

## Step-by-Step Integration

### 1. Register as a Lab Strategy

Create a Lab Strategy record that represents your screener:

```bash
# Using curl (or create a UI later)
curl -X POST http://localhost:4000/api/lab/strategy/create \
  -H "Content-Type: application/json" \
  -d '{
    "name": "0-DTE Covered Call Screener",
    "type": "screener",
    "ownerId": "user123",
    "screenerConfig": {
      "endpoint": "http://localhost:8001/api/screen/0dte-covered-calls",
      "params": {
        "symbol": "SPY",
        "min_otm_pct": 0.00,
        "max_otm_pct": 0.03,
        "delta_lo": 0.15,
        "delta_hi": 0.35,
        "min_bid": 0.05
      },
      "schedule": "daily_at_935"
    }
  }'
```

### 2. Backtest It

Your screener already has P&L calculation logic. We can create a backtest endpoint:

```bash
curl -X POST http://localhost:8001/api/lab/screener/backtest \
  -d '{
    "screener_type": "0dte_covered_call",
    "symbol": "SPY",
    "start_date": "2024-01-01",
    "end_date": "2024-12-31"
  }'

# Returns:
{
  "total_pnl": 15420,
  "win_rate": 0.68,
  "sharpe_ratio": 1.8,
  "trades": [...]
}
```

### 3. Request Handoff to Engine

Once validated, promote it:

```bash
curl -X POST http://localhost:4000/api/handoff/request \
  -d '{
    "strategyId": "67a1b2c3d4e5f678901234",
    "requesterId": "user123",
    "engineConfig": {
      "maxCapital": 50000,
      "riskLimits": {
        "maxDrawdown": 0.15,
        "maxDailyLoss": 2000
      },
      "symbols": ["SPY"]
    },
    "validationProof": {
      "sharpeRatio": 1.8,
      "expectedValue": 42,
      "backtestId": "bt-20240115"
    }
  }'
```

### 4. Engine Executes It

The Engine runs your screener on a schedule:

```typescript
// Engine cron job (9:35 AM daily)
async function runScreenerStrategies() {
  const screenerStrategies = await EngineStrategyModel.find({ type: 'screener', status: 'active' });
  
  for (const strategy of screenerStrategies) {
    // Call Python service
    const opportunities = await axios.post('http://localhost:8001/api/screen/0dte-covered-calls', {
      symbol: strategy.runtimeConfig.symbols[0],
      ...strategy.screenerConfig.params
    });
    
    // Execute top opportunity
    const bestOption = opportunities.data[0];
    await broker.submitOrder({
      symbol: bestOption.ticker,
      side: 'sell',
      type: 'limit',
      qty: 1,
      limit_price: bestOption.mid
    });
  }
}
```

## What You Need to Build

1. **[OPTIONAL] New API Endpoint**: `POST /api/lab/strategy/create` to register screeners
2. **Python Backtest Endpoint**: Extend your screener to support historical backtesting
3. **Engine Scheduler**: A cron job to periodically call approved screeners

## Quick Start

Run your screener manually right now:

```bash
# 1. Start Python service
cd python-screener-service
python main.py

# 2. Call it
curl -X POST http://localhost:8001/api/screen/0dte-covered-calls \
  -H "Content-Type: application/json" \
  -d '{"symbol": "SPY"}'

# 3. You'll get back opportunities - your "strategy output"
```

The screener IS the strategy. No model needed!

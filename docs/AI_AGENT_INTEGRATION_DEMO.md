# AI Agent → Lab/Engine Integration Demo

This demo shows how the AI agent can now create, backtest, and deploy strategies.

## Example Workflow

### 1. Ask the Agent for a Strategy Idea

**User**: _"What's a good 0-DTE covered call strategy for SPY tomorrow?"_

**Agent Response**:
```
Based on current volatility...I recommend:
- Delta range: 0.20-0.30 (safer)
- Min bid: $0.10
- OTM: 0.5-1.5%

Would you like me to backtest this strategy?
```

### 2. Agent Creates & Backtests

**Agent Action** (automatic):
```python
# 1. Create strategy in Lab
create_lab_strategy(
    name="0-DTE SPY Covered Call (AI Generated)",
    screener_type="0dte_covered_call",
    params={
        "delta_lo": 0.20,
        "delta_hi": 0.30,
        "min_bid": 0.10,
        "min_otm_pct": 0.005,
        "max_otm_pct": 0.015
    }
)

# 2. Run backtest
backtest_screener_strategy(
    screener_type="0dte_covered_call",
    symbol="SPY",
    start_date="2024-01-01",
    end_date="2024-12-31",
    params={...}
)
```

**Agent Response**:
```
Backtest Results (2024):
- Sharpe Ratio: 1.8
- Expected Value: $42/trade
- Win Rate: 68%
- Max Drawdown: 12%

This strategy shows a positive edge. Would you like me to deploy it to the Engine?
```

### 3. Agent Deploys to Engine

**User**: _"Yes, deploy with $10K capital"_

**Agent Action**:
```python
request_strategy_handoff(
    strategy_id="67a1b2c3...",
    max_capital=10000,
    max_drawdown=0.15,
    max_daily_loss=500,
    symbols=["SPY"]
)
```

**Agent Response**:
```
Strategy promoted! It's now pending approval in the Engine Room.
Once approved, it will run automatically at 9:35 AM daily.
```

## Try It Now

```bash
# Start all services
cd server && npm run dev              # Terminal 1
cd python-screener-service && python main.py  # Terminal 2

# Run the agent
python agent/cli.py
```

Ask: **"Create and backtest a 0-DTE covered call strategy for SPY"**

The agent will:
1. ✅ Propose optimal parameters
2. ✅ Register the strategy in the Lab DB
3. ✅ Run a historical backtest
4. ✅ Show you the Sharpe Ratio and EV
5. ✅ Offer to deploy if results are good

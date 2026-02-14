import numpy as np
import pandas as pd
from typing import List, Dict, Any, Optional
from datetime import datetime
from pydantic import BaseModel

class BacktestConfig(BaseModel):
    ticker: str
    start_date: str
    end_date: str
    strategy_config: Dict[str, Any]  # { type: "AR1", parameters: { weights: [-0.8], bias: 0.001 } }
    initial_capital: float = 100000.0

class BacktestResult(BaseModel):
    total_pnl: float
    sharpe_ratio: float
    expected_value: float
    win_rate: float
    drawdown: float
    trades: List[Dict[str, Any]]
    equity_curve: List[Dict[str, Any]]

class EdgeCalculator:
    @staticmethod
    def calculate_stats(trades: List[Dict[str, Any]], initial_capital: float) -> Dict[str, float]:
        if not trades:
            return {
                "total_pnl": 0.0,
                "sharpe_ratio": 0.0,
                "expected_value": 0.0,
                "win_rate": 0.0,
                "drawdown": 0.0
            }
        
        df = pd.DataFrame(trades)
        total_pnl = df['pnl'].sum()
        
        # Win Rate
        winners = df[df['pnl'] > 0]
        win_rate = len(winners) / len(df) if len(df) > 0 else 0.0
        
        # Expected Value (Average PnL per trade)
        expected_value = df['pnl'].mean()
        
        # Sharpe Ratio (assuming roughly even intervals for trade returns)
        # In a real engine, we'd use daily returns series. 
        # Here we approximate with per-trade return distribution.
        returns = df['pnl'] / initial_capital
        std_dev = returns.std()
        sharpe_ratio = (returns.mean() / std_dev) * np.sqrt(252) if std_dev > 0 else 0.0

        # Drawdown calculation
        # Reconstruct equity curve
        equity = [initial_capital]
        current_equity = initial_capital
        max_equity = initial_capital
        max_drawdown = 0.0

        for pnl in df['pnl']:
            current_equity += pnl
            max_equity = max(max_equity, current_equity)
            drawdown = (max_equity - current_equity) / max_equity
            max_drawdown = max(max_drawdown, drawdown)
            equity.append(current_equity)

        return {
            "total_pnl": total_pnl,
            "sharpe_ratio": sharpe_ratio,
            "expected_value": expected_value,
            "win_rate": win_rate,
            "drawdown": max_drawdown
        }

class BacktestEngine:
    def __init__(self, client):
        self.client = client

    def run(self, config: BacktestConfig) -> BacktestResult:
        # 1. Fetch Historical Data
        # For simplicity, using Aggy bars. In production, use Ticks for high fidelity.
        aggs = self.client.list_aggs(
            ticker=config.ticker,
            multiplier=1,
            timespan="minute",
            from_=config.start_date,
            to=config.end_date,
            limit=50000
        )
        
        bars = []
        for agg in aggs:
            bars.append({
                "timestamp": agg.timestamp,
                "close": agg.close,
                "volume": agg.volume
            })
        
        if not bars:
            return BacktestResult(
                total_pnl=0, sharpe_ratio=0, expected_value=0, 
                win_rate=0, drawdown=0, trades=[], equity_curve=[]
            )

        df = pd.DataFrame(bars)
        df['log_return'] = np.log(df['close'] / df['close'].shift(1))
        df = df.dropna()

        # 2. Run Strategy (Vectorized or Event-driven simulation)
        # Implementing simple event loop for demonstration
        
        model_type = config.strategy_config.get("type")
        params = config.strategy_config.get("parameters", {})
        
        trades = []
        position = 0 # 0, 1 (long), -1 (short)
        entry_price = 0.0
        
        # AR1 Logic: Predicted Return = Last Return * Weight + Bias
        weight = params.get("weights", [0])[0]
        bias = params.get("bias", 0.0)

        current_equity = config.initial_capital
        equity_curve = [{"timestamp": df.iloc[0]['timestamp'], "equity": current_equity}]

        # Iterate through bars
        # Note: In a real simulation, we'd avoid lookahead bias carefully.
        # Here, row i calculates signal for i+1. execution is at i+1 open/close.
        
        for i in range(1, len(df)):
            prev_row = df.iloc[i-1]
            curr_row = df.iloc[i]
            
            # Feature: Lag 1 Log Return
            feature = prev_row['log_return']
            
            # Model Prediction
            predicted_return = (feature * weight) + bias
            
            # Signal Generation
            signal = 0
            threshold = 0.0001 # Minimal threshold
            
            if predicted_return > threshold:
                signal = 1
            elif predicted_return < -threshold:
                signal = -1
            
            # Simple Execution Logic (Close and Flip)
            price = curr_row['close']
            
            if position != signal:
                # Close existing
                if position != 0:
                    pnl = (price - entry_price) * position * 100 # Assumes 100 shares
                    trades.append({
                        "timestamp": curr_row['timestamp'],
                        "side": "sell" if position == 1 else "buy",
                        "price": price,
                        "pnl": pnl
                    })
                    current_equity += pnl
                
                # Open new
                if signal != 0:
                    entry_price = price
                    position = signal
            
            equity_curve.append({
                "timestamp": curr_row['timestamp'],
                "equity": current_equity
            })

        # Calculate Statistics
        stats = EdgeCalculator.calculate_stats(trades, config.initial_capital)

        return BacktestResult(
            total_pnl=stats['total_pnl'],
            sharpe_ratio=stats['sharpe_ratio'],
            expected_value=stats['expected_value'],
            win_rate=stats['win_rate'],
            drawdown=stats['drawdown'],
            trades=trades[-50:], # Limit trade history in response
            equity_curve=equity_curve[::10] # Sample equity curve for chart
        )

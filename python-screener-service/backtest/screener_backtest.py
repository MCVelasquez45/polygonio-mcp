import pandas as pd
from typing import List, Dict, Any
from datetime import datetime, timedelta
from pydantic import BaseModel, Field
from screener import find_best_options_calls, make_client

# Define ScreenParams locally for backtest usage
class ScreenParams(BaseModel):
    symbol: str = "SPY"
    expiration_days: int = Field(default=0, ge=0)
    min_otm_pct: float = 0.00
    max_otm_pct: float = 0.03
    delta_lo: float = 0.15
    delta_hi: float = 0.35
    min_bid: float = 0.05
    min_open_interest: int = 1
    max_spread_to_mid: float = 0.75
    rank_metric: str = "premium_yield"

class ScreenerBacktestConfig(BaseModel):
    screener_type: str  # '0dte_covered_call' or 'advanced_covered_call'
    symbol: str
    start_date: str
    end_date: str
    params: Dict[str, Any]  # Screener params (delta_lo, etc.)

class ScreenerBacktestResult(BaseModel):
    total_pnl: float
    sharpe_ratio: float
    expected_value: float
    win_rate: float
    drawdown: float
    trades: List[Dict[str, Any]]
    period: Dict[str, str]

class ScreenerBacktester:
    def __init__(self, client):
        self.client = client

    def run(self, config: ScreenerBacktestConfig) -> ScreenerBacktestResult:
        """
        Backtest a screener strategy by:
        1. Running the screener on each trading day in the period
        2. Simulating selling the top recommendation
        3. Calculating P&L assuming held to expiration
        """
        
        start = datetime.strptime(config.start_date, '%Y-%m-%d')
        end = datetime.strptime(config.end_date, '%Y-%m-%d')
        
        trades = []
        current_date = start
        
        # For 0-DTE, run daily
        while current_date <= end:
            # Skip weekends
            if current_date.weekday() >= 5:
                current_date += timedelta(days=1)
                continue
            
            try:
                # Run screener for this date
                screener_params = ScreenParams(
                    symbol=config.symbol,
                    expiration_days=0,
                    **config.params
                )
                
                opportunities = find_best_options_calls(self.client, screener_params)
                
                if opportunities:
                    best = opportunities[0]
                    
                    # Simulate: Sell covered call at mid price
                    entry_price = best['mid']
                    spot_at_entry = best['spot']
                    strike = best['strike']
                    
                    # Simplified P&L calculation
                    # Assume: held to expiration, stock ends at spot (neutral assumption)
                    # Real implementation would fetch actual closing price
                    
                    # If stock closes below strike: keep premium
                    # If stock closes above: premium - (close - strike)
                    # For backtesting, we'll use statistical approach:
                    # P&L = Premium * (1 - PoP_of_assignment)
                    
                    pop_est = best.get('pop_est', 0.5)
                    max_profit = entry_price * 100  # Per contract
                    max_loss = (strike - spot_at_entry + entry_price) * 100
                    
                    # Simplified: use EV approximation
                    pnl = max_profit * pop_est + max_loss * (1 - pop_est) if pop_est else max_profit * 0.7
                    
                    trades.append({
                        'date': current_date.strftime('%Y-%m-%d'),
                        'ticker': best['ticker'],
                        'entry_price': entry_price,
                        'strike': strike,
                        'pnl': pnl
                    })
            
            except Exception as e:
                print(f"Error on {current_date}: {e}")
            
            current_date += timedelta(days=1)
        
        # Calculate stats
        if not trades:
            return ScreenerBacktestResult(
                total_pnl=0, sharpe_ratio=0, expected_value=0,
                win_rate=0, drawdown=0, trades=[],
                period={'start': config.start_date, 'end': config.end_date}
            )
        
        df = pd.DataFrame(trades)
        total_pnl = df['pnl'].sum()
        
        # Win Rate
        winners = df[df['pnl'] > 0]
        win_rate = len(winners) / len(df)
        
        # Expected Value
        expected_value = df['pnl'].mean()
        
        # Sharpe (annualized)
        returns = df['pnl']
        sharpe_ratio = (returns.mean() / returns.std()) * (252 ** 0.5) if returns.std() > 0 else 0
        
        # Drawdown
        cumulative = returns.cumsum()
        running_max = cumulative.cummax()
        drawdown_series = (cumulative - running_max) / running_max.abs()
        max_drawdown = abs(drawdown_series.min()) if len(drawdown_series) > 0 else 0
        
        return ScreenerBacktestResult(
            total_pnl=total_pnl,
            sharpe_ratio=sharpe_ratio,
            expected_value=expected_value,
            win_rate=win_rate,
            drawdown=max_drawdown,
            trades=trades[-30:],  # Last 30 trades
            period={'start': config.start_date, 'end': config.end_date}
        )

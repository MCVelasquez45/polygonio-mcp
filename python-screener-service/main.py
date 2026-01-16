from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from contextlib import asynccontextmanager
import os
import logging
from screener import find_best_options_calls, make_client
from backtest.engine import BacktestEngine, BacktestConfig, BacktestResult
from backtest.screener_backtest import ScreenerBacktester, ScreenerBacktestConfig, ScreenerBacktestResult
from dotenv import load_dotenv

# Load env
load_dotenv()

# Setup Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("screener-service")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: check API keys
    key = os.getenv("POLYGON_API_KEY")
    if not key:
        logger.warning("POLYGON_API_KEY is not set. Screener will fail.")
    yield
    # Shutdown

app = FastAPI(title="Polygon Screener Service", version="1.0.0", lifespan=lifespan)

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
    rank_metric: Literal["premium_yield", "max_profit", "pop_est"] = "premium_yield"

class Opportunity(BaseModel):
    ticker: str
    expiration: str
    strike: float
    delta: float | None
    bid: float
    ask: float
    mid: float
    open_interest: int
    iv: float | None
    spot: float
    premium_yield: float
    breakeven: float
    max_profit: float
    pop_est: float | None

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "python-screener-service"}

@app.post("/api/screen/0dte-covered-calls", response_model=List[Opportunity])
def screen_0dte(params: ScreenParams):
    logger.info(f"Screening for {params.symbol} with params: {params}")
    try:
        client = make_client()
        # Call the Logic
        results = find_best_options_calls(client, params)
        return results
    except Exception as e:
        logger.error(f"Screening error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/lab/backtest", response_model=BacktestResult)
def run_backtest(config: BacktestConfig):
    logger.info(f"Running backtest for {config.ticker}")
    try:
        client = make_client()
        engine = BacktestEngine(client)
        result = engine.run(config)
        return result
    except Exception as e:
        logger.error(f"Backtest error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/lab/screener/backtest", response_model=ScreenerBacktestResult)
def run_screener_backtest(config: ScreenerBacktestConfig):
    logger.info(f"Running screener backtest for {config.symbol}")
    try:
        client = make_client()
        backtester = ScreenerBacktester(client)
        result = backtester.run(config)
        return result
    except Exception as e:
        logger.error(f"Screener backtest error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- Universe Scanner ---

# Default watchlist of liquid options underlyings
DEFAULT_WATCHLIST = [
    "SPY",   # S&P 500 ETF
    "QQQ",   # Nasdaq 100 ETF
    "IWM",   # Russell 2000 ETF
    "AAPL",  # Apple
    "NVDA",  # NVIDIA
    "TSLA",  # Tesla
    "MSFT",  # Microsoft
    "AMD",   # AMD
    "META",  # Meta
    "AMZN",  # Amazon
]


class ScanRequest(BaseModel):
    tickers: List[str] = DEFAULT_WATCHLIST
    top_n: int = Field(default=5, ge=1, le=20)
    # Screener params
    min_otm_pct: float = 0.00
    max_otm_pct: float = 0.03
    delta_lo: float = 0.15
    delta_hi: float = 0.35
    min_bid: float = 0.05
    rank_metric: Literal["premium_yield", "max_profit", "pop_est"] = "premium_yield"


class ScanResult(BaseModel):
    symbol: str
    best_option: Optional[Opportunity]
    premium_yield: float
    has_opportunities: bool
    error: Optional[str] = None


class ScanResponse(BaseModel):
    scanned_count: int
    successful_count: int
    top_opportunities: List[ScanResult]
    market_status: str = "open"
    message: Optional[str] = None


@app.post("/api/scan/0dte-universe", response_model=ScanResponse)
def scan_universe(request: ScanRequest):
    """
    Scan multiple tickers to find the best 0-DTE covered call opportunities.
    Returns the top N candidates ranked by the specified metric.
    """
    logger.info(f"Scanning {len(request.tickers)} tickers for 0-DTE opportunities")
    
    client = make_client()
    results: List[ScanResult] = []

    # Check Market Status
    market_status = "open"
    expiration_days = 0
    note = None

    try:
        status_obj = client.get_market_status()
        market_status = getattr(status_obj, "market", "open").lower()
    except Exception as e:
        logger.warning(f"Could not check market status: {e}")

    # Fallback logic: If market is closed/extended, 0-DTE for today is over.
    # Look at tomorrow's opportunities (effective 0-DTE at next open).
    if market_status != "open":
        expiration_days = 1
        note = f"Market is {market_status}. Showing candidates for next trading session (1-DTE)."
        logger.info(note)
    
    for symbol in request.tickers:
        try:
            params = ScreenParams(
                symbol=symbol,
                expiration_days=expiration_days,
                min_otm_pct=request.min_otm_pct,
                max_otm_pct=request.max_otm_pct,
                delta_lo=request.delta_lo,
                delta_hi=request.delta_hi,
                min_bid=request.min_bid,
                rank_metric=request.rank_metric
            )
            
            opportunities = find_best_options_calls(client, params)
            
            if opportunities:
                best = opportunities[0]
                results.append(ScanResult(
                    symbol=symbol,
                    best_option=Opportunity(**best),
                    premium_yield=best.get("premium_yield", 0),
                    has_opportunities=True
                ))
            else:
                results.append(ScanResult(
                    symbol=symbol,
                    best_option=None,
                    premium_yield=0,
                    has_opportunities=False
                ))
                
        except Exception as e:
            logger.warning(f"Error scanning {symbol}: {e}")
            results.append(ScanResult(
                symbol=symbol,
                best_option=None,
                premium_yield=0,
                has_opportunities=False,
                error=str(e)
            ))
    
    # Sort by premium_yield (or chosen metric) and take top N
    successful = [r for r in results if r.has_opportunities]
    successful.sort(key=lambda x: x.premium_yield, reverse=True)
    top_n = successful[:request.top_n]
    
    # Broadcast to UI if running in integrated mode
    try:
        if top_n:
            import requests  # Ensure requests is imported or available
            webhook_url = "http://localhost:4000/api/engine/hooks/screener-result"
            # Extract just the dicts from the Pydantic models for JSON serialization
            opps_json = [r.dict() for r in top_n]
            requests.post(webhook_url, json={"opportunities": opps_json, "strategyName": "AI Agent 0-DTE Scan"}, timeout=1)
    except Exception as e:
        logger.warning(f"Failed to broadcast results to UI: {e}")

    return ScanResponse(
        scanned_count=len(request.tickers),
        successful_count=len(successful),
        top_opportunities=top_n,
        market_status=market_status,
        message=note
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)

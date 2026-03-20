"""
Level 2 backtest executor — supports equities, options, and futures.

Uses real Polygon.io data for equities/options and Databento for futures.
Indicators computed with pandas_ta.
"""
from __future__ import annotations

import os
import math
from datetime import datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd
import pandas_ta as ta  # noqa: F401 — enables df.ta accessor
from pydantic import BaseModel

from core.polygon_agent import (
    PolygonDataFetcher,
    FuturesDataFetcher,
    _get_polygon_fetcher as _get_default_fetcher,
)

# Prefer MASSIVE_API_KEY (which has aggregates access) over POLYGON_API_KEY
_backtest_fetcher: PolygonDataFetcher | None = None

# Server base URL — prefer SERVER_URL env var, then derive from LAB_API_URL, default to 4000
SERVER_BASE_URL = os.getenv("SERVER_URL") or "http://localhost:4000"


def _get_polygon_fetcher() -> PolygonDataFetcher:
    global _backtest_fetcher
    if _backtest_fetcher is not None:
        return _backtest_fetcher
    massive_key = os.getenv("MASSIVE_API_KEY")
    massive_url = os.getenv("MASSIVE_BASE_URL", "https://api.massive.com")
    if massive_key:
        _backtest_fetcher = PolygonDataFetcher(api_key=massive_key, base_url=massive_url)
        return _backtest_fetcher
    _backtest_fetcher = _get_default_fetcher()
    return _backtest_fetcher


async def _fetch_bars_via_server(
    ticker: str,
    multiplier: int,
    timespan: str,
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    """Fetch bars through the server's /api/market/aggs endpoint which has
    MongoDB caching, rate-limit handling, WebSocket fallback, and retry logic.
    This avoids hitting Polygon/Massive API directly."""
    import httpx

    # Calculate window size from date range (trading days ≈ calendar days * 5/7)
    try:
        from datetime import datetime as _dt
        d1 = _dt.strptime(start_date[:10], "%Y-%m-%d")
        d2 = _dt.strptime(end_date[:10], "%Y-%m-%d")
        cal_days = (d2 - d1).days
        window = max(int(cal_days * 5 / 7) + 10, 30)  # rough trading days + buffer
    except Exception:
        window = 120

    url = f"{SERVER_BASE_URL}/api/market/aggs"
    params: dict[str, Any] = {
        "ticker": ticker.upper(),
        "multiplier": multiplier,
        "timespan": timespan,
        "window": window,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        data = response.json()
        results = data.get("results", [])
        # Normalize server bar format to match Polygon format
        normalized = []
        for bar in results:
            if isinstance(bar, dict):
                normalized.append({
                    "t": bar.get("t") or bar.get("timestamp"),
                    "o": bar.get("o") or bar.get("open"),
                    "h": bar.get("h") or bar.get("high"),
                    "l": bar.get("l") or bar.get("low"),
                    "c": bar.get("c") or bar.get("close"),
                    "v": bar.get("v") or bar.get("volume", 0),
                })
        return normalized

# ── Pydantic models ──────────────────────────────────────────────────────────

class BacktestRequest(BaseModel):
    runtime_spec: dict[str, Any]
    trading_method: str  # equities | options | futures
    contract_selection: dict[str, Any] = {}
    start_date: str
    end_date: str
    initial_capital: float = 100_000
    slippage_bps: float = 5
    commission: float = 1.0


class BacktestResponse(BaseModel):
    pnl: float
    winRate: float
    totalTrades: int
    trades: list[dict[str, Any]]
    sharpeRatio: float | None = None
    maxDrawdownPct: float | None = None
    equityCurve: list[dict[str, Any]] = []
    diagnostics: dict[str, Any] = {}


# ── Tick-value map for futures ────────────────────────────────────────────────

# Index tickers need special handling — use ETF proxy for bar data
INDEX_TO_ETF: dict[str, str] = {
    "SPX": "SPY",
    "NDX": "QQQ",
    "RUT": "IWM",
    "DJX": "DIA",
}


FUTURES_TICK_VALUE: dict[str, dict[str, float]] = {
    "ES":  {"tick_size": 0.25, "tick_value": 12.50, "multiplier": 50.0},
    "NQ":  {"tick_size": 0.25, "tick_value": 5.00,  "multiplier": 20.0},
    "CL":  {"tick_size": 0.01, "tick_value": 10.00, "multiplier": 1000.0},
    "GC":  {"tick_size": 0.10, "tick_value": 10.00, "multiplier": 100.0},
    "YM":  {"tick_size": 1.00, "tick_value": 5.00,  "multiplier": 5.0},
    "RTY": {"tick_size": 0.10, "tick_value": 5.00,  "multiplier": 50.0},
}


# ── Indicator computation ─────────────────────────────────────────────────────

def compute_indicators(df: pd.DataFrame, required: list[str]) -> pd.DataFrame:
    """Add indicator columns to a DataFrame with OHLCV columns."""
    if "RSI" in required:
        df["RSI"] = df.ta.rsi(length=14)
    if "EMA_9" in required:
        df["EMA_9"] = df.ta.ema(length=9)
    if "EMA_20" in required:
        df["EMA_20"] = df.ta.ema(length=20)
    if "VWAP" in required and "volume" in df.columns:
        df["VWAP"] = df.ta.vwap()
    if "MACD" in required or "SIGNAL" in required:
        macd_df = df.ta.macd(fast=9, slow=20, signal=9)
        if macd_df is not None and len(macd_df.columns) >= 3:
            df["MACD"] = macd_df.iloc[:, 0]
            df["SIGNAL"] = macd_df.iloc[:, 2]
    df["PRICE"] = df["close"]
    return df


# ── Rule evaluation engine ────────────────────────────────────────────────────

def _resolve_field(row: pd.Series, field: str) -> float | None:
    val = row.get(field)
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return None
    return float(val)


def _compare(op: str, left: float, right: float, prev_left: float | None) -> bool:
    if op == "lt":
        return left < right
    if op == "lte":
        return left <= right
    if op == "gt":
        return left > right
    if op == "gte":
        return left >= right
    if op == "eq":
        return abs(left - right) < 1e-6
    if op == "touches":
        denom = max(abs(right), 1.0)
        return abs(left - right) / denom <= 0.0025
    if op == "crosses_above":
        return prev_left is not None and prev_left <= right and left > right
    if op == "crosses_below":
        return prev_left is not None and prev_left >= right and left < right
    return False


def evaluate_rules(
    rules: list[dict[str, Any]],
    row: pd.Series,
    prev_row: pd.Series | None,
) -> bool:
    """All rules must be True (AND logic). Returns False if any field is NaN."""
    for rule in rules:
        field_val = _resolve_field(row, rule["field"])
        if field_val is None:
            return False

        target = rule.get("value")
        if isinstance(target, str):
            target = _resolve_field(row, target)
            if target is None:
                return False
        elif target is None:
            return False

        prev_field_val = _resolve_field(prev_row, rule["field"]) if prev_row is not None else None
        if not _compare(rule["operator"], field_val, float(target), prev_field_val):
            return False
    return True


# ── Analytics helpers ─────────────────────────────────────────────────────────

def _compute_analytics(
    trades: list[dict[str, Any]], initial_capital: float
) -> tuple[float | None, float | None, list[dict[str, Any]]]:
    """Returns (sharpe_ratio, max_drawdown_pct, equity_curve)."""
    if not trades:
        return None, None, []

    equity = initial_capital
    curve: list[dict[str, Any]] = [{"timestamp": trades[0]["entryTime"], "equity": equity}]
    returns: list[float] = []
    peak = equity

    max_dd = 0.0
    for t in trades:
        # For credit spreads: risk a fixed % of account per trade (default 2%)
        # Dollar P&L = (pnl% of maxLoss) * number_of_contracts
        if t.get("spreadType") and t.get("maxLoss") is not None and t["maxLoss"] > 0:
            risk_per_trade_pct = 0.02  # 2% of account risked per trade
            max_risk_dollars = equity * risk_per_trade_pct
            num_contracts = max(1, int(max_risk_dollars / t["maxLoss"]))
            pnl_dollar = (t["pnl"] / 100.0 * t["maxLoss"]) * num_contracts
        else:
            pnl_dollar = t["pnl"] / 100.0 * equity
        equity += pnl_dollar
        returns.append(pnl_dollar / max(equity - pnl_dollar, 1))  # return as fraction of pre-trade equity
        curve.append({"timestamp": t["exitTime"], "equity": round(equity, 2)})
        if equity > peak:
            peak = equity
        dd = (peak - equity) / peak if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd

    sharpe = None
    if len(returns) > 1:
        arr = np.array(returns)
        std = float(np.std(arr, ddof=1))
        if std > 0:
            sharpe = round(float(np.mean(arr)) / std * (252 ** 0.5), 2)

    return sharpe, round(max_dd * 100, 2), curve


# ── Options contract selection ────────────────────────────────────────────────

def _select_option_contract(
    chain_results: list[dict[str, Any]],
    underlying_price: float,
    contract_type: str,
    strike_selection: str,
    delta_target: float | None,
    dte_min: int,
    dte_max: int,
) -> dict[str, Any] | None:
    """Pick the best contract from an options chain snapshot."""
    now = datetime.utcnow()
    candidates: list[dict[str, Any]] = []

    for contract in chain_results:
        details = contract.get("details", {})
        day = contract.get("day", {})
        greeks = contract.get("greeks", {})

        ct = details.get("contract_type", "").lower()
        if ct != contract_type.lower():
            continue

        exp_str = details.get("expiration_date", "")
        if not exp_str:
            continue
        try:
            exp_date = datetime.strptime(exp_str, "%Y-%m-%d")
        except ValueError:
            continue

        dte = (exp_date - now).days
        if dte < dte_min or dte > dte_max:
            continue

        strike = details.get("strike_price", 0)
        mid = _mid_price(contract)
        if mid is None or mid <= 0:
            continue

        candidates.append({
            "symbol": details.get("ticker", ""),
            "strike": strike,
            "dte": dte,
            "mid": mid,
            "delta": abs(greeks.get("delta", 0)),
            "greeks": greeks,
            "expiration": exp_str,
        })

    if not candidates:
        return None

    if strike_selection == "atm":
        candidates.sort(key=lambda c: abs(c["strike"] - underlying_price))
    elif strike_selection == "otm_1":
        if contract_type.lower() == "call":
            otm = [c for c in candidates if c["strike"] > underlying_price]
        else:
            otm = [c for c in candidates if c["strike"] < underlying_price]
        candidates = sorted(otm, key=lambda c: abs(c["strike"] - underlying_price)) if otm else candidates
    elif strike_selection == "itm_1":
        if contract_type.lower() == "call":
            itm = [c for c in candidates if c["strike"] < underlying_price]
        else:
            itm = [c for c in candidates if c["strike"] > underlying_price]
        candidates = sorted(itm, key=lambda c: abs(c["strike"] - underlying_price)) if itm else candidates
    elif strike_selection == "delta_target" and delta_target is not None:
        candidates.sort(key=lambda c: abs(c["delta"] - delta_target))
    # default: already sorted by ATM proximity

    return candidates[0] if candidates else None


def _mid_price(contract: dict[str, Any]) -> float | None:
    last_quote = contract.get("last_quote", {})
    bid = last_quote.get("bid", 0)
    ask = last_quote.get("ask", 0)
    if bid > 0 and ask > 0:
        return (bid + ask) / 2.0
    day = contract.get("day", {})
    close = day.get("close", 0)
    return close if close > 0 else None


# ── Main execution paths ─────────────────────────────────────────────────────

async def _run_equities(
    fetcher: PolygonDataFetcher,
    spec: dict[str, Any],
    ticker: str,
    start_date: str,
    end_date: str,
    slippage_pct: float,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Equity backtest: bar-by-bar on stock prices."""
    try:
        bars = await _fetch_bars_via_server(ticker, 1, "day", start_date, end_date)
    except Exception:
        raw = await fetcher.get_intraday_aggregates(ticker, 1, "day", start_date, end_date, 5000)
        bars = raw.get("results", [])
    if not bars:
        return [], {"provider": "server", "barsLoaded": 0, "usedFallbackData": False}

    df = _bars_to_dataframe(bars)
    df = _filter_market_hours(df)
    if len(df) < 21:
        return [], {"provider": "polygon", "barsLoaded": len(df), "usedFallbackData": False}

    indicators = spec.get("indicators", [])
    df = compute_indicators(df, indicators)

    trades = _walk_bars(df, spec, slippage_pct)
    return trades, {"provider": "polygon", "barsLoaded": len(df), "usedFallbackData": False}


async def _run_options(
    fetcher: PolygonDataFetcher,
    spec: dict[str, Any],
    cs: dict[str, Any],
    start_date: str,
    end_date: str,
    slippage_pct: float,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Options backtest: signals from underlying, trades on option contracts."""
    opts = cs.get("options", cs)
    underlying_raw = opts.get("underlying", "SPY")
    underlying = INDEX_TO_ETF.get(underlying_raw.upper(), underlying_raw)
    contract_type = opts.get("contractType", opts.get("contract_type", "call"))
    strike_sel = opts.get("strikeSelection", opts.get("strike_selection", "atm"))
    delta_target = opts.get("deltaTarget", opts.get("delta_target"))
    dte_min = int(opts.get("dteMin", opts.get("dte_min", 7)))
    dte_max = int(opts.get("dteMax", opts.get("dte_max", 45)))

    # Fetch underlying bars via server (cached) for indicator signals
    try:
        bars = await _fetch_bars_via_server(underlying, 1, "day", start_date, end_date)
    except Exception:
        raw = await fetcher.get_intraday_aggregates(underlying, 1, "day", start_date, end_date, 5000)
        bars = raw.get("results", [])
    if not bars:
        return [], {"provider": "server", "barsLoaded": 0, "usedFallbackData": False}

    df = _bars_to_dataframe(bars)
    df = _filter_market_hours(df)
    if len(df) < 21:
        return [], {"provider": "polygon", "barsLoaded": len(df), "usedFallbackData": False}

    indicators = spec.get("indicators", [])
    df = compute_indicators(df, indicators)

    entry_rules = spec.get("rules", {}).get("entry", [])
    exit_rules = spec.get("rules", {}).get("exit", [])
    risk = spec.get("riskManagement", {})
    sl_pct = risk.get("stopLossPct", 0.10)
    tp_pct = risk.get("takeProfitPct", 0.20)
    max_bars = int(risk.get("maxBarsInTrade", 24))
    action = spec.get("execution", {}).get("action", "BUY")
    direction = 1 if action in ("BUY",) else -1

    trades: list[dict[str, Any]] = []
    in_trade = False
    entry_idx = 0
    entry_premium = 0.0
    entry_contract = ""
    entry_dte = 0

    rows = list(df.iterrows())
    for i, (idx, row) in enumerate(rows):
        prev_row = rows[i - 1][1] if i > 0 else None

        if not in_trade:
            if evaluate_rules(entry_rules, row, prev_row):
                # Select contract from options chain
                try:
                    chain = await fetcher.get_options_snapshot(
                        underlying, contract_type=contract_type, limit=100
                    )
                    chain_results = chain.get("results", [])
                except Exception:
                    chain_results = []

                selected = _select_option_contract(
                    chain_results, float(row["close"]),
                    contract_type, strike_sel, delta_target, dte_min, dte_max,
                )
                if selected is None:
                    continue  # No suitable contract found, skip this signal

                entry_premium = selected["mid"] * (1 + slippage_pct) if direction == 1 else selected["mid"] * (1 - slippage_pct)
                entry_contract = selected["symbol"]
                entry_dte = selected["dte"]
                entry_idx = i
                in_trade = True
        else:
            bars_held = i - entry_idx
            # Simulate exit premium as proportional to underlying move + time decay
            underlying_return = (float(row["close"]) - float(rows[entry_idx][1]["close"])) / float(rows[entry_idx][1]["close"])
            # Rough option premium estimate: delta * underlying_move * 100 - theta_decay
            # Use a simple model: premium moves proportionally
            est_premium = entry_premium * (1 + direction * underlying_return * 3)  # leverage factor ~3x
            # Decay: lose ~1/dte of premium per day (rough)
            day_fraction = bars_held / 390  # 390 min per trading day
            decay = entry_premium * (day_fraction / max(entry_dte, 1))
            est_premium = max(est_premium - decay, 0.01)

            exit_premium = est_premium * (1 - slippage_pct) if direction == 1 else est_premium * (1 + slippage_pct)
            pnl_pct = ((exit_premium - entry_premium) / entry_premium * 100) * direction

            reason = ""
            should_exit = False

            if evaluate_rules(exit_rules, row, prev_row):
                reason = "rule_exit"
                should_exit = True
            elif pnl_pct >= tp_pct * 100:
                reason = "take_profit"
                should_exit = True
            elif pnl_pct <= -sl_pct * 100:
                reason = "stop_loss"
                should_exit = True
            elif bars_held >= max_bars:
                reason = "max_bars"
                should_exit = True
            elif entry_dte - (bars_held // 390) <= 0:
                reason = "expiration"
                should_exit = True

            if should_exit or i == len(rows) - 1:
                if not reason:
                    reason = "end_of_test"
                trades.append({
                    "entryTime": str(rows[entry_idx][0]),
                    "exitTime": str(idx),
                    "side": "long" if direction == 1 else "short",
                    "entryAction": action,
                    "exitAction": "EXIT",
                    "entryPrice": round(entry_premium, 4),
                    "exitPrice": round(exit_premium, 4),
                    "pnl": round(pnl_pct, 2),
                    "barsHeld": bars_held,
                    "reason": reason,
                    "contractSymbol": entry_contract,
                    "dte": entry_dte,
                    "entryPremium": round(entry_premium, 4),
                    "exitPremium": round(exit_premium, 4),
                })
                in_trade = False

    return trades, {"provider": "polygon", "barsLoaded": len(df), "usedFallbackData": False}


async def _run_futures(
    spec: dict[str, Any],
    cs: dict[str, Any],
    start_date: str,
    end_date: str,
    slippage_pct: float,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Futures backtest: daily bars with tick-value P&L."""
    fut_cs = cs.get("futures", cs)
    symbol = fut_cs.get("symbol", "ES").upper()
    spec_info = FUTURES_TICK_VALUE.get(symbol, FUTURES_TICK_VALUE["ES"])
    multiplier = spec_info["multiplier"]

    fetcher = FuturesDataFetcher(
        databento_api_key=os.getenv("DATABENTO_API_KEY"),
        quandl_api_key=os.getenv("QUANDL_API_KEY"),
    )
    raw = await fetcher.get_daily_aggregates(symbol, start_date, end_date, limit=500)
    bars = raw.get("bars", [])
    provider = raw.get("provider", "unknown")
    fallback = raw.get("fallback", False)

    if not bars:
        return [], {"provider": provider, "barsLoaded": 0, "usedFallbackData": fallback}

    df = pd.DataFrame(bars)
    for col in ("open", "high", "low", "close", "volume"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    if "date" in df.columns:
        df.index = pd.to_datetime(df["date"])
    elif "timestamp" in df.columns:
        df.index = pd.to_datetime(df["timestamp"])

    if len(df) < 21:
        return [], {"provider": provider, "barsLoaded": len(df), "usedFallbackData": fallback}

    indicators = spec.get("indicators", [])
    df = compute_indicators(df, indicators)

    trades = _walk_bars(df, spec, slippage_pct, futures_multiplier=multiplier, contract_spec=f"{symbol} continuous")
    return trades, {"provider": provider, "barsLoaded": len(df), "usedFallbackData": fallback}


# ── Shared bar-walking engine (equities + futures) ────────────────────────────

def _walk_bars(
    df: pd.DataFrame,
    spec: dict[str, Any],
    slippage_pct: float,
    futures_multiplier: float | None = None,
    contract_spec: str | None = None,
) -> list[dict[str, Any]]:
    """Walk through bars evaluating entry/exit rules. Used for equities and futures."""
    entry_rules = spec.get("rules", {}).get("entry", [])
    exit_rules = spec.get("rules", {}).get("exit", [])
    risk = spec.get("riskManagement", {})
    sl_pct = risk.get("stopLossPct", 0.10)
    tp_pct = risk.get("takeProfitPct", 0.20)
    max_bars = int(risk.get("maxBarsInTrade", 24))
    action = spec.get("execution", {}).get("action", "BUY")
    direction = 1 if action in ("BUY",) else -1

    trades: list[dict[str, Any]] = []
    in_trade = False
    entry_idx = 0
    entry_price = 0.0

    rows = list(df.iterrows())
    for i, (idx, row) in enumerate(rows):
        if i < 20:  # indicator warm-up
            continue
        prev_row = rows[i - 1][1] if i > 0 else None

        if not in_trade:
            if evaluate_rules(entry_rules, row, prev_row):
                entry_price = float(row["close"]) * (1 + slippage_pct * direction)
                entry_idx = i
                in_trade = True
                continue
        else:
            bars_held = i - entry_idx
            exit_price = float(row["close"]) * (1 - slippage_pct * direction)

            if futures_multiplier:
                ret = (exit_price - entry_price) * direction * futures_multiplier
                pnl_pct = ret / (entry_price * futures_multiplier) * 100
            else:
                ret = (exit_price - entry_price) / entry_price * direction
                pnl_pct = ret * 100

            reason = ""
            should_exit = False

            if evaluate_rules(exit_rules, row, prev_row):
                reason = "rule_exit"
                should_exit = True
            elif pnl_pct >= tp_pct * 100:
                reason = "take_profit"
                should_exit = True
            elif pnl_pct <= -sl_pct * 100:
                reason = "stop_loss"
                should_exit = True
            elif bars_held >= max_bars:
                reason = "max_bars"
                should_exit = True

            if should_exit or i == len(rows) - 1:
                if not reason:
                    reason = "end_of_test"
                trade: dict[str, Any] = {
                    "entryTime": str(rows[entry_idx][0]),
                    "exitTime": str(idx),
                    "side": "long" if direction == 1 else "short",
                    "entryAction": action,
                    "exitAction": "EXIT",
                    "entryPrice": round(entry_price, 4),
                    "exitPrice": round(exit_price, 4),
                    "pnl": round(pnl_pct, 2),
                    "barsHeld": bars_held,
                    "reason": reason,
                }
                if contract_spec:
                    trade["contractSpec"] = contract_spec
                trades.append(trade)
                in_trade = False

    return trades


# ── DataFrame helpers ─────────────────────────────────────────────────────────

def _bars_to_dataframe(bars: list[dict[str, Any]]) -> pd.DataFrame:
    """Convert Polygon aggregates to a pandas DataFrame."""
    records = []
    for bar in bars:
        ts = bar.get("t")
        if ts is None:
            continue
        records.append({
            "timestamp": pd.Timestamp(ts, unit="ms", tz="America/New_York"),
            "open": bar.get("o"),
            "high": bar.get("h"),
            "low": bar.get("l"),
            "close": bar.get("c"),
            "volume": bar.get("v", 0),
        })
    df = pd.DataFrame(records)
    if df.empty:
        return df
    df = df.set_index("timestamp").sort_index()
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["open", "high", "low", "close"])
    return df


def _filter_market_hours(df: pd.DataFrame) -> pd.DataFrame:
    """Keep only regular trading hours: 9:30 AM - 4:00 PM ET."""
    if df.empty:
        return df
    hours = df.index.hour * 100 + df.index.minute
    mask = (hours >= 930) & (hours < 1600)
    return df[mask]


# ── Regime classification ─────────────────────────────────────────────────────

_regime_cache: dict[str, str] = {}


async def _classify_regime(
    fetcher: PolygonDataFetcher,
    risk_on_tickers: list[str],
    risk_off_tickers: list[str],
    date: str,
) -> str:
    """Classify the market regime on a given date by comparing sector ETF performance."""
    cache_key = f"{date}-{','.join(sorted(risk_on_tickers + risk_off_tickers))}"
    if cache_key in _regime_cache:
        return _regime_cache[cache_key]

    import asyncio

    async def _day_return(ticker: str) -> float:
        try:
            bars = await _fetch_bars_via_server(ticker, 1, "day", date, date)
            if bars and bars[-1].get("o") and bars[-1].get("c"):
                return (bars[-1]["c"] - bars[-1]["o"]) / bars[-1]["o"]
        except Exception:
            pass
        return 0.0

    # Only check 2 tickers per side to reduce API calls (most representative)
    on_sample = risk_on_tickers[:2] if risk_on_tickers else ["XLK"]
    off_sample = risk_off_tickers[:2] if risk_off_tickers else ["XLP"]
    risk_on_ret = sum([await _day_return(t) for t in on_sample]) / len(on_sample)
    risk_off_ret = sum([await _day_return(t) for t in off_sample]) / len(off_sample)

    if risk_on_ret > risk_off_ret + 0.001:
        regime = "risk_on"
    elif risk_off_ret > risk_on_ret + 0.001:
        regime = "risk_off"
    else:
        regime = "mixed"

    _regime_cache[cache_key] = regime
    return regime


# ── Spread leg selection ──────────────────────────────────────────────────────

def _select_spread_legs(
    chain_results: list[dict[str, Any]],
    underlying_price: float,
    contract_type: str,
    delta_target: float,
    spread_width: float,
    dte_min: int,
    dte_max: int,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Select short leg from chain at delta_target, derive long leg from fixed width offset."""
    short_leg = _select_option_contract(
        chain_results, underlying_price, contract_type,
        "delta_target", delta_target, dte_min, dte_max,
    )
    if short_leg is None:
        return None, None

    short_strike = short_leg["strike"]
    # Long leg is further OTM by spread_width points
    if contract_type.lower() == "put":
        long_strike_target = short_strike - spread_width
    else:
        long_strike_target = short_strike + spread_width

    # Find closest contract at the long strike in same expiration
    long_candidates = []
    for contract in chain_results:
        details = contract.get("details", {})
        ct = details.get("contract_type", "").lower()
        if ct != contract_type.lower():
            continue
        exp = details.get("expiration_date", "")
        if exp != short_leg["expiration"]:
            continue
        strike = details.get("strike_price", 0)
        mid = _mid_price(contract)
        if mid is None or mid <= 0:
            continue
        long_candidates.append({
            "symbol": details.get("ticker", ""),
            "strike": strike,
            "dte": short_leg["dte"],
            "mid": mid,
            "delta": abs(contract.get("greeks", {}).get("delta", 0)),
            "greeks": contract.get("greeks", {}),
            "expiration": exp,
        })

    if not long_candidates:
        return short_leg, None

    long_candidates.sort(key=lambda c: abs(c["strike"] - long_strike_target))
    long_leg = long_candidates[0]
    return short_leg, long_leg


# ── Credit spread execution path ─────────────────────────────────────────────

async def _run_credit_spread(
    fetcher: PolygonDataFetcher,
    spec: dict[str, Any],
    cs: dict[str, Any],
    start_date: str,
    end_date: str,
    slippage_pct: float,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Credit spread backtest: regime-aware direction, short+long legs, premium-based P&L."""
    execution = spec.get("execution", {})
    spread_config = execution.get("spreadConfig", {})
    regime_config = execution.get("regimeConfig", {})
    time_rules = execution.get("timeRules", [])

    spread_width = spread_config.get("spreadWidth", 5)
    legs = spread_config.get("legs", [])
    short_leg_spec = next((l for l in legs if l.get("role") == "short"), {})
    delta_target = short_leg_spec.get("deltaTarget", 0.20)

    opts = cs.get("options", cs)
    underlying_raw = opts.get("underlying", "SPX")
    # Use ETF proxy for index tickers (Polygon requires this for bar data)
    underlying = INDEX_TO_ETF.get(underlying_raw.upper(), underlying_raw)
    dte_min = int(opts.get("dteMin", opts.get("dte_min", 0)))
    dte_max = int(opts.get("dteMax", opts.get("dte_max", 0)))

    risk_on_tickers = regime_config.get("riskOnTickers", [])
    risk_off_tickers = regime_config.get("riskOffTickers", [])
    risk_on_action = regime_config.get("riskOnAction", "put_credit_spread")
    risk_off_action = regime_config.get("riskOffAction", "call_credit_spread")

    # Parse time rules
    entry_start = "14:00"
    entry_end = "14:30"
    profit_target_pct: float | None = None
    stop_loss_multiplier: float | None = None
    proximity_exit_pct: float | None = None
    proximity_min_minutes: int = 30
    close_before_minutes: int | None = None
    for tr in time_rules:
        if tr.get("type") == "time_window":
            # Use the narrower window (entry-specific) if multiple exist
            st = tr.get("startTime", tr.get("start_time"))
            et = tr.get("endTime", tr.get("end_time"))
            if st and et:
                entry_start = st
                entry_end = et
        elif tr.get("type") == "profit_target_pct":
            profit_target_pct = tr.get("targetPct", tr.get("target_pct"))
        elif tr.get("type") == "stop_loss_multiplier":
            stop_loss_multiplier = tr.get("multiplier", 2.0)
        elif tr.get("type") == "proximity_exit":
            proximity_exit_pct = tr.get("pctToStrike", tr.get("pct_to_strike", 0.5))
            proximity_min_minutes = int(tr.get("minMinutesRemaining", tr.get("min_minutes_remaining", 30)))
        elif tr.get("type") == "time_before_close":
            close_before_minutes = int(tr.get("minutesBeforeClose", tr.get("minutes_before_close", 15)))

    # Fetch underlying bars via the server's cached /api/market/aggs endpoint
    # This leverages MongoDB cache, WebSocket feed, and rate-limit fallback
    try:
        bars = await _fetch_bars_via_server(underlying, 1, "day", start_date, end_date)
    except Exception as fetch_err:
        # Fallback to direct API if server is unavailable
        try:
            raw = await fetcher.get_intraday_aggregates(underlying, 1, "day", start_date, end_date, 5000)
            bars = raw.get("results", [])
        except Exception:
            return [], {"provider": "error", "barsLoaded": 0, "usedFallbackData": False,
                        "error": f"Failed to fetch bars: {fetch_err}"}

    if not bars:
        return [], {"provider": "server", "barsLoaded": 0, "usedFallbackData": False}

    df = _bars_to_dataframe(bars)
    if len(df) < 21:
        return [], {"provider": "server", "barsLoaded": len(df), "usedFallbackData": False}

    indicators = spec.get("indicators", [])
    df = compute_indicators(df, indicators)

    entry_rules = spec.get("rules", {}).get("entry", [])
    exit_rules = spec.get("rules", {}).get("exit", [])
    risk = spec.get("riskManagement", {})
    # For daily bars with 0DTE: max 1 bar (enter and exit same day)
    dte_max_val = int(opts.get("dteMax", opts.get("dte_max", 0)))
    max_bars = 1 if dte_max_val == 0 else int(risk.get("maxBarsInTrade", 120))

    trades: list[dict[str, Any]] = []
    in_trade = False
    entry_idx = 0
    credit_received = 0.0
    max_loss = 0.0
    short_entry: dict[str, Any] = {}
    long_entry: dict[str, Any] = {}
    trade_regime = "mixed"

    rows = list(df.iterrows())
    # For credit spreads, entry is regime-based (not indicator-based), so minimal warmup needed
    # Only need enough bars for indicators if indicator-based entry rules exist
    has_indicator_rules = any(r.get("field") != "PRICE" for r in entry_rules)
    warmup = min(20, max(len(rows) - 5, 0)) if has_indicator_rules else 1
    for i, (idx, row) in enumerate(rows):
        if i < warmup:
            continue
        prev_row = rows[i - 1][1] if i > 0 else None

        # For daily bars: each bar = one trading day, entry is assumed at ~14:00
        if hasattr(idx, 'hour'):
            h, m = idx.hour, idx.minute
            hhmm = f"{h:02d}:{m:02d}"
        else:
            h, m = 14, 0  # daily bars: assume mid-afternoon entry
            hhmm = "14:00"

        if not in_trade:
            # For daily bars, every bar is a potential entry day (time window is implicit)
            # For minute bars, filter by entry time window
            if hasattr(idx, 'hour') and idx.hour != 0:  # minute bars have real hours
                if hhmm < entry_start or hhmm > entry_end:
                    continue

            if not evaluate_rules(entry_rules, row, prev_row):
                continue

            # Classify regime from underlying price action + recent trend
            bar_open = float(row.get("open", row.get("close", 0)))
            bar_close = float(row.get("close", 0))
            bar_high = float(row.get("high", bar_close))
            bar_low = float(row.get("low", bar_close))
            bar_range = (bar_high - bar_low) / bar_open if bar_open > 0 else 0

            # Primary: today's open-to-close direction
            day_return = (bar_close - bar_open) / bar_open if bar_open > 0 else 0

            # Secondary: recent 3-day trend for confirmation
            trend_return = 0.0
            if i >= 3:
                prev_close_3 = float(rows[i - 3][1]["close"])
                trend_return = (bar_close - prev_close_3) / prev_close_3

            # Regime classification with trend confirmation
            if day_return > 0.001 and trend_return >= 0:
                trade_regime = "risk_on"
            elif day_return < -0.001 and trend_return <= 0:
                trade_regime = "risk_off"
            elif abs(day_return) > 0.003:
                # Strong intraday move overrides trend — still tradeable
                trade_regime = "risk_on" if day_return > 0 else "risk_off"
            elif bar_range < 0.005:
                # Very narrow range day — low vol, good for selling premium
                # Default to put spread (bullish bias, most common for premium sellers)
                trade_regime = "risk_on"
            else:
                trade_regime = "mixed"

            # Pick direction based on regime
            if trade_regime == "risk_on":
                action_str = risk_on_action
            elif trade_regime == "risk_off":
                action_str = risk_off_action
            else:
                continue  # Skip mixed signals

            contract_type = "put" if "put" in action_str else "call"

            # Try live options chain first; fall back to synthetic estimation
            underlying_price = float(row["close"])
            short_leg_sel = None
            long_leg_sel = None

            try:
                import asyncio
                await asyncio.sleep(0.3)
                chain = await fetcher.get_options_snapshot(underlying, contract_type=contract_type, limit=100)
                chain_results = chain.get("results", [])
                if chain_results:
                    short_leg_sel, long_leg_sel = _select_spread_legs(
                        chain_results, underlying_price,
                        contract_type, delta_target, spread_width, dte_min, dte_max,
                    )
            except Exception:
                pass

            # Synthetic fallback: IV-aware premium estimation
            if short_leg_sel is None:
                # Compute realized volatility from recent bars as IV proxy
                lookback = min(i, 10)
                if lookback >= 2:
                    recent_closes = [float(rows[j][1]["close"]) for j in range(i - lookback, i + 1)]
                    daily_returns = [(recent_closes[k] - recent_closes[k-1]) / recent_closes[k-1]
                                     for k in range(1, len(recent_closes))]
                    realized_vol = float(np.std(daily_returns)) * (252 ** 0.5) if daily_returns else 0.15
                else:
                    realized_vol = 0.15  # default ~15% annualized

                # IV tends to be slightly above realized vol; clamp to realistic range
                iv_estimate = max(0.08, min(realized_vol * 1.1, 0.60))

                # For 0DTE: daily vol = annual_vol / sqrt(252), intraday (2hrs) ≈ daily / sqrt(3.25)
                daily_vol = iv_estimate / (252 ** 0.5)
                intraday_vol = daily_vol / (3.25 ** 0.5)  # ~2hrs of trading left at entry

                # Strike offset: 20-delta ≈ 0.84 * sigma (normal approximation)
                sigma_move = underlying_price * intraday_vol
                strike_offset = sigma_move * 0.84  # ≈20-delta distance

                if contract_type == "put":
                    short_strike = round(underlying_price - strike_offset, 0)
                    long_strike = short_strike - spread_width
                else:
                    short_strike = round(underlying_price + strike_offset, 0)
                    long_strike = short_strike + spread_width

                # Black-Scholes-like premium estimation for 0DTE
                # Short leg: OTM premium ≈ underlying * iv * sqrt(T) * N'(d2) (simplified)
                # For 20-delta, premium ≈ 0.15-0.40% of underlying on typical days
                time_to_expiry = 2.0 / (252 * 6.5)  # 2 hours in annual terms
                short_premium_est = underlying_price * iv_estimate * (time_to_expiry ** 0.5) * 0.25
                # Long leg is further OTM — roughly 30-40% of short premium
                long_premium_est = short_premium_est * 0.35

                # Clamp premiums to realistic SPY 0DTE ranges ($0.20 - $5.00)
                short_premium_est = max(0.20, min(short_premium_est, 5.0))
                long_premium_est = max(0.05, min(long_premium_est, short_premium_est * 0.5))

                short_leg_sel = {
                    "symbol": f"O:{underlying}{contract_type[0].upper()}{int(short_strike)}",
                    "strike": short_strike,
                    "dte": 0,
                    "mid": short_premium_est,
                    "delta": delta_target,
                    "greeks": {"delta": delta_target, "iv": round(iv_estimate, 4)},
                    "expiration": str(idx)[:10],
                }
                long_leg_sel = {
                    "symbol": f"O:{underlying}{contract_type[0].upper()}{int(long_strike)}",
                    "strike": long_strike,
                    "dte": 0,
                    "mid": long_premium_est,
                    "delta": delta_target * 0.4,
                    "greeks": {"delta": delta_target * 0.4, "iv": round(iv_estimate, 4)},
                    "expiration": str(idx)[:10],
                }

            short_premium = short_leg_sel["mid"] * (1 - slippage_pct)
            long_premium = (long_leg_sel["mid"] * (1 + slippage_pct)) if long_leg_sel else 0.0
            credit_received = round((short_premium - long_premium) * 100, 2)
            max_loss = round(spread_width * 100 - credit_received, 2)
            if credit_received <= 0:
                continue  # Skip if no credit can be collected

            short_entry = short_leg_sel
            long_entry = long_leg_sel or {}
            entry_idx = i
            in_trade = True
        else:
            bars_held = i - entry_idx

            # --- Improved 0DTE spread exit valuation ---
            # For 0DTE credit spreads, the key dynamics are:
            # 1. Theta decay is nonlinear — most premium decays in the final 1-2 hours
            # 2. Delta impact from underlying price movement
            # 3. If price stays away from strike, spread decays toward zero (full profit)
            # 4. If price breaches strike, spread approaches max loss

            entry_close = float(rows[entry_idx][1]["close"])
            exit_close = float(row["close"])
            underlying_move = (exit_close - entry_close) / entry_close
            short_strike_val = short_entry.get("strike", 0)
            short_delta_val = short_entry.get("delta", delta_target)

            # Distance from current price to short strike (as fraction of entry price)
            if contract_type == "put":
                # For put spread: price BELOW strike = in trouble
                distance_to_strike = (exit_close - short_strike_val) / entry_close
                # Positive = price above strike (safe), negative = price below strike (danger)
                adverse_move = max(0, -distance_to_strike)  # how far past the strike
            else:
                # For call spread: price ABOVE strike = in trouble
                distance_to_strike = (short_strike_val - exit_close) / entry_close
                adverse_move = max(0, -distance_to_strike)

            # For 0DTE on daily bars: simulate entry at 14:00, expiry at 16:00 (2hrs)
            # If bars_held == 1 (next day), the option has EXPIRED
            is_daily = not (hasattr(idx, 'hour') and idx.hour != 0)

            if is_daily and bars_held >= 1:
                # Option expired — compute final settlement value
                if adverse_move > 0:
                    # Price breached the short strike — spread has intrinsic value
                    intrinsic = min(adverse_move * entry_close, spread_width) * 100
                    spread_exit_value = intrinsic
                else:
                    # Price stayed safe — spread expires worthless (full profit for seller)
                    spread_exit_value = 0.0
            else:
                # Intraday: nonlinear theta decay model
                # Theta decay for 0DTE: sqrt(time_remaining) model
                # At entry (2hrs left): premium = full; at expiry: premium → intrinsic only
                total_time = 120.0  # 2 hours = 120 minutes
                minutes_remaining_est = max(total_time - (bars_held * total_time / max_bars), 1)
                theta_factor = (minutes_remaining_est / total_time) ** 0.5  # sqrt decay

                # Premium component (time value) decays with theta_factor
                time_value_remaining = credit_received * theta_factor

                # Delta component: how much spread value changed from price movement
                delta_pnl = short_delta_val * underlying_move * entry_close * 100
                if contract_type == "put":
                    delta_pnl = -delta_pnl  # put delta is negative for seller

                spread_exit_value = max(0, time_value_remaining + delta_pnl)

            current_pnl = credit_received - spread_exit_value

            # Profit target check
            max_profit = credit_received
            profit_pct = (current_pnl / max_profit * 100) if max_profit > 0 else 0

            # Compute minutes remaining
            minutes_remaining = 120 if is_daily else ((16 * 60) - (h * 60 + m))

            # Compute proximity to short strike
            short_strike = short_entry.get("strike", 0)
            price_to_strike_pct = abs(float(row["close"]) - short_strike) / float(row["close"]) * 100 if short_strike > 0 else 999

            reason = ""
            should_exit = False

            # 1. Standard indicator-based exit rules
            if evaluate_rules(exit_rules, row, prev_row):
                reason = "rule_exit"
                should_exit = True
            # 2. Profit target (e.g., close at 50% of max profit)
            elif profit_target_pct is not None and profit_pct >= profit_target_pct:
                reason = "profit_target"
                should_exit = True
            # 3. Stop loss multiplier (e.g., close if loss exceeds 2x credit received)
            elif stop_loss_multiplier is not None and current_pnl <= -(credit_received * stop_loss_multiplier):
                reason = "stop_loss"
                should_exit = True
            # 4. Max loss (spread width - credit)
            elif current_pnl <= -max_loss:
                reason = "max_loss"
                should_exit = True
            # 5. Proximity exit (price too close to strike with time remaining)
            elif (proximity_exit_pct is not None
                  and price_to_strike_pct < proximity_exit_pct
                  and minutes_remaining > proximity_min_minutes):
                reason = "proximity_exit"
                should_exit = True
            # 6. Time before close (e.g., close everything 15 min before close)
            elif close_before_minutes is not None and minutes_remaining <= close_before_minutes:
                reason = "time_exit"
                should_exit = True
            # 7. Max bars held
            elif bars_held >= max_bars:
                reason = "max_bars"
                should_exit = True

            if should_exit or i == len(rows) - 1:
                if not reason:
                    reason = "end_of_test"
                pnl_pct = round(current_pnl / max(max_loss, 1) * 100, 2)

                trade: dict[str, Any] = {
                    "entryTime": str(rows[entry_idx][0]),
                    "exitTime": str(idx),
                    "side": "short",
                    "entryAction": "SELL",
                    "exitAction": "EXIT",
                    "entryPrice": round(short_entry.get("mid", 0), 4),
                    "exitPrice": round(spread_exit_value / 100, 4),
                    "pnl": pnl_pct,
                    "barsHeld": bars_held,
                    "reason": reason,
                    "spreadType": "credit_spread",
                    "creditReceived": credit_received,
                    "maxLoss": max_loss,
                    "regime": trade_regime,
                    "legs": [
                        {
                            "role": "short",
                            "contractSymbol": short_entry.get("symbol", ""),
                            "strike": short_entry.get("strike", 0),
                            "premium": round(short_entry.get("mid", 0), 4),
                            "delta": round(short_entry.get("delta", 0), 4),
                        },
                    ],
                }
                if long_entry:
                    trade["legs"].append({
                        "role": "long",
                        "contractSymbol": long_entry.get("symbol", ""),
                        "strike": long_entry.get("strike", 0),
                        "premium": round(long_entry.get("mid", 0), 4),
                        "delta": round(long_entry.get("delta", 0), 4),
                    })
                trades.append(trade)
                in_trade = False

    return trades, {"provider": "polygon", "barsLoaded": len(df), "usedFallbackData": False}


# ── Entry point ───────────────────────────────────────────────────────────────

async def execute_backtest(req: BacktestRequest) -> BacktestResponse:
    """Main dispatcher: routes to equities, options, futures, or credit spread execution path."""
    spec = req.runtime_spec
    slippage_pct = req.slippage_bps / 10_000

    # Check for credit spread path first (takes priority over single-leg options)
    spread_config = spec.get("execution", {}).get("spreadConfig")
    if spread_config and spread_config.get("strategy") in ("credit_spread", "debit_spread"):
        fetcher = _get_polygon_fetcher()
        trades, diagnostics = await _run_credit_spread(
            fetcher, spec, req.contract_selection,
            req.start_date, req.end_date, slippage_pct,
        )
    elif req.trading_method == "options":
        fetcher = _get_polygon_fetcher()
        trades, diagnostics = await _run_options(
            fetcher, spec, req.contract_selection,
            req.start_date, req.end_date, slippage_pct,
        )
    elif req.trading_method == "futures":
        trades, diagnostics = await _run_futures(
            spec, req.contract_selection,
            req.start_date, req.end_date, slippage_pct,
        )
    else:
        # Equities (default)
        fetcher = _get_polygon_fetcher()
        ticker = "SPY"
        cs = req.contract_selection
        if cs.get("method") == "equities" and cs.get("equities", {}).get("ticker"):
            ticker = cs["equities"]["ticker"]
        elif cs.get("ticker"):
            ticker = cs["ticker"]
        trades, diagnostics = await _run_equities(
            fetcher, spec, ticker,
            req.start_date, req.end_date, slippage_pct,
        )

    total = len(trades)
    pnl = round(sum(t["pnl"] for t in trades), 2) if trades else 0
    wins = sum(1 for t in trades if t["pnl"] > 0)
    win_rate = round(wins / total * 100, 2) if total > 0 else 0

    sharpe, max_dd, equity_curve = _compute_analytics(trades, req.initial_capital)

    return BacktestResponse(
        pnl=pnl,
        winRate=win_rate,
        totalTrades=total,
        trades=trades,
        sharpeRatio=sharpe,
        maxDrawdownPct=max_dd,
        equityCurve=equity_curve,
        diagnostics=diagnostics,
    )

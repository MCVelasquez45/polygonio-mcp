import os, math
import pandas as pd
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo
from polygon import RESTClient

ET = ZoneInfo("America/New_York")

def make_client():
    key = os.getenv("POLYGON_API_KEY")
    if not key:
        raise ValueError("POLYGON_API_KEY not found in environment")
    return RESTClient(api_key=key)

def today_et() -> datetime:
    return datetime.now(ET)

def target_expiration_date(days_ahead: int) -> str:
    d = today_et().date() + timedelta(days=days_ahead)
    return d.strftime("%Y-%m-%d")

def minutes_to_close_on(date_str: str) -> float:
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
        close_dt = datetime.combine(d, time(16, 0), tzinfo=ET)
        now = today_et()
        return max(0.0, (close_dt - now).total_seconds() / 60.0)
    except Exception:
        return 0.0

def time_to_expiry_years(date_str: str) -> float:
    mins = minutes_to_close_on(date_str)
    return max(mins / (60 * 24 * 365), 1e-6)

def fetch_chain_snapshot_calls(client, symbol: str, expiration_date: str):
    items = []
    # Note: client.list_snapshot_options_chain is an iterator handling pagination
    for o in client.list_snapshot_options_chain(
        symbol,
        params={
            "contract_type": "call",
            "expiration_date.gte": expiration_date,
            "expiration_date.lte": expiration_date,
        },
    ):
        items.append(o)
    return items

def resolve_spot(chain, client, symbol: str) -> float | None:
    # Try to find underlying price from chain snapshots first
    for o in chain:
        ua = getattr(o, "underlying_asset", None)
        if ua and getattr(ua, "price", None) is not None:
            return ua.price
    # Fallback to last trade
    lt = client.get_last_trade(symbol)
    return getattr(lt, "price", None)

def norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2)))

def midpoint(bid: float | None, ask: float | None) -> float | None:
    if bid is None or ask is None or bid <= 0 or ask <= 0 or ask < bid:
        return None
    return 0.5 * (bid + ask)

def pop_estimate(S0: float, breakeven: float, iv: float | None, t_years: float) -> float | None:
    if iv is None or iv <= 0 or breakeven <= 0 or t_years <= 0:
        return None
    d2 = (math.log(S0 / breakeven) - 0.5 * (iv ** 2) * t_years) / (iv * math.sqrt(t_years))
    return norm_cdf(d2)

def find_best_options_calls(client, params) -> list:
    """
    Main logic function adapted from the CLI tool.
    Returns a list of dictionaries (Opportunities).
    """
    exp = target_expiration_date(params.expiration_days)
    chain = fetch_chain_snapshot_calls(client, params.symbol, exp)
    
    if not chain:
        return []

    spot = resolve_spot(chain, client, params.symbol)
    if spot is None:
        raise ValueError(f"Could not resolve spot price for {params.symbol}")

    lo = spot * (1 + params.min_otm_pct)
    hi = spot * (1 + params.max_otm_pct) if params.max_otm_pct else float("inf")
    t_years = time_to_expiry_years(exp)

    results = []
    for o in chain:
        d = getattr(o, "details", None)
        q = getattr(o, "last_quote", None)
        g = getattr(o, "greeks", None)
        oi = getattr(o, "open_interest", 0) or 0
        iv = getattr(o, "implied_volatility", None)

        if not d or not q:
            continue

        k = d.strike_price
        if k is None or not (k >= lo and k <= hi):
            continue

        bid, ask = q.bid, q.ask
        if bid is None or ask is None or bid < params.min_bid:
            continue

        m = midpoint(bid, ask)
        if m is None or m <= 0:
            continue

        spread = ask - bid
        if m > 0 and (spread / m) > params.max_spread_to_mid:
            continue

        delta_ok = True
        delta_val = None
        if g and getattr(g, "delta", None) is not None:
            delta_val = abs(g.delta)
            delta_ok = (params.delta_lo <= delta_val <= params.delta_hi)
        if not delta_ok:
            continue

        breakeven = spot - m
        max_profit = (k - spot) + m
        pop = pop_estimate(spot, breakeven, iv, t_years)

        # Convert to Pydantic-friendly dict
        results.append({
            "ticker": d.ticker,
            "expiration": d.expiration_date,
            "strike": k,
            "delta": delta_val,
            "bid": bid,
            "ask": ask,
            "mid": m,
            "open_interest": oi,
            "iv": iv,
            "spot": spot,
            "premium_yield": m / spot,
            "breakeven": breakeven,
            "max_profit": max_profit,
            "pop_est": pop,
        })

    # Sorting
    metric = params.rank_metric
    if metric == "premium_yield":
        results.sort(key=lambda r: r["premium_yield"], reverse=True)
    elif metric == "max_profit":
        results.sort(key=lambda r: r["max_profit"], reverse=True)
    elif metric == "pop_est":
        results.sort(key=lambda r: (r["pop_est"] or 0), reverse=True)
    
    return results

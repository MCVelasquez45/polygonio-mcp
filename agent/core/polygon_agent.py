"""Shared Polygon market analysis agent logic for CLI and API entrypoints."""

from __future__ import annotations

import os
import uuid
import re
import json
from datetime import datetime, timedelta
from pathlib import Path
from textwrap import dedent
from typing import Any, Dict, List, Optional

import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from pydantic import BaseModel

from agents import (
    Agent,
    AsyncOpenAI,
    GuardrailFunctionOutput,
    InputGuardrail,
    ModelSettings,
    RunConfig,
    Runner,
    SQLiteSession,
    function_tool,
    trace,
)
from agents.exceptions import InputGuardrailTripwireTriggered
from agents.models.openai_responses import OpenAIResponsesModel
from agents.mcp import MCPServerStdio

load_dotenv()

POLYGON_BASE_URL = "https://api.polygon.io"
CAPITOL_TRADES_URL = "https://www.capitoltrades.com/trades"
DEFAULT_TRACE_LABEL = "Polygon.io Demo"
# Disable history replay by default until the OpenAI Responses API exposes a safe way
# to trim reasoning/function_call pairs without corrupting the transcript.
DEFAULT_SESSION_HISTORY_LIMIT = 0
PROJECT_ROOT = Path(__file__).resolve().parent.parent
_GUARDRAIL_PASSED_SESSIONS: set[str] = set()

_history_limit_env = os.getenv("FINANCE_AGENT_HISTORY_LIMIT")
try:
    SESSION_HISTORY_LIMIT = max(
        0,
        int(_history_limit_env) if _history_limit_env is not None else DEFAULT_SESSION_HISTORY_LIMIT,
    )
except ValueError:
    SESSION_HISTORY_LIMIT = DEFAULT_SESSION_HISTORY_LIMIT


def _resolve_local_path(env_var: str, default_relative: str) -> Path:
    """Resolve an optional env override for local-only artifacts."""
    raw_value = (os.getenv(env_var) or "").strip()
    candidate = raw_value or default_relative
    path = Path(candidate).expanduser()
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path


def _session_history_input_callback(
    history: List[Any],
    new_input: List[Any],
) -> List[Any]:
    """Limit how many prior turns we send back to the model each run."""
    limit = SESSION_HISTORY_LIMIT
    if limit <= 0:
        return new_input

    if len(history) > limit:
        trimmed_history = history[-limit:]
    else:
        trimmed_history = history

    return trimmed_history + new_input


def _session_guardrail_key(session: SQLiteSession | None) -> str | None:
    """Normalize a cache key for tracking guardrail completion per session."""
    if session is None:
        return None
    session_id = getattr(session, "session_id", None)
    if isinstance(session_id, str) and session_id:
        return f"id:{session_id}"
    session_name = getattr(session, "session_name", None)
    if isinstance(session_name, str) and session_name:
        return f"name:{session_name}"
    return f"obj:{id(session)}"


def _with_context(query: str, context: Dict[str, Any] | None) -> str:
    """Append dashboard context to the user query when provided."""
    formatting = _formatting_guardrails()
    if not context:
        return f"{formatting}\n\nUser question: {query}"
    try:
        context_blob = json.dumps(context, ensure_ascii=True)
    except TypeError:
        context_blob = json.dumps(context, ensure_ascii=True, default=str)
    prefix = dedent(
        f"""\
        {formatting}

        DASHBOARD CONTEXT (JSON):
        {context_blob}
        """
    ).strip()
    return f"{prefix}\n\nUser question: {query}"


def _formatting_guardrails() -> str:
    """Instruction block to keep responses structured and readable in the UI."""
    return dedent(
        """\
        RESPONSE FORMAT:
        - Start with **Summary:** (1-2 sentences)
        - Then 3-6 bullet points for key data/reasons
        - End with **Conclusion:** (1 short sentence)
        - Expand acronyms at least once (e.g., IV = implied volatility)
        - Keep the tone concise and trader-friendly
        """
    ).strip()


async def _fetch_capitol_trades_html() -> str:
    """Download the Capitol Trades HTML page."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(CAPITOL_TRADES_URL, headers=headers)
        response.raise_for_status()
        return response.text


def _parse_capitol_trades(html: str) -> List[Dict[str, str]]:
    """Extract trade rows from the Capitol Trades HTML."""
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.select(".TradeTable__Row")
    trades: List[Dict[str, str]] = []

    for row in rows:
        cells = row.find_all("td")
        if not cells:
            continue

        def _cell(idx: int) -> str:
            if idx >= len(cells):
                return ""
            return cells[idx].get_text(strip=True)

        trade = {
            "date": _cell(0),
            "member": _cell(1),
            "asset": _cell(2),
            "type": _cell(3),
            "amount": _cell(4),
        }
        if any(trade.values()):
            trades.append(trade)

    return trades


class FinanceOutput(BaseModel):
    """Structured result from the guardrail check."""

    is_about_finance: bool
    reasoning: str


@function_tool
async def save_analysis_report(content: str, title: str = None, category: str = "general") -> str:
    """Persist a Markdown report to `reports/<timestamp>_<title>.md`."""
    reports_dir = _resolve_local_path("FINANCE_AGENT_REPORTS_DIR", "reports")
    reports_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    title = title or f"analysis_{timestamp}"
    safe_title = re.sub(r"[^\w\s-]", "", title).replace(" ", "_")
    filepath = reports_dir / f"{timestamp}_{safe_title}.md"

    report_body = (
        dedent(
            f"""\
            # {title}

            **Generated:** {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
            **Category:** {category}

            ---

            {content}

            ---
            *Report generated by Market Analysis Agent*
            """
        ).strip()
        + "\n"
    )

    filepath.write_text(report_body, encoding="utf-8")
    return f"Report saved: {filepath}"


def _require_env(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise RuntimeError(f"{key} not set in environment.")
    return value


def _midpoint(bid: Optional[float], ask: Optional[float]) -> Optional[float]:
    if bid is None or ask is None:
        return None
    if bid <= 0 or ask <= 0 or ask < bid:
        return None
    return round((bid + ask) / 2.0, 4)


class PolygonDataFetcher:
    """Helper for interacting with Polygon.io endpoints our account can access."""

    def __init__(self, api_key: str, base_url: str = POLYGON_BASE_URL, timeout: float = 20.0):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    async def get(self, endpoint: str, params: Dict[str, Any] | None = None) -> Dict[str, Any]:
        params = dict(params or {})
        params["apiKey"] = self.api_key
        url = f"{self.base_url}{endpoint}"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            return response.json()

    async def get_options_snapshot(
        self,
        ticker: str,
        expiration_date: str | None = None,
        contract_type: str | None = None,
        limit: int = 25,
        sort: str | None = "ticker",
        order: str | None = "asc",
    ) -> Dict[str, Any]:
        normalized_contract_type = (contract_type or "").lower()
        if normalized_contract_type not in {"call", "put"}:
            normalized_contract_type = None

        base_params: Dict[str, Any] = {
            "limit": max(1, min(limit, 250)),
        }
        if expiration_date:
            base_params["expiration_date"] = expiration_date
        if normalized_contract_type:
            base_params["contract_type"] = normalized_contract_type
        if sort:
            base_params["sort"] = sort
        if order:
            base_params["order"] = order

        endpoint = f"/v3/snapshot/options/{ticker.upper()}"
        applied_sort = base_params.get("sort") or "ticker"
        fallback_used = False

        async def _fetch(params: Dict[str, Any]) -> Dict[str, Any]:
            return await self.get(endpoint, params)

        async def _fallback_for_bad_request() -> List[Dict[str, Any]] | None:
            nonlocal applied_sort, fallback_used

            # First fallback: retry with a safe sort field (`ticker`) if the caller asked for something else.
            if base_params.get("sort") and base_params.get("sort") != "ticker":
                params_ticker = dict(base_params)
                params_ticker["sort"] = "ticker"
                try:
                    payload_retry = await _fetch(params_ticker)
                    applied_sort = "ticker"
                    fallback_used = True
                    return [payload_retry]
                except httpx.HTTPStatusError as retry_exc:
                    if retry_exc.response.status_code != 400:
                        raise
                    # continue to next fallback

            # Second fallback: if we were trying to pull the entire chain, request calls/puts separately.
            if normalized_contract_type is None:
                payloads: List[Dict[str, Any]] = []
                for ctype in ("call", "put"):
                    params_split = dict(base_params)
                    params_split["contract_type"] = ctype
                    params_split["sort"] = "ticker"
                    try:
                        payloads.append(await _fetch(params_split))
                    except httpx.HTTPStatusError as split_exc:
                        if split_exc.response.status_code == 400 and ctype == "put" and payloads:
                            # If we at least received calls, surface those.
                            break
                        raise

                if payloads:
                    applied_sort = "ticker"
                    fallback_used = True
                    return payloads

            return None

        try:
            payloads: List[Dict[str, Any]] = [await _fetch(base_params)]
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 400:
                raise
            fallback_payloads = await _fallback_for_bad_request()
            if not fallback_payloads:
                raise
            payloads = fallback_payloads

        combined_results: List[Dict[str, Any]] = []
        total_query_count = 0
        status: Optional[str] = None

        for payload in payloads:
            status = status or payload.get("status")
            query_count = payload.get("queryCount")
            if isinstance(query_count, int):
                total_query_count += query_count

            for option in payload.get("results", []):
                details = option.get("details") or {}
                greeks = option.get("greeks") or {}
                last_quote = option.get("last_quote") or {}
                day = option.get("day") or {}

                combined_results.append(
                    {
                        "contract": details.get("ticker"),
                        "expiration": details.get("expiration_date"),
                        "strike": details.get("strike_price"),
                        "contract_type": details.get("contract_type"),
                        "exercise_style": details.get("exercise_style"),
                        "change_percent": day.get("change_percent"),
                        "open_interest": option.get("open_interest"),
                        "implied_volatility": option.get("implied_volatility"),
                        "volume": day.get("volume"),
                        "bid": last_quote.get("bid"),
                        "ask": last_quote.get("ask"),
                        "mid": _midpoint(last_quote.get("bid"), last_quote.get("ask")),
                        "delta": greeks.get("delta"),
                        "gamma": greeks.get("gamma"),
                        "theta": greeks.get("theta"),
                        "vega": greeks.get("vega"),
                        "rho": greeks.get("rho"),
                    }
                )

        combined_results.sort(key=lambda item: (item.get("contract") or ""))
        if limit > 0:
            combined_results = combined_results[: max(1, min(limit, len(combined_results)))]

        return {
            "underlying": ticker.upper(),
            "query_count": total_query_count or None,
            "status": status,
            "results_count": len(combined_results),
            "options": combined_results,
            "applied_sort": applied_sort,
            "fallback_used": fallback_used,
        }

    async def get_option_contract_snapshot(self, underlying: str, contract: str) -> Dict[str, Any]:
        payload = await self.get(f"/v3/snapshot/options/{underlying.upper()}/{contract}")
        result = payload.get("results") or {}
        details = result.get("details") or {}
        greeks = result.get("greeks") or {}
        quote = result.get("last_quote") or {}
        trade = result.get("last_trade") or {}
        day = result.get("day") or {}

        return {
            "contract": details.get("ticker"),
            "underlying": underlying.upper(),
            "expiration": details.get("expiration_date"),
            "strike": details.get("strike_price"),
            "contract_type": details.get("contract_type"),
            "exercise_style": details.get("exercise_style"),
            "implied_volatility": result.get("implied_volatility"),
            "open_interest": result.get("open_interest"),
            "day": {
                "change": day.get("change"),
                "change_percent": day.get("change_percent"),
                "volume": day.get("volume"),
                "vwap": day.get("vwap"),
            },
            "last_quote": {
                "bid": quote.get("bid"),
                "ask": quote.get("ask"),
                "mid": _midpoint(quote.get("bid"), quote.get("ask")),
                "bid_size": quote.get("bid_size"),
                "ask_size": quote.get("ask_size"),
                "timestamp": quote.get("timestamp"),
            },
            "last_trade": {
                "price": trade.get("price"),
                "size": trade.get("size"),
                "exchange": trade.get("exchange"),
                "timestamp": trade.get("timestamp"),
            },
            "greeks": greeks,
        }

    async def get_option_quotes(self, option_ticker: str, limit: int = 500) -> Dict[str, Any]:
        payload = await self.get(
            f"/v3/quotes/{option_ticker}",
            {
                "limit": max(1, min(limit, 5000)),
                "sort": "timestamp",
                "order": "desc",
            },
        )
        return {
            "contract": option_ticker,
            "status": payload.get("status"),
            "query_count": payload.get("queryCount"),
            "results_count": payload.get("resultsCount"),
            "results": payload.get("results", []),
            "next_url": payload.get("next_url"),
        }

    async def get_option_trades(self, option_ticker: str, limit: int = 500) -> Dict[str, Any]:
        payload = await self.get(
            f"/v3/trades/{option_ticker}",
            {
                "limit": max(1, min(limit, 5000)),
                "sort": "timestamp",
                "order": "desc",
            },
        )
        return {
            "contract": option_ticker,
            "status": payload.get("status"),
            "query_count": payload.get("queryCount"),
            "results_count": payload.get("resultsCount"),
            "results": payload.get("results", []),
            "next_url": payload.get("next_url"),
        }

    async def get_intraday_aggregates(
        self,
        ticker: str,
        multiplier: int,
        timespan: str,
        from_date: str,
        to_date: str,
        limit: int,
        adjusted: bool = True,
    ) -> Dict[str, Any]:
        payload = await self.get(
            f"/v2/aggs/ticker/{ticker.upper()}/range/{multiplier}/{timespan}/{from_date}/{to_date}",
            {
                "adjusted": adjusted,
                "sort": "asc",
                "limit": max(1, min(limit, 50000)),
            },
        )
        return {
            "ticker": ticker.upper(),
            "status": payload.get("status"),
            "results_count": payload.get("resultsCount"),
            "results": payload.get("results", []),
        }

    async def get_exchanges(self, asset_class: str = "options", locale: str = "us") -> Dict[str, Any]:
        payload = await self.get(
            "/v3/reference/exchanges",
            {"asset_class": asset_class, "locale": locale},
        )
        results = payload.get("results", [])
        return {
            "status": payload.get("status"),
            "results_count": payload.get("resultsCount") or len(results),
            "results": results,
            "asset_class": asset_class,
            "locale": locale,
        }

    async def get_dividends(self, ticker: str, limit: int = 20) -> Dict[str, Any]:
        payload = await self.get(
            "/v3/reference/dividends",
            {
                "ticker": ticker.upper(),
                "limit": max(1, min(limit, 100)),
                "order": "desc",
                "sort": "pay_date",
            },
        )
        return {
            "ticker": ticker.upper(),
            "status": payload.get("status"),
            "results_count": payload.get("resultsCount"),
            "results": payload.get("results", []),
            "next_url": payload.get("next_url"),
        }

    async def get_earnings(self, ticker: str, limit: int = 20) -> Dict[str, Any]:
        payload = await self.get(
            "/vX/reference/financials",
            {
                "ticker": ticker.upper(),
                "type": "Q",
                "limit": max(1, min(limit, 100)),
                "sort": "-fiscal_period",
            },
        )
        return {
            "ticker": ticker.upper(),
            "status": payload.get("status"),
            "results_count": payload.get("resultsCount"),
            "results": payload.get("results", []),
            "next_url": payload.get("next_url"),
        }

    async def get_financials(
        self,
        ticker: str,
        limit: int = 5,
        timeframe: str | None = "quarterly",
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "ticker": ticker.upper(),
            "limit": max(1, min(limit, 20)),
            "sort": "-fiscal_period",
        }
        if timeframe:
            params["timeframe"] = timeframe

        payload = await self.get("/vX/reference/financials", params)
        return {
            "ticker": ticker.upper(),
            "status": payload.get("status"),
            "results_count": payload.get("resultsCount"),
            "results": payload.get("results", []),
            "next_url": payload.get("next_url"),
        }

    async def get_ticker_sentiment(
        self,
        ticker: str,
        limit: int = 10,
        order: str = "asc",
        sort: str = "published_utc",
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "order": order,
            "limit": max(1, min(limit, 100)),
            "sort": sort,
        }
        if ticker:
            params["ticker"] = ticker.upper()

        payload = await self.get("/v2/reference/news", params)
        articles = []
        for article in payload.get("results", []):
            publisher = article.get("publisher") or {}
            articles.append(
                {
                    "id": article.get("id"),
                    "title": article.get("title"),
                    "published_utc": article.get("published_utc"),
                    "tickers": article.get("tickers"),
                    "description": article.get("description"),
                    "article_url": article.get("article_url"),
                    "amp_url": article.get("amp_url"),
                    "keywords": article.get("keywords"),
                    "publisher_name": publisher.get("name"),
                }
            )

        results_count = payload.get("resultsCount") or payload.get("count") or len(articles)
        return {
            "ticker": ticker.upper(),
            "status": payload.get("status"),
            "results_count": results_count,
            "articles": articles,
            "next_url": payload.get("next_url"),
        }


_polygon_fetcher: PolygonDataFetcher | None = None


def _get_polygon_fetcher() -> PolygonDataFetcher:
    global _polygon_fetcher
    if _polygon_fetcher is None:
        api_key = _require_env("POLYGON_API_KEY")
        _polygon_fetcher = PolygonDataFetcher(api_key=api_key)
    return _polygon_fetcher


@function_tool
async def get_polygon_options_snapshot(
    ticker: str,
    expiration_date: str | None = None,
    contract_type: str | None = None,
    limit: int = 25,
    sort: str | None = "ticker",
    order: str | None = "asc",
) -> Dict[str, Any]:
    """Fetch snapshot data for an underlying's option contracts."""
    fetcher = _get_polygon_fetcher()
    return await fetcher.get_options_snapshot(ticker, expiration_date, contract_type, limit, sort, order)


@function_tool
async def get_polygon_option_contract_snapshot(underlying: str, contract: str) -> Dict[str, Any]:
    """Fetch detailed snapshot for a specific option contract."""
    fetcher = _get_polygon_fetcher()
    return await fetcher.get_option_contract_snapshot(underlying, contract)


@function_tool
async def get_polygon_ticker_sentiment(
    ticker: str,
    limit: int = 10,
    order: str = "asc",
    sort: str = "published_utc",
) -> Dict[str, Any]:
    """Retrieve recent Polygon.io news articles for a ticker."""
    fetcher = _get_polygon_fetcher()
    return await fetcher.get_ticker_sentiment(ticker, limit, order, sort)


@function_tool
async def get_fred_series(
    series_id: str,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 120,
) -> Dict[str, Any]:
    """Fetch macroeconomic series data from the Federal Reserve (FRED)."""
    fred_key = _require_env("FRED_API_KEY")
    params = {
        "series_id": series_id,
        "api_key": fred_key,
        "file_type": "json",
        "sort_order": "asc",
        "limit": max(1, min(limit, 1000)),
    }
    if start_date:
        params["observation_start"] = start_date
    if end_date:
        params["observation_end"] = end_date

    url = "https://api.stlouisfed.org/fred/series/observations"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()

    observations = payload.get("observations", [])
    valid_values = [obs for obs in observations if obs.get("value") not in (None, "", ".")]

    latest = valid_values[-1] if valid_values else None
    previous = valid_values[-2] if len(valid_values) > 1 else None

    def _to_float(value: Optional[str]) -> Optional[float]:
        if value in (None, "", "."):
            return None
        try:
            return float(value)
        except ValueError:
            return None

    latest_value = _to_float(latest.get("value")) if latest else None
    previous_value = _to_float(previous.get("value")) if previous else None
    change = None
    if latest_value is not None and previous_value is not None:
        change = latest_value - previous_value

    return {
        "series_id": series_id,
        "observations": valid_values,
        "latest": latest,
        "latest_value": latest_value,
        "previous": previous,
        "change": change,
        "units": payload.get("units"),
        "frequency": payload.get("frequency"),
        "notes": payload.get("notes"),
    }


async def _fred_release_dates(
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 25,
    sort_order: str = "asc",
) -> Dict[str, Any]:
    fred_key = _require_env("FRED_API_KEY")
    if start_date is None:
        start_date = datetime.utcnow().strftime("%Y-%m-%d")
    if end_date is None:
        end_date = (datetime.utcnow() + timedelta(days=45)).strftime("%Y-%m-%d")

    params = {
        "api_key": fred_key,
        "file_type": "json",
        "limit": max(1, min(limit, 500)),
        "sort_order": sort_order,
        "include_release_dates_with_no_data": "false",
        "include_release_child_series": "false",
        "realtime_start": start_date,
        "realtime_end": end_date,
        "offset": 0,
    }

    url = "https://api.stlouisfed.org/fred/releases/dates"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()

    releases = payload.get("release_dates", [])
    normalized = []
    for entry in releases:
        normalized.append(
            {
                "release_id": entry.get("release_id"),
                "release_name": entry.get("release_name"),
                "date": entry.get("date"),
                "last_updated": entry.get("release_last_updated"),
            }
        )

    return {
        "status": "ok",
        "count": len(normalized),
        "start_date": start_date,
        "end_date": end_date,
        "releases": normalized[:limit],
    }


@function_tool
async def get_fred_release_calendar(
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int = 25,
    sort_order: str = "asc",
) -> Dict[str, Any]:
    """Retrieve upcoming macroeconomic releases from FRED."""
    return await _fred_release_dates(start_date, end_date, limit, sort_order)


@function_tool
async def get_polygon_option_quotes(option_ticker: str, limit: int = 500) -> Dict[str, Any]:
    """Retrieve NBBO quotes for an option contract."""
    fetcher = _get_polygon_fetcher()
    return await fetcher.get_option_quotes(option_ticker, limit)


@function_tool
async def get_polygon_option_trades(option_ticker: str, limit: int = 500) -> Dict[str, Any]:
    """Retrieve recent prints for an option contract."""
    fetcher = _get_polygon_fetcher()
    return await fetcher.get_option_trades(option_ticker, limit)


@function_tool
async def get_polygon_intraday_aggregates(
    ticker: str,
    date: str,
    multiplier: int = 1,
    timespan: str = "minute",
    limit: int = 500,
    end_date: str | None = None,
) -> Dict[str, Any]:
    """Retrieve intraday aggregates for a given trading day or range."""
    fetcher = _get_polygon_fetcher()
    to_date = end_date or date
    return await fetcher.get_intraday_aggregates(ticker, multiplier, timespan, date, to_date, limit)


@function_tool
async def get_polygon_exchanges(asset_class: str = "options", locale: str = "us") -> Dict[str, Any]:
    """List Polygon exchanges available for the supplied asset class."""
    fetcher = _get_polygon_fetcher()
    return await fetcher.get_exchanges(asset_class, locale)


@function_tool
async def get_polygon_earnings(ticker: str, limit: int = 20) -> Dict[str, Any]:
    """Fetch quarterly earnings data backed by Polygon financials."""
    fetcher = _get_polygon_fetcher()
    return await fetcher.get_earnings(ticker, limit)


@function_tool
async def get_polygon_dividends(ticker: str, limit: int = 20) -> Dict[str, Any]:
    """Fetch dividend history for a ticker."""
    fetcher = _get_polygon_fetcher()
    return await fetcher.get_dividends(ticker, limit)


@function_tool
async def get_polygon_financials(
    ticker: str,
    limit: int = 5,
    timeframe: str | None = "quarterly",
) -> Dict[str, Any]:
    """Retrieve detailed company financials."""
    fetcher = _get_polygon_fetcher()
    return await fetcher.get_financials(ticker, limit, timeframe)


@function_tool
async def get_capitol_trades(n: int = 10) -> Dict[str, Any]:
    """Fetch recent congressional trades scraped from Capitol Trades."""
    limit = max(1, min(int(n), 50))
    try:
        html = await _fetch_capitol_trades_html()
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Failed to download Capitol Trades page: {exc}") from exc

    trades = _parse_capitol_trades(html)
    return {"trades": trades[:limit]}


guardrail_agent = Agent(
    name="Guardrail check",
    instructions=(
        "Classify if the user query is finance-related.\n"
        "Include: stocks, ETFs, crypto, forex, market news, fundamentals, economic indicators, ROI calcs, corporate actions.\n"
        "Exclude: non-financial topics (cooking, general trivia, unrelated tech).\n"
        "Disambiguate: if term (e.g., Apple, Tesla) could be both, check for finance context words (price, market, earnings, shares). If unclear, return non-finance.\n"
        "Output: is_about_finance: bool, reasoning: brief why/why not."
    ),
    output_type=FinanceOutput,
)


async def finance_guardrail(context, agent, input_data):
    """Validate that the prompt is finance-related before running the agent."""
    result = await Runner.run(guardrail_agent, input_data, context=context)
    final_output = result.final_output_as(FinanceOutput)
    return GuardrailFunctionOutput(
        output_info=final_output,
        tripwire_triggered=not final_output.is_about_finance,
    )


def create_polygon_mcp_server() -> MCPServerStdio:
    """Create a stdio MCP server instance configured with POLYGON_API_KEY."""
    api_key = os.getenv("POLYGON_API_KEY")
    if not api_key:
        raise Exception("POLYGON_API_KEY not set in environment.")

    return MCPServerStdio(
        params={
            "command": "uvx",
            "args": ["--from", "git+https://github.com/polygon-io/mcp_polygon@v0.4.0", "mcp_polygon"],
            "env": {**os.environ, "POLYGON_API_KEY": api_key},
        },
        # First-time `uvx` installs can exceed the 5s default; give the MCP
        # server more time to start/respond before declaring failure.
        client_session_timeout_seconds=30,
    )


def create_financial_analysis_agent(server: MCPServerStdio, *, enforce_guardrail: bool = True) -> Agent:
    """Instantiate the financial analysis agent bound to the provided MCP server.

    The finance guardrail is enforced on the first turn of a session to keep the
    agent scoped to market analysis, but subsequent turns can skip it for smoother
    follow-up questions once intent is established.
    """
    return Agent(
        name="Financial Analysis Agent",
        instructions=(
            "Financial analysis agent. Steps:\n"
            "1. Verify finance-related using guardrail\n"
            "2. Call Polygon tools precisely; pull the minimal required data.\n"
            "3. Include disclaimers.\n"
            "4. Offer to save reports if not asked by the user to save a report.\n\n"
            "RULES:\n"
            "Double-check math; limit news to ≤3 articles/ticker in date range.\n"
            "If the user asks to save a report, save it to the reports folder using the save_analysis_report tool.\n"
            "When using any polygon.io data tools, be mindful of how much data you pull based on the users input to minimize context being exceeded.\n"
            "If data unavailable or tool fails, explain gracefully — never fabricate.\n"
            "TOOLS:\n"
            "Polygon.io data, save_analysis_report, get_polygon_options_snapshot,\n"
            "get_polygon_option_contract_snapshot, get_polygon_option_quotes,\n"
            "get_polygon_option_trades, get_polygon_intraday_aggregates,\n"
            "get_polygon_exchanges, get_polygon_ticker_sentiment,\n"
            "get_polygon_earnings, get_polygon_dividends, get_polygon_financials,\n"
            "get_capitol_trades, get_fred_series, get_fred_release_calendar\n"
            "Disclaimer: Not financial advice. For informational purposes only."
        ),
        mcp_servers=[server],
        tools=[
            save_analysis_report,
            get_polygon_options_snapshot,
            get_polygon_option_contract_snapshot,
            get_polygon_option_quotes,
            get_polygon_option_trades,
            get_polygon_intraday_aggregates,
            get_polygon_exchanges,
            get_polygon_ticker_sentiment,
            get_polygon_dividends,
            get_polygon_earnings,
            get_polygon_financials,
            get_capitol_trades,
            get_fred_series,
            get_fred_release_calendar,
        ],
        input_guardrails=[InputGuardrail(guardrail_function=finance_guardrail)] if enforce_guardrail else [],
        model=OpenAIResponsesModel(model="gpt-5", openai_client=AsyncOpenAI()),
        model_settings=ModelSettings(truncation="auto"),
    )


async def run_analysis(
    query: str,
    session: SQLiteSession | None = None,
    server: MCPServerStdio | None = None,
    session_name: str | None = None,
    context: Dict[str, Any] | None = None,
    trace_label: str = DEFAULT_TRACE_LABEL,
):
    """Execute the financial analysis agent for a single query."""
    session_obj = session
    if session_obj is None:
        session_label = session_name or f"analysis_{uuid.uuid4().hex}"
        session_obj = SQLiteSession(session_label)

    server_obj = server or create_polygon_mcp_server()
    session_key = _session_guardrail_key(session_obj)
    enforce_guardrail = session_key is None or session_key not in _GUARDRAIL_PASSED_SESSIONS
    agent = create_financial_analysis_agent(server_obj, enforce_guardrail=enforce_guardrail)

    run_config = RunConfig(session_input_callback=_session_history_input_callback) if session_obj else None

    async def _execute():
        with trace(trace_label):
            return await Runner.run(
                agent,
                _with_context(query, context),
                session=session_obj,
                run_config=run_config,
                max_turns=32,
            )

    async def _tracked_execute():
        result = await _execute()
        if session_key and enforce_guardrail:
            _GUARDRAIL_PASSED_SESSIONS.add(session_key)
        return result

    if server is None:
        async with server_obj:
            return await _tracked_execute()
    return await _tracked_execute()


__all__ = [
    "FinanceOutput",
    "PolygonDataFetcher",
    "POLYGON_BASE_URL",
    "DEFAULT_TRACE_LABEL",
    "create_financial_analysis_agent",
    "create_polygon_mcp_server",
    "finance_guardrail",
    "run_analysis",
    # tool functions
    "save_analysis_report",
    "get_polygon_options_snapshot",
    "get_polygon_option_contract_snapshot",
    "get_polygon_ticker_sentiment",
    "get_fred_series",
    "get_fred_release_calendar",
    "get_polygon_option_quotes",
    "get_polygon_option_trades",
    "get_polygon_intraday_aggregates",
    "get_polygon_exchanges",
    "get_polygon_earnings",
    "get_polygon_dividends",
    "get_polygon_financials",
    "get_capitol_trades",
    # helper
    "InputGuardrailTripwireTriggered",
]

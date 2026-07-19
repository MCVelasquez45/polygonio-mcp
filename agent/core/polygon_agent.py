"""Shared Polygon market analysis agent logic for CLI and API entrypoints."""

from __future__ import annotations

import json
import os
import re
import sys
import uuid
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
from core.algo import MarketLeaderboard

load_dotenv()

POLYGON_BASE_URL = os.getenv("MASSIVE_BASE_URL") or os.getenv("POLYGON_BASE_URL") or "https://api.polygon.io"
CAPITOL_TRADES_URL = "https://www.capitoltrades.com/trades"
CAPITOL_TRADES_BFF_URL = "https://bff.capitoltrades.com"
QUANDL_BASE_URL = "https://data.nasdaq.com/api/v3"
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


def _capitol_trades_headers(accept: str) -> Dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
        ),
        "Accept": accept,
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://www.capitoltrades.com",
        "Referer": "https://www.capitoltrades.com/trades",
    }


async def _fetch_capitol_trades_html(url: str = CAPITOL_TRADES_URL) -> str:
    """Download the Capitol Trades HTML page."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url, headers=_capitol_trades_headers("text/html"))
        response.raise_for_status()
        return response.text


def _parse_capitol_trades_table(html: str) -> List[Dict[str, str]]:
    """Extract trade rows from a fallback HTML table (legacy layout)."""
    soup = BeautifulSoup(html, "html.parser")
    rows = soup.select(".TradeTable__Row")
    if not rows:
        rows = soup.select("table tbody tr")
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


def _extract_capitol_trades_payload(html: str) -> str:
    pattern = re.compile(r'self\\.__next_f\\.push\\(\\[1,\"(.*?)\"\\]\\)', re.S)
    payloads = pattern.findall(html)
    return "\n".join(payloads)


def _parse_capitol_trades_payload(html: str) -> List[Dict[str, Any]]:
    """Extract trade rows from Next.js flight payloads embedded in HTML."""
    payload = _extract_capitol_trades_payload(html)
    if not payload:
        return []

    tx_index = payload.find("_txId")
    if tx_index == -1:
        return []

    data_marker = '\\"data\\":['
    data_index = payload.rfind(data_marker, 0, tx_index)
    if data_index == -1:
        return []

    start = data_index + len('\\"data\\":')
    bracket = 0
    end = None
    for i in range(start, len(payload)):
        ch = payload[i]
        if ch == "[":
            bracket += 1
        elif ch == "]":
            bracket -= 1
            if bracket == 0:
                end = i + 1
                break
    if end is None:
        return []

    array_str = payload[start:end]
    array_str = array_str.encode("utf-8").decode("unicode_escape")
    try:
        raw_trades = json.loads(array_str)
    except json.JSONDecodeError:
        return []

    trades: List[Dict[str, Any]] = []
    for trade in raw_trades:
        politician = trade.get("politician") or {}
        issuer = trade.get("issuer") or {}
        member = " ".join(
            part for part in [politician.get("firstName"), politician.get("lastName")] if part
        ).strip()
        trades.append(
            {
                "date": trade.get("txDate") or trade.get("pubDate"),
                "member": member or None,
                "asset": issuer.get("issuerTicker") or issuer.get("issuerName"),
                "type": trade.get("txTypeExtended") or trade.get("txType"),
                "amount": trade.get("value"),
                "price": trade.get("price"),
                "reported_at": trade.get("pubDate"),
                "reporting_gap_days": trade.get("reportingGap"),
                "chamber": trade.get("chamber"),
                "owner": trade.get("owner"),
            }
        )

    return trades


def _parse_capitol_trades(html: str) -> List[Dict[str, Any]]:
    """Extract trade rows from Capitol Trades HTML payloads."""
    trades = _parse_capitol_trades_payload(html)
    if trades:
        return trades
    return _parse_capitol_trades_table(html)


def _normalize_capitol_ticker(ticker: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9]", "", ticker.upper())
    return normalized


async def _fetch_capitol_issuer_id(ticker: str) -> int | None:
    normalized = _normalize_capitol_ticker(ticker)
    if not normalized:
        return None
    params = {"search": normalized}
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{CAPITOL_TRADES_BFF_URL}/issuers",
            headers=_capitol_trades_headers("application/json"),
            params=params,
        )
        response.raise_for_status()
        payload = response.json()
    candidates = payload.get("data") or []
    for candidate in candidates:
        issuer_ticker = (candidate.get("issuerTicker") or "").split(":")[0].upper()
        if issuer_ticker == normalized:
            return candidate.get("_issuerId")
    if candidates:
        return candidates[0].get("_issuerId")
    return None


async def _capitol_trades_urls(ticker: str | None) -> List[str]:
    if not ticker:
        return [CAPITOL_TRADES_URL]
    normalized = _normalize_capitol_ticker(ticker)
    if not normalized:
        return [CAPITOL_TRADES_URL]
    issuer_id = await _fetch_capitol_issuer_id(normalized)
    urls: List[str] = []
    if issuer_id:
        urls.append(f"{CAPITOL_TRADES_URL}?issuer={issuer_id}")
    urls.append(f"{CAPITOL_TRADES_URL}?issuer={normalized}")
    urls.append(CAPITOL_TRADES_URL)
    return urls


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

    # Notify Nerve Center (WhatsApp)
    notify_url = os.getenv("CHIP_NOTIFY_URL")
    if notify_url:
        try:
            async with httpx.AsyncClient() as client:
                message = f"📄 **ZoneXI: New Market Report**\nTitle: {title}\nCategory: {category}\n[Saved to local artifacts]"
                await client.post(notify_url, json={"type": "info", "message": message})
        except Exception as e:
            print(f"Failed to notify Chip Command: {e}")

    return f"Report saved: {filepath}"


@function_tool
async def read_zonexi_documentation() -> str:
    """Read comprehensive instructions and examples for the ZoneXI trading framework."""
    # PROJECT_ROOT is currently .../agent, so we go up one level to the repo root
    docs_path = PROJECT_ROOT.parent / "gpt-instructions" / "instructions.md"
    if not docs_path.exists():
        return "ZoneXI instructions file not found at expected path."
    return docs_path.read_text(encoding="utf-8")


# =============================================================================
# LAB INTEGRATION: Strategy Code Assistant Tools (Phase 1)
# =============================================================================
# These tools enable the agent to assist with strategy code development.
# They do NOT execute code - they only generate, analyze, and explain text.
# =============================================================================


@function_tool
async def generate_strategy_code(description: str, language: str = "python") -> str:
    """Generate trading strategy code from a natural language description.
    
    This tool creates a complete, runnable strategy template based on the user's
    requirements. The generated code follows best practices for the Lab environment.
    
    Args:
        description: Natural language description of the desired strategy
                     (e.g., "mean reversion strategy for SPY on 5-minute bars")
        language: Programming language for the output (default: 'python')
    
    Returns:
        A complete strategy code template with:
        - Required imports
        - Configuration parameters
        - Entry/exit logic
        - Risk management (stop loss, position sizing)
        - Logging and error handling
    
    Note: This tool generates CODE AS TEXT. It does not execute anything.
    The human must review and deploy the code through the Lab workflow.
    """
    # This is a "smart" tool - the LLM synthesizes the code based on the description.
    # The tool itself just returns a structured prompt for the agent to complete.
    # The actual code generation happens in the agent's reasoning loop.
    
    template_guidance = dedent(f"""
    Generate a complete {language} trading strategy based on this description:
    
    DESCRIPTION: {description}
    
    REQUIREMENTS:
    1. Include all necessary imports
    2. Define configurable parameters (lookback, thresholds, position size)
    3. Implement clear entry/exit signals
    4. Add stop-loss and take-profit logic
    5. Include logging for debugging
    6. Add docstrings explaining the logic
    7. Follow PEP 8 style guidelines
    
    OUTPUT FORMAT:
    Return the complete code wrapped in a Python code block.
    Include a header comment explaining the strategy.
    """).strip()
    
    return template_guidance


@function_tool
async def analyze_strategy_code(code: str) -> str:
    """Analyze trading strategy code for bugs, improvements, and best practices.
    
    This tool performs a comprehensive review of strategy code, identifying:
    - Logical errors that could cause incorrect trades
    - Performance issues (inefficient loops, memory leaks)
    - Missing error handling
    - Risk management gaps
    - Code style violations
    
    Args:
        code: The strategy code to analyze (as a string)
    
    Returns:
        A structured analysis with:
        - CRITICAL: Issues that must be fixed before deployment
        - WARNINGS: Potential problems that should be reviewed
        - SUGGESTIONS: Optional improvements for performance/readability
        - BEST PRACTICES: Recommendations for production readiness
    
    Note: This tool READS code as text. It does not execute anything.
    """
    analysis_prompt = dedent(f"""
    Analyze this trading strategy code for issues and improvements:
    
    ```python
    {code}
    ```
    
    ANALYSIS CHECKLIST:
    1. **Logic Errors**: Check for off-by-one errors, incorrect comparisons, order of operations
    2. **Risk Management**: Verify stop-loss, position sizing, max drawdown limits
    3. **Data Handling**: Check for NaN handling, timezone issues, data gaps
    4. **Performance**: Look for vectorization opportunities, unnecessary loops
    5. **Error Handling**: Verify try/except blocks, graceful degradation
    6. **Edge Cases**: Consider market holidays, pre/post market, gaps
    7. **Dependencies**: Check for missing imports, version compatibility
    
    OUTPUT FORMAT:
    Structure your response with these sections:
    - **CRITICAL ISSUES** (must fix)
    - **WARNINGS** (should review)
    - **SUGGESTIONS** (nice to have)
    - **OVERALL ASSESSMENT** (1-10 readiness score)
    """).strip()
    
    return analysis_prompt

@function_tool
async def explain_strategy_code(code: str) -> str:
    """Explain trading strategy code in plain English for beginners.

    This tool takes Python strategy code and breaks it down into simple,
    non-technical language that a beginner trader can understand.

    Args:
        code: The strategy code to explain (as a string)

    Returns:
        A natural language explanation of the strategy's logic and rules.
    """
    explanation_prompt = dedent(f"""
    Explain this trading strategy code in plain English for a beginner:

    ```python
    {code}
    ```

    INSTRUCTIONS:
    1. Avoid technical jargon where possible.
    2. Explain the "Why" behind the rules.
    3. Use analogies if they help clarify complex concepts.
    4. Break down the explanation into key sections:
       - Strategy Goal
       - When it Buys
       - When it Sells
       - Risk Management
    """).strip()

    return explanation_prompt


@function_tool
async def extract_strategy_parameters(transcript: str) -> str:
    """Extract structured trading strategy parameters from a natural language transcript.

    This tool analyzes a user's description of their trading strategy and extracts
    the core "Decision Engine" parameters, while ignoring "Execution Mechanics".

    Args:
        transcript: The natural language description or transcript of the strategy.

    Returns:
        A structured JSON string containing:
        - name: The strategy name.
        - description: A brief summary.
        - hypothesis: The core trading thesis.
        - parameters: A dynamic dictionary of strategy logic knobs (e.g., opening_range, delta).

    Note: This tool produces structured DATA. It does not execute trades.
    """
    extraction_prompt = dedent(f"""
    Analyze the following trading strategy transcript and extract the key "Decision Engine" components into a structured JSON format.

    TRANSCRIPT:
    {transcript}

    GUIDELINES:
    1. **Separate Strategy from Execution**:
       - DO extract strategy logic (Opening Range time, Delta targets, Stop Loss %, Take Profit %, etc.).
       - DO NOT extract execution mechanics (Bid/Ask/Mid, specific entry prices, limit vs market, broker UI steps).
    2. **Dynamic Parameters**: Extract any relevant logic knobs mentioned. Use snake_case for parameter keys.
    3. **Focus on Thesis**: Ensure the 'hypothesis' field captures the "Why" and "When" of the strategy.

    OUTPUT FORMAT (Strict JSON):
    {{
      "name": "string",
      "description": "string",
      "hypothesis": "string",
      "parameters": {{
        "key1": value1,
        "key2": value2
      }}
    }}

    Return ONLY the JSON object. Do not include any markdown formatting or character prefix/suffix.
    """).strip()

    return extraction_prompt


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
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "X-API-Key": self.api_key,
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(url, params=params, headers=headers)
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


class FuturesDataFetcher:
    """Helper for futures data retrieval with Databento primary and optional fallback."""

    CONTINUOUS_CONTRACTS = {
        "ES": {"databento_symbol": "ES.FUT", "quandl_code": "CHRIS/CME_ES1"},
        "NQ": {"databento_symbol": "NQ.FUT", "quandl_code": "CHRIS/CME_NQ1"},
        "CL": {"databento_symbol": "CL.FUT", "quandl_code": "CHRIS/CME_CL1"},
        "GC": {"databento_symbol": "GC.FUT", "quandl_code": "CHRIS/CME_GC1"},
        "YM": {"databento_symbol": "YM.FUT", "quandl_code": "CHRIS/CME_YM1"},
        "RTY": {"databento_symbol": "RTY.FUT", "quandl_code": "CHRIS/CME_RTY1"},
    }

    def __init__(
        self,
        databento_api_key: str | None,
        quandl_api_key: str | None = None,
        timeout: float = 20.0,
    ):
        self.databento_api_key = databento_api_key
        self.quandl_api_key = quandl_api_key
        self.timeout = timeout
        self.databento_base_url = os.getenv("DATABENTO_BASE_URL", "https://hist.databento.com")
        self.databento_dataset = os.getenv("DATABENTO_DATASET", "GLBX.MDP3")
        self.databento_schema = os.getenv("DATABENTO_SCHEMA", "ohlcv-1d")
        self.enable_quandl_fallback = (os.getenv("ENABLE_QUANDL_FALLBACK", "false").lower() == "true")

    def _resolve_symbol(self, symbol: str) -> Dict[str, str]:
        normalized = symbol.upper().strip()
        mapped = self.CONTINUOUS_CONTRACTS.get(normalized)
        if mapped:
            return {"normalized": normalized, **mapped}
        return {
            "normalized": normalized,
            "databento_symbol": f"{normalized}.FUT",
            "quandl_code": normalized,
        }

    def _seeded_daily_fallback(self, symbol: str, start_date: str, end_date: str, limit: int) -> Dict[str, Any]:
        start = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date, "%Y-%m-%d")
        seed_input = f"{symbol}:{start_date}:{end_date}"
        seed = abs(hash(seed_input)) % (2**32)
        rng = seed

        def rnd():
            nonlocal rng
            rng = (rng * 1664525 + 1013904223) % (2**32)
            return rng / (2**32)

        base_map = {"ES": 5000.0, "NQ": 21000.0, "CL": 75.0, "GC": 2300.0}
        price = base_map.get(symbol.upper(), 1000.0)
        bars = []
        current = start
        while current <= end and len(bars) < min(limit, 1000):
            if current.weekday() < 5:
                drift = (rnd() - 0.49) * 0.02
                open_price = price
                close_price = max(0.01, open_price * (1 + drift))
                high_price = max(open_price, close_price) * (1 + rnd() * 0.004)
                low_price = min(open_price, close_price) * (1 - rnd() * 0.004)
                bars.append(
                    {
                        "date": current.strftime("%Y-%m-%d"),
                        "o": round(open_price, 4),
                        "h": round(high_price, 4),
                        "l": round(low_price, 4),
                        "c": round(close_price, 4),
                        "v": int(10000 + rnd() * 45000),
                        "oi": None,
                    }
                )
                price = close_price
            current += timedelta(days=1)

        return {
            "symbol": symbol,
            "provider": "synthetic",
            "bars": bars,
            "bar_count": len(bars),
            "fallback": True,
            "note": "Databento unavailable or not configured. Using deterministic synthetic futures bars.",
        }

    async def _fetch_databento_daily_bars(
        self,
        databento_symbol: str,
        start_date: str,
        end_date: str,
        limit: int,
    ) -> List[Dict[str, Any]]:
        if not self.databento_api_key:
            return []

        params = {
            "dataset": self.databento_dataset,
            "schema": self.databento_schema,
            "stype_in": "raw_symbol",
            "symbols": databento_symbol,
            "start": start_date,
            "end": end_date,
            "limit": min(limit, 5000),
            "encoding": "csv",
        }
        headers = {"Authorization": f"Bearer {self.databento_api_key}", "Accept": "text/csv"}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(f"{self.databento_base_url}/v0/timeseries.get_range", params=params, headers=headers)
            response.raise_for_status()
            csv_payload = response.text.strip()
        if not csv_payload:
            return []

        lines = [line for line in csv_payload.splitlines() if line.strip()]
        if len(lines) <= 1:
            return []
        headers_row = [item.strip() for item in lines[0].split(",")]
        header_index = {name: idx for idx, name in enumerate(headers_row)}
        required = {"open", "high", "low", "close"}
        if not required.issubset(header_index.keys()):
            return []

        ts_key = "ts_event" if "ts_event" in header_index else "ts_recv"
        bars: List[Dict[str, Any]] = []
        for row in lines[1:]:
            cols = row.split(",")
            try:
                ts_value = cols[header_index[ts_key]]
                bars.append(
                    {
                        "date": ts_value[:10],
                        "o": float(cols[header_index["open"]]),
                        "h": float(cols[header_index["high"]]),
                        "l": float(cols[header_index["low"]]),
                        "c": float(cols[header_index["close"]]),
                        "v": float(cols[header_index["volume"]]) if "volume" in header_index else None,
                        "oi": None,
                    }
                )
            except (ValueError, IndexError):
                continue
        return bars

    async def _fetch_quandl_daily_bars(
        self,
        quandl_code: str,
        symbol: str,
        start_date: str,
        end_date: str,
        limit: int,
    ) -> Dict[str, Any]:
        if not self.quandl_api_key:
            return {"symbol": symbol, "provider": "quandl", "bars": [], "error": "QUANDL_API_KEY not configured"}
        url = f"{QUANDL_BASE_URL}/datasets/{quandl_code}.json"
        params = {
            "api_key": self.quandl_api_key,
            "start_date": start_date,
            "end_date": end_date,
            "limit": min(limit, 1000),
            "order": "asc",
        }
        headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(url, params=params, headers=headers)
            response.raise_for_status()
            payload = response.json()

        dataset = payload.get("dataset", {})
        columns = dataset.get("column_names", [])
        data = dataset.get("data", [])
        col_map = {name.lower(): idx for idx, name in enumerate(columns)}
        bars = []
        for row in data:
            bars.append(
                {
                    "date": row[col_map.get("date", 0)] if "date" in col_map else None,
                    "o": row[col_map.get("open", 1)] if "open" in col_map else None,
                    "h": row[col_map.get("high", 2)] if "high" in col_map else None,
                    "l": row[col_map.get("low", 3)] if "low" in col_map else None,
                    "c": row[col_map.get("last", 4)] if "last" in col_map else row[col_map.get("settle", 4)] if "settle" in col_map else row[col_map.get("close", 4)] if "close" in col_map else None,
                    "v": row[col_map.get("volume", 5)] if "volume" in col_map else None,
                    "oi": row[col_map.get("open_interest", 6)] if "open_interest" in col_map else row[col_map.get("open interest", 6)] if "open interest" in col_map else None,
                }
            )
        return {
            "symbol": symbol,
            "provider": "quandl",
            "bars": bars,
            "bar_count": len(bars),
            "fallback": True,
            "note": "Databento failed; returned Quandl fallback bars.",
        }

    async def get_daily_aggregates(
        self,
        symbol: str,
        start_date: str,
        end_date: str,
        limit: int = 50,
    ) -> Dict[str, Any]:
        resolved = self._resolve_symbol(symbol)
        normalized = resolved["normalized"]
        databento_symbol = resolved["databento_symbol"]
        quandl_code = resolved["quandl_code"]

        try:
            bars = await self._fetch_databento_daily_bars(databento_symbol, start_date, end_date, limit)
            if bars:
                return {
                    "symbol": normalized,
                    "provider": "databento",
                    "databento_symbol": databento_symbol,
                    "bars": bars,
                    "bar_count": len(bars),
                    "fallback": False,
                    "note": f"Loaded {len(bars)} daily bars from Databento.",
                }
        except Exception as exc:
            if self.enable_quandl_fallback and self.quandl_api_key:
                try:
                    return await self._fetch_quandl_daily_bars(quandl_code, normalized, start_date, end_date, limit)
                except Exception:
                    return self._seeded_daily_fallback(normalized, start_date, end_date, limit)
            return self._seeded_daily_fallback(normalized, start_date, end_date, limit) | {
                "note": f"Databento request failed ({exc}). Synthetic fallback enabled."
            }

        if self.enable_quandl_fallback and self.quandl_api_key:
            try:
                return await self._fetch_quandl_daily_bars(quandl_code, normalized, start_date, end_date, limit)
            except Exception:
                return self._seeded_daily_fallback(normalized, start_date, end_date, limit)
        return self._seeded_daily_fallback(normalized, start_date, end_date, limit)
    
    async def get_4h_bars(
        self,
        symbol: str,
        start_date: str,
        end_date: str,
        num_bars: int = 3,
    ) -> Dict[str, Any]:
        """Compute 4-hour bars from daily data for futures.
        
        This method fetches daily bars and provides guidance on session structure.
        
        For true intraday 4H bars, a paid data source (Databento, CME) is required.
        
        Globex session structure for ES (nearly 24h trading):
        - Session 1: 18:00 - 22:00 ET (4h) - Sunday open / evening
        - Session 2: 22:00 - 02:00 ET (4h) - overnight
        - Session 3: 02:00 - 06:00 ET (4h) - early morning
        - Session 4: 06:00 - 10:00 ET (4h) - includes RTH open at 9:30
        - Session 5: 10:00 - 14:00 ET (4h) - midday
        - Session 6: 14:00 - 17:00 ET (3h) - afternoon close
        
        Args:
            symbol: Futures symbol (e.g., "ES")
            start_date: Start date YYYY-MM-DD
            end_date: End date YYYY-MM-DD
            num_bars: Number of 4H "approximated" bars to return
            
        Returns:
            Dict with daily bars and 4H approximation guidance
        """
        # Fetch daily data
        daily_result = await self.get_daily_aggregates(symbol, start_date, end_date, limit=num_bars * 2)
        
        if daily_result.get("error"):
            return daily_result
        
        daily_bars = daily_result.get("bars", [])
        
        # Since we only have daily data, we approximate 4H structure
        # by dividing the daily range into theoretical 4H windows
        approximated_bars = []
        for bar in daily_bars[-num_bars:]:
            if bar.get("o") is None or bar.get("h") is None:
                continue
                
            daily_open = float(bar.get("o", 0))
            daily_high = float(bar.get("h", 0))
            daily_low = float(bar.get("l", 0))
            daily_close = float(bar.get("c", 0))
            daily_range = daily_high - daily_low
            
            # Create approximated 4H windows for the day
            # This is an estimation - real 4H bars require intraday data
            windows = []
            
            # Window 1: Open to ~1/4 of daily range
            w1_close = daily_open + (daily_close - daily_open) * 0.25
            windows.append({
                "date": bar.get("date"),
                "window": 1,
                "window_label": "Globex Evening (18:00-22:00 ET)",
                "o": daily_open,
                "h": daily_open + daily_range * 0.15,
                "l": daily_low if daily_low < w1_close else daily_open - daily_range * 0.05,
                "c": w1_close,
                "note": "Approximated from daily data",
            })
            
            # Window 4: RTH morning session (most relevant for One Candle Theory)
            w4_open = daily_open + (daily_close - daily_open) * 0.3
            w4_close = daily_open + (daily_close - daily_open) * 0.7
            windows.append({
                "date": bar.get("date"),
                "window": 4,
                "window_label": "RTH Morning (06:00-10:00 ET, includes 9:30 open)",
                "o": w4_open,
                "h": max(w4_open, w4_close) + daily_range * 0.1,
                "l": min(w4_open, w4_close) - daily_range * 0.08,
                "c": w4_close,
                "note": "Approximated from daily data",
            })
            
            approximated_bars.append({
                "date": bar.get("date"),
                "daily_bar": bar,
                "estimated_4h_windows": windows,
            })
        
        return {
            "symbol": symbol,
            "provider": daily_result.get("provider", "synthetic"),
            "databento_symbol": daily_result.get("databento_symbol"),
            "timeframe": "4H (approximated from daily)",
            "bars": approximated_bars,
            "total_days": len(daily_bars),
            "requested": num_bars,
            "note": (
                "True 4H intraday bars require a paid data source (Databento, CME). "
                "These bars are approximated from daily OHLC data using Globex session patterns."
            ),
            "globex_sessions": [
                "Session 1: 18:00-22:00 ET (Sunday open/evening)",
                "Session 2: 22:00-02:00 ET (overnight)",
                "Session 3: 02:00-06:00 ET (early morning)",
                "Session 4: 06:00-10:00 ET (includes RTH 9:30 open)",
                "Session 5: 10:00-14:00 ET (midday)",
                "Session 6: 14:00-17:00 ET (afternoon, 3h to close)",
            ],
        }


_futures_fetcher: FuturesDataFetcher | None = None


def _get_futures_fetcher() -> FuturesDataFetcher | None:
    """Get futures fetcher with Databento primary and optional fallback."""
    global _futures_fetcher
    if _futures_fetcher is None:
        databento_key = os.getenv("DATABENTO_API_KEY")
        quandl_key = os.getenv("QUANDL_API_KEY")
        if databento_key or quandl_key:
            _futures_fetcher = FuturesDataFetcher(
                databento_api_key=databento_key,
                quandl_api_key=quandl_key,
            )
    return _futures_fetcher


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
async def get_polygon_4h_bars(
    ticker: str,
    start_date: str,
    end_date: str,
    num_bars: int = 3,
) -> Dict[str, Any]:
    """
    Fetch 4-hour bars for a ticker by aggregating minute data from Polygon.
    
    Polygon's hourly aggregates may be limited on some API tiers, so this
    fetches minute data and computes 4H OHLCV bars aligned to market sessions.
    
    Market session breakdown (EST):
    - 4H Bar 1: 09:30-13:30 (first 4 hours of regular session)
    - 4H Bar 2: 13:30-16:00 (last 2.5 hours, may be partial)
    
    Args:
        ticker: Stock ticker symbol (e.g., "SPY")
        start_date: Start date YYYY-MM-DD
        end_date: End date YYYY-MM-DD
        num_bars: Number of 4H bars to return (default 3)
    
    Returns:
        Dict with 'bars' list containing OHLCV for each 4H period
    """
    import httpx
    from datetime import datetime, timedelta, timezone
    
    api_key = os.getenv("POLYGON_API_KEY")
    if not api_key:
        return {"ticker": ticker, "bars": [], "error": "POLYGON_API_KEY not set"}
    
    # Fetch minute data for the date range (need more data for 4H aggregation)
    # Limit to 5000 minutes (~8 trading days worth) to ensure we get enough bars
    url = (
        f"{POLYGON_BASE_URL}/v2/aggs/ticker/{ticker}/range/1/minute/"
        f"{start_date}/{end_date}?adjusted=true&sort=asc&limit=5000&apiKey={api_key}"
    )
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(url)
        data = response.json()
    
    if data.get("status") != "OK" or not data.get("results"):
        return {
            "ticker": ticker,
            "bars": [],
            "message": f"No minute data available. API returned: {data.get('status', 'unknown')}"
        }
    
    minute_bars = data.get("results", [])
    
    # Group minute bars by 4H window
    # Market hours: 9:30 AM - 4:00 PM EST = 6.5 hours
    # We'll create 2 bars per day: 9:30-13:30 (4h) and 13:30-16:00 (2.5h)
    four_hour_bars = []
    current_window_bars = []
    current_window_start = None
    
    for bar in minute_bars:
        ts = bar.get("t", 0) / 1000  # Convert ms to seconds
        bar_time = datetime.fromtimestamp(ts, tz=timezone.utc)
        
        # Calculate 4H window (0-3 = first 4H, 4-7 = second 4H, etc.)
        # Align to 4-hour blocks starting from midnight
        window_id = bar_time.hour // 4
        window_key = (bar_time.date(), window_id)
        
        if current_window_start is None:
            current_window_start = window_key
            current_window_bars = [bar]
        elif window_key == current_window_start:
            current_window_bars.append(bar)
        else:
            # Save previous window
            if current_window_bars:
                agg_bar = {
                    "t": current_window_bars[0].get("t"),
                    "date": str(current_window_start[0]),
                    "window": current_window_start[1],
                    "o": current_window_bars[0].get("o"),
                    "h": max(b.get("h", 0) for b in current_window_bars),
                    "l": min(b.get("l", float("inf")) for b in current_window_bars),
                    "c": current_window_bars[-1].get("c"),
                    "v": sum(b.get("v", 0) for b in current_window_bars),
                    "minutes_in_bar": len(current_window_bars),
                }
                four_hour_bars.append(agg_bar)
            
            # Start new window
            current_window_start = window_key
            current_window_bars = [bar]
    
    # Don't forget the last window
    if current_window_bars:
        agg_bar = {
            "t": current_window_bars[0].get("t"),
            "date": str(current_window_start[0]),
            "window": current_window_start[1],
            "o": current_window_bars[0].get("o"),
            "h": max(b.get("h", 0) for b in current_window_bars),
            "l": min(b.get("l", float("inf")) for b in current_window_bars),
            "c": current_window_bars[-1].get("c"),
            "v": sum(b.get("v", 0) for b in current_window_bars),
            "minutes_in_bar": len(current_window_bars),
        }
        four_hour_bars.append(agg_bar)
    
    # Filter to only market-hour windows (windows 2, 3, 4 cover ~9:30-16:00 roughly)
    market_bars = [b for b in four_hour_bars if b.get("window") in [2, 3, 4]]
    
    # Return only the requested number of most recent bars
    result_bars = market_bars[-num_bars:] if len(market_bars) > num_bars else market_bars
    
    return {
        "ticker": ticker,
        "timeframe": "4H",
        "bars": result_bars,
        "total_4h_bars_found": len(market_bars),
        "requested": num_bars,
    }


@function_tool
async def get_futures_daily_aggregates(
    symbol: str,
    start_date: str,
    end_date: str,
    limit: int = 50,
) -> Dict[str, Any]:
    """
    Fetch daily OHLCV bars for futures contracts with Databento primary.
    
    Polygon.io does not support futures data. This tool uses Databento as the
    primary provider and can optionally fall back to Quandl when enabled.
    
    Symbol formats supported:
    - Continuous contracts: "ES", "NQ", "CL", "GC" (auto-resolves to front month)
    - Specific contracts: "ESH26" or "ESH2026" (March 2026 E-mini S&P)
    
    Args:
        symbol: Futures symbol (e.g., "ES", "NQ", "ESH26", "CLM25")
        start_date: Start date YYYY-MM-DD
        end_date: End date YYYY-MM-DD
        limit: Maximum number of bars to return (default 50)
    
    Returns:
        Dict with 'bars' containing date, open, high, low, close, volume, open_interest
    
    Note:
        Requires DATABENTO_API_KEY for live provider data.
    """
    fetcher = _get_futures_fetcher()
    if fetcher is None:
        return {
            "symbol": symbol,
            "bars": [],
            "error": "No futures provider configured. Set DATABENTO_API_KEY. Optional fallback: QUANDL_API_KEY + ENABLE_QUANDL_FALLBACK=true.",
        }
    return await fetcher.get_daily_aggregates(symbol, start_date, end_date, limit)


@function_tool
async def get_futures_4h_bars(
    symbol: str,
    start_date: str,
    end_date: str,
    num_bars: int = 3,
) -> Dict[str, Any]:
    """
    Get 4-hour bars for futures contracts with Globex session awareness.
    
    Note: This tool fetches daily bars and provides approximated 4H windows
    based on typical Globex session patterns.
    
    For true intraday 4H bars, a paid data source (Databento, CME) is required.
    
    Globex session structure (nearly 24-hour trading):
    - Session 1: 18:00-22:00 ET - Sunday open / evening
    - Session 2: 22:00-02:00 ET - overnight
    - Session 3: 02:00-06:00 ET - early morning
    - Session 4: 06:00-10:00 ET - RTH open (includes 9:30 AM equity open)
    - Session 5: 10:00-14:00 ET - midday
    - Session 6: 14:00-17:00 ET - afternoon close (3h)
    
    Args:
        symbol: Futures symbol (e.g., "ES", "NQ")
        start_date: Start date YYYY-MM-DD
        end_date: End date YYYY-MM-DD
        num_bars: Number of 4H periods to return (default 3)
    
    Returns:
        Dict with approximated 4H bars and Globex session guidance
    """
    fetcher = _get_futures_fetcher()
    if fetcher is None:
        return {
            "symbol": symbol,
            "bars": [],
            "error": "No futures provider configured. Set DATABENTO_API_KEY. Optional fallback: QUANDL_API_KEY + ENABLE_QUANDL_FALLBACK=true.",
        }
    return await fetcher.get_4h_bars(symbol, start_date, end_date, num_bars)


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
async def get_capitol_trades(n: int = 10, ticker: str | None = None) -> Dict[str, Any]:
    """Fetch recent congressional trades scraped from Capitol Trades."""
    limit = max(1, min(int(n), 50))
    last_error: Exception | None = None
    urls = await _capitol_trades_urls(ticker)
    for url in urls:
        try:
            html = await _fetch_capitol_trades_html(url)
        except httpx.HTTPError as exc:
            last_error = exc
            continue
        trades = _parse_capitol_trades(html)
        if trades:
            return {"trades": trades[:limit], "source_url": url, "ticker": ticker}
    if last_error:
        raise RuntimeError(f"Failed to download Capitol Trades page: {last_error}") from last_error
    if last_error:
        raise RuntimeError(f"Failed to download Capitol Trades page: {last_error}") from last_error
    return {"trades": [], "source_url": None, "ticker": ticker}


@function_tool
async def get_ranked_options(
    ticker: str,
    metric: str,
    k: int = 10,
    contract_type: str | None = None
) -> Dict[str, Any]:
    """
    Rank option contracts by a custom metric using a client-side heap algorithm.
    Useful for finding opportunities not directly sortable by the API.
    
    Args:
        ticker: Underlying symbol (e.g. 'SPY')
        metric: One of 'volume_oi_ratio', 'turnover', 'volatility_skew'
        k: Number of top results to return
        contract_type: Filter by 'call' or 'put' (optional)
    """
    fetcher = _get_polygon_fetcher()
    # Fetch a larger batch to scan (limit=250 is the hardcap in fetcher, 
    # but we scan what we can get to find the "relative" best in that set).
    # In a real expanded implementations, we would paginate here.
    snapshot = await fetcher.get_options_snapshot(
        ticker, 
        limit=250, 
        contract_type=contract_type
    )
    
    options = snapshot.get("options", [])
    if not options:
        return {"status": "no data", "results": []}

    leaderboard = MarketLeaderboard(k=k, is_increase=True)
    
    for opt in options:
        val = 0.0
        details = {
            "contract": opt.get("contract"),
            "strike": opt.get("strike"),
            "type": opt.get("contract_type"),
            "iv": opt.get("implied_volatility"),
            "price": opt.get("mid"),
        }
        
        try:
            vol = float(opt.get("volume") or 0)
            oi = float(opt.get("open_interest") or 0)
            mid = float(opt.get("mid") or 0)
            iv = float(opt.get("implied_volatility") or 0)
            
            if metric == "volume_oi_ratio":
                # Avoid division by zero, prioritize purely by ratio
                val = vol / (oi if oi > 0 else 1.0)
                details["metric_value"] = val
                details["formula"] = f"{vol} / {oi}"
                
            elif metric == "turnover":
                val = vol * mid * 100 # Approx dollar nominal
                details["metric_value"] = val
                details["formula"] = f"{vol} * {mid} * 100"
                
            elif metric == "volatility_skew":
                # Placeholder: Simply ranking by IV for now 
                # (Real skew requires comparing to ATM IV, but high IV is a proxy)
                val = iv
                details["metric_value"] = val
            
            else:
                continue

            leaderboard.add(opt.get("contract"), val, details)
            
        except (ValueError, TypeError):
            continue

    return {
        "ticker": ticker,
        "metric": metric,
        "ranked_results": leaderboard.get_results(),
        "scanned_count": len(options)
    }


# --- Lab/Engine Integration Tools ---

LAB_API_URL = os.getenv("LAB_API_URL", "http://localhost:4000/api/lab")
SCREENER_API_URL = os.getenv("SCREENER_API_URL", "http://localhost:8001/api/lab/screener")


@function_tool
async def create_lab_strategy(
    name: str,
    screener_type: str,
    params_json: str,
    description: str = "",
) -> str:
    """
    Register a screener strategy in the Lab for backtesting and validation.
    
    Args:
        name: Strategy name (e.g., "0-DTE SPY Covered Call")
        screener_type: Either '0dte_covered_call' or 'advanced_covered_call'
        params_json: JSON string of screener parameters, e.g. '{"delta_lo": 0.15, "delta_hi": 0.35, "min_bid": 0.05}'
        description: Optional description of the strategy
    
    Returns:
        JSON string with strategy object including _id, status, and config
    """
    import json
    params = json.loads(params_json)
    
    payload = {
        "name": name,
        "description": description,
        "strategyType": "screener",
        "ownerId": "ai_agent",
        "screenerConfig": {
            "screener_type": screener_type,
            "endpoint": f"http://localhost:8001/api/screen/{screener_type.replace('_', '-')}",
            "params": params,
            "schedule": "manual"
        }
    }
    
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(f"{LAB_API_URL}/strategy/create", json=payload)
        response.raise_for_status()
        return json.dumps(response.json())



@function_tool
async def create_zonexi_strategy(
    name: str,
    code: str,
    description: str = "",
) -> str:
    """
    Register a complex Python strategy (ZoneXI framework) in the Lab.
    
    Args:
        name: Strategy name (e.g., "Golden Cross AAPL")
        code: The complete Python source code of the strategy class.
        description: Optional description of the strategy.
    
    Returns:
        JSON string with strategy object including _id, status, and config.
    """
    import json
    
    payload = {
        "name": name,
        "description": description,
        "strategyType": "zonexi",
        "ownerId": "ai_agent",
        "zonexiConfig": {
            "code": code
        }
    }
    
    async with httpx.AsyncClient(timeout=20.0) as client:
        # We reuse the same endpoint, the server now handles strategyType='zonexi'
        response = await client.post(f"{LAB_API_URL}/strategy/create", json=payload)
        response.raise_for_status()
        return json.dumps(response.json())


@function_tool
async def backtest_screener_strategy(
    screener_type: str,
    symbol: str,
    start_date: str,
    end_date: str,
    params_json: str,
) -> str:
    """
    Run a historical backtest of a screener strategy to validate its edge.
    
    Args:
        screener_type: Either '0dte_covered_call' or 'advanced_covered_call'
        symbol: Underlying ticker (e.g., 'SPY')
        start_date: Start date for backtest (YYYY-MM-DD)
        end_date: End date for backtest (YYYY-MM-DD)
        params_json: JSON string of screener parameters, e.g. '{"delta_lo": 0.15}'
    
    Returns:
        JSON string with backtest results including Sharpe Ratio, Expected Value, Win Rate, etc.
    """
    import json
    params = json.loads(params_json)
    
    payload = {
        "screener_type": screener_type,
        "symbol": symbol,
        "start_date": start_date,
        "end_date": end_date,
        "params": params
    }
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(f"{SCREENER_API_URL}/backtest", json=payload)
        response.raise_for_status()
        return json.dumps(response.json())


@function_tool
async def request_strategy_handoff(
    strategy_id: str,
    max_capital: float,
    max_drawdown: float,
    max_daily_loss: float,
    symbols_json: str,
) -> str:
    """
    Promote a validated Lab strategy to the Engine for live execution.
    
    Args:
        strategy_id: The MongoDB _id of the Lab strategy
        max_capital: Maximum capital to allocate
        max_drawdown: Maximum acceptable drawdown (e.g., 0.15 for 15%)
        max_daily_loss: Maximum daily loss limit in dollars
        symbols_json: JSON array of symbols, e.g. '["SPY"]'
    
    Returns:
        JSON string with handoff request object
    """
    import json
    symbols = json.loads(symbols_json)
    
    # First, get the strategy to extract validation proof
    async with httpx.AsyncClient(timeout=20.0) as client:
        strategy_response = await client.get(f"{LAB_API_URL}/strategy/{strategy_id}")
        strategy_response.raise_for_status()
        strategy = strategy_response.json()
    
    backtest_results = strategy.get("backtestResults")
    if not backtest_results:
        raise ValueError("Strategy has no backtest results. Run backtest first.")
    
    metrics = backtest_results.get("metrics", {})
    
    handoff_payload = {
        "strategyId": strategy_id,
        "requesterId": "ai_agent",
        "engineConfig": {
            "maxCapital": max_capital,
            "riskLimits": {
                "maxDrawdown": max_drawdown,
                "maxDailyLoss": max_daily_loss
            },
            "symbols": symbols
        },
        "validationProof": {
            "sharpeRatio": metrics.get("sharpeRatio", 0),
            "expectedValue": metrics.get("expectedValue", 0),
            "backtestId": strategy_id
        }
    }
    
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post("http://localhost:4000/api/handoff/request", json=handoff_payload)
        response.raise_for_status()
        return json.dumps(response.json())


@function_tool
async def scan_best_0dte_candidates(
    top_n: int = 5,
    delta_lo: float = 0.15,
    delta_hi: float = 0.35,
    min_bid: float = 0.05,
    tickers_json: str = "",
) -> str:
    """
    Scan multiple tickers to find the best 0-DTE covered call opportunities.
    Use this to discover which underlyings have the best premium yield today.
    
    Args:
        top_n: Number of top opportunities to return (1-20)
        delta_lo: Minimum delta for screening (default 0.15)
        delta_hi: Maximum delta for screening (default 0.35)
        min_bid: Minimum bid price (default $0.05)
        tickers_json: Optional JSON array of tickers, e.g. '["SPY","QQQ"]'. If empty, uses default watchlist.
    
    Returns:
        JSON string with top N tickers ranked by premium yield
    """
    import json
    
    payload = {
        "top_n": top_n,
        "delta_lo": delta_lo,
        "delta_hi": delta_hi,
        "min_bid": min_bid,
    }
    
    if tickers_json:
        payload["tickers"] = json.loads(tickers_json)
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(f"{SCREENER_API_URL.replace('/lab/screener', '/scan')}/0dte-universe", json=payload)
        response.raise_for_status()
        return json.dumps(response.json())


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
            "command": sys.executable,
            "args": ["-c", "import mcp_polygon; mcp_polygon.run()"],
            "env": {**os.environ, "POLYGON_API_KEY": api_key},
        },
        # First-time MCP startup can exceed the 5s default; give the server
        # more time to start/respond before declaring failure.
        client_session_timeout_seconds=30,
    )


def create_financial_analysis_agent(server: MCPServerStdio | None = None, *, enforce_guardrail: bool = True) -> Agent:
    """Instantiate the financial analysis agent, optionally bound to an MCP server.

    The finance guardrail is enforced on the first turn of a session to keep the
    agent scoped to market analysis, but subsequent turns can skip it for smoother
    follow-up questions once intent is established.
    
    If no MCP server is provided (or MCP failed to start), the agent still works
    using the native Polygon REST API tools.
    """
    _openai_model = os.getenv("OPENAI_MODEL", "gpt-4o")
    return Agent(
        name="Financial Analysis Agent",
        instructions=(
            "Financial analysis agent. Steps:\n"
            "1. Verify finance-related using guardrail\n"
            "2. Call Polygon tools precisely; pull the minimal required data.\n"
            "3. Include disclaimers.\n"
            "4. Offer to save reports if not asked by the user to save a report.\n\n"
            "FUTURES DATA SUPPORT:\n"
            "Polygon.io does NOT support futures. For futures (ES, NQ, CL, GC, etc.):\n"
            "- Use `get_futures_daily_aggregates` for daily OHLCV bars\n"
            "- Use `get_futures_4h_bars` for 4-hour bars (approximated from daily data)\n"
            "- Supported symbols: ES (E-mini S&P 500), NQ, YM, RTY, CL, GC, SI, ZB, ZN, 6E\n"
            "- Specific contracts: ESH26 (March 2026), NQM25 (June 2025), etc.\n"
            "- Globex sessions run nearly 24h (18:00-17:00 ET next day with 1h break)\n"
            "- Primary key: DATABENTO_API_KEY; QUANDL fallback is optional and disabled by default\n\n"
            "ZONEXI STRATEGY ASSISTANT:\n"
            "If the user asks about ZoneXI strategies, indicators, or debugging:\n"
            "1. ALWAYS call `read_zonexi_documentation` first to get the context.\n"
            "2. Use the examples and syntax from that file to write the code.\n"
            "3. If the user wants to SAVE or CREATE the strategy, use `create_zonexi_strategy` tool.\n"
            "   - Pass the full Python code as the `code` argument.\n"
            "   - This saves it to the Lab for future execution or reference.\n"
            "4. Follow the specific debugging and optimization advice provided in the docs.\n\n"
            "STRATEGY LIFECYCLE:\n"
            "You can now manage trading strategies end-to-end:\n"
            "- DISCOVER: Use `scan_best_0dte_candidates` to find opportunities.\n"
            "- DESIGN: Use `create_lab_strategy` to save a strategy concept to the Lab.\n"
            "- VALIDATE: Use `backtest_screener_strategy` to check historical performance.\n"
            "- DEPLOY: Use `request_strategy_handoff` to promote validated strategies to the Engine.\n\n"
            "LAB CODE ASSISTANT (Phase 1):\n"
            "You can help users develop strategy code:\n"
            "- `generate_strategy_code`: Create Python strategy code from natural language descriptions.\n"
            "- `analyze_strategy_code`: Review code for bugs, improvements, and best practices.\n"
            "- `explain_strategy_code`: Explain strategy code in plain English for beginners.\n"
            "- `extract_strategy_parameters`: Extract structured JSON parameters from a transcript/description.\n"
            "These tools only produce TEXT (code/analysis) or DATA (JSON). They do NOT execute anything.\n"
            "All code must be reviewed by humans before deployment.\n\n"
            "RESPONSE FORMAT:\n"
            "You MUST structure your response in two distinct sections:\n"
            "1. **Executive Summary**: High-level, professional, dense with data and metrics (Delta, IV, Yield, Greeks). This is for experienced traders.\n"
            "2. **Beginner Breakdown**: A 'Explain Like I'm 5' (ELI5) section. Imagine you are explaining this to a 5th grader. Focus on the platform YOU are using (this application). Tell them: 'Look at the **Scanner Results** panel on the dashboard', 'Find the ticker SPY', 'Click the card to see the details'. explain exactly WHAT happens and HOW to do it simply on THIS application.\n\n"
            "RULES:\n"
            "Double-check math; limit news to ≤3 articles/ticker in date range.\n"
            "If the user asks to save a report, save it to the reports folder using the save_analysis_report tool.\n"
            "When using any polygon.io data tools, be mindful of how much data you pull based on the users input to minimize context being exceeded.\n"
            "If data unavailable or tool fails, explain gracefully — never fabricate.\n"
            "Note: `params_json` and `symbols_json` arguments MUST be valid JSON strings.\n\n"
            "TOOLS:\n"
            "Polygon.io data (equities/options), Databento-first futures data,\n"
            "get_futures_daily_aggregates, get_futures_4h_bars (for ES, NQ, etc.),\n"
            "get_polygon_options_snapshot, get_polygon_option_contract_snapshot,\n"
            "get_polygon_option_quotes, get_polygon_option_trades,\n"
            "get_polygon_intraday_aggregates, get_polygon_4h_bars,\n"
            "get_polygon_exchanges, get_polygon_ticker_sentiment,\n"
            "get_polygon_earnings, get_polygon_dividends, get_polygon_financials,\n"
            "get_capitol_trades, get_fred_series, get_fred_release_calendar,\n"
            "create_lab_strategy, backtest_screener_strategy, request_strategy_handoff,\n"
            "scan_best_0dte_candidates, save_analysis_report, read_zonexi_documentation, create_zonexi_strategy,\n"
            "generate_strategy_code, analyze_strategy_code, explain_strategy_code, extract_strategy_parameters\n"
            "Disclaimer: Not financial advice. For informational purposes only."
        ),
        mcp_servers=[server] if server else [],
        tools=[
            save_analysis_report,
            read_zonexi_documentation,
            create_zonexi_strategy,
            get_polygon_options_snapshot,
            get_polygon_option_contract_snapshot,
            get_polygon_option_quotes,
            get_polygon_option_trades,
            get_polygon_intraday_aggregates,
            get_polygon_4h_bars,
            get_futures_daily_aggregates,
            get_futures_4h_bars,
            get_polygon_exchanges,
            get_polygon_ticker_sentiment,
            get_polygon_dividends,
            get_polygon_earnings,
            get_polygon_financials,
            get_capitol_trades,
            get_fred_series,
            get_fred_release_calendar,
            get_ranked_options,
            create_lab_strategy,
            backtest_screener_strategy,
            request_strategy_handoff,
            scan_best_0dte_candidates,
            # Lab Code Assistant (Phase 1)
            generate_strategy_code,
            analyze_strategy_code,
            explain_strategy_code,
            extract_strategy_parameters,
        ],
        input_guardrails=[InputGuardrail(guardrail_function=finance_guardrail)] if enforce_guardrail else [],
        model=OpenAIResponsesModel(model=_openai_model, openai_client=AsyncOpenAI()),
        model_settings=ModelSettings(truncation="auto"),
    )


async def run_analysis(
    query: str,
    session: SQLiteSession | None = None,
    server: MCPServerStdio | None = None,
    session_name: str | None = None,
    context: Dict[str, Any] | None = None,
    trace_label: str = DEFAULT_TRACE_LABEL,
    skip_mcp: bool = False,
    enforce_guardrail: bool | None = None,
):
    """Execute the financial analysis agent for a single query.
    
    If server is None and skip_mcp is False, attempts to create an MCP server.
    If server is None and skip_mcp is True, runs without MCP (native tools only).
    """
    session_obj = session
    if session_obj is None:
        session_label = session_name or f"analysis_{uuid.uuid4().hex}"
        session_obj = SQLiteSession(session_label)

    # Determine if we should use MCP
    server_obj = server
    owns_server = False
    if server_obj is None and not skip_mcp:
        try:
            server_obj = create_polygon_mcp_server()
            owns_server = True
        except Exception:
            # MCP creation failed - continue without it
            server_obj = None
    
    session_key = _session_guardrail_key(session_obj)
    
    # If explicit override provided, use it. Otherwise, check session history.
    if enforce_guardrail is not None:
        actual_enforce = enforce_guardrail
    else:
        actual_enforce = session_key is None or session_key not in _GUARDRAIL_PASSED_SESSIONS

    agent = create_financial_analysis_agent(server_obj, enforce_guardrail=actual_enforce)

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
        if session_key and actual_enforce:
            _GUARDRAIL_PASSED_SESSIONS.add(session_key)
        return result

    # Only use async context if we own the server and it exists
    if owns_server and server_obj is not None:
        try:
            async with server_obj:
                return await _tracked_execute()
        except Exception as mcp_exc:
            # MCP connection failed at runtime - fall back to native tools
            print(f"Error initializing MCP server: {mcp_exc}")
            # Re-create agent without MCP
            agent = create_financial_analysis_agent(None, enforce_guardrail=actual_enforce)
            return await _tracked_execute()
    return await _tracked_execute()


__all__ = [
    "FinanceOutput",
    "PolygonDataFetcher",
    "FuturesDataFetcher",
    "POLYGON_BASE_URL",
    "QUANDL_BASE_URL",
    "DEFAULT_TRACE_LABEL",
    "create_financial_analysis_agent",
    "create_polygon_mcp_server",
    "finance_guardrail",
    "run_analysis",
    # tool functions
    "save_analysis_report",
    "read_zonexi_documentation",
    "create_zonexi_strategy",
    "get_polygon_options_snapshot",
    "get_polygon_option_contract_snapshot",
    "get_polygon_ticker_sentiment",
    "get_ranked_options",
    "get_fred_series",
    "get_fred_release_calendar",
    "get_polygon_option_quotes",
    "get_polygon_option_trades",
    "get_polygon_intraday_aggregates",
    "get_polygon_4h_bars",
    "get_futures_daily_aggregates",
    "get_futures_4h_bars",
    "get_polygon_exchanges",
    "get_polygon_earnings",
    "get_polygon_dividends",
    "get_polygon_financials",
    "get_capitol_trades",
    # Lab integration
    "create_lab_strategy",
    "backtest_screener_strategy",
    "request_strategy_handoff",
    "scan_best_0dte_candidates",
    # Lab Code Assistant (Phase 1)
    "generate_strategy_code",
    "analyze_strategy_code",
    "explain_strategy_code",
    # helper
    "InputGuardrailTripwireTriggered",
]

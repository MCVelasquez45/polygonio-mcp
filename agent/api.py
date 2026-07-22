"""FastAPI service exposing the Polygon market analysis agent."""

from __future__ import annotations

import base64
import binascii
import json
import os
import tempfile
from fastapi import FastAPI, HTTPException, Request, status, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Any
import httpx
from openai import AsyncOpenAI

from agents.exceptions import InputGuardrailTripwireTriggered

from core.polygon_agent import run_analysis
from core.sift_router import router as sift_router
from instrumentation import setup_telemetry

app = FastAPI(title="Polygon Market Analysis API", version="1.0.0")
setup_telemetry(app)
app.include_router(sift_router)

from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", status_code=status.HTTP_200_OK)
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "polygon-agent"}


# Deterministic data endpoints for the Node AI orchestrator. These expose the
# same tool functions the MCP agent uses so context packages can be assembled
# server-side without relying on the LLM to invoke tools.
@app.get("/data/capitol-trades", status_code=status.HTTP_200_OK)
async def data_capitol_trades(ticker: str | None = None, limit: int = 10) -> dict[str, Any]:
    from core.polygon_agent import get_capitol_trades

    try:
        result = await get_capitol_trades(n=max(1, min(limit, 50)), ticker=ticker)
        return {"available": True, "data": result}
    except Exception as exc:  # degrade, never 500 — the orchestrator reports the gap
        return {"available": False, "error": str(exc)[:300]}


@app.get("/data/fred-calendar", status_code=status.HTTP_200_OK)
async def data_fred_calendar(limit: int = 25) -> dict[str, Any]:
    from core.polygon_agent import get_fred_release_calendar

    try:
        result = await get_fred_release_calendar(limit=max(1, min(limit, 100)))
        return {"available": True, "data": result}
    except Exception as exc:
        return {"available": False, "error": str(exc)[:300]}


@app.get("/data/earnings", status_code=status.HTTP_200_OK)
async def data_earnings(ticker: str, limit: int = 8) -> dict[str, Any]:
    from core.polygon_agent import get_polygon_earnings

    try:
        result = await get_polygon_earnings(ticker=ticker, limit=max(1, min(limit, 20)))
        return {"available": True, "data": result}
    except Exception as exc:
        return {"available": False, "error": str(exc)[:300]}


class AnalysisRequest(BaseModel):
    query: str
    session_name: str | None = None
    context: dict[str, Any] | None = None


class AnalysisResponse(BaseModel):
    query: str
    output: str
    session_name: str | None = None


class ExtractionRequest(BaseModel):
    transcript: str
    socket_id: str | None = None


class ExtractionResponse(BaseModel):
    name: str
    description: str
    hypothesis: str
    type: str = "custom"
    trading_method: str = "equities"
    parameters: dict[str, Any]
    parameter_definitions: dict[str, str] = {}
    entry_rules: list[str] = []
    exit_rules: list[str] = []
    risk_management: list[str] = []
    underlying_ticker: str = ""
    contract_selection: dict[str, Any] = {}
    regime_config: dict[str, Any] = {}
    time_rules: list[dict[str, Any]] = []


class AudioTranscriptionRequest(BaseModel):
    audio_base64: str
    filename: str | None = None
    mime_type: str | None = None
    language: str | None = "en"


class CodeGenRequest(BaseModel):
    description: str
    template_type: str | None = "momentum"


class CodeGenResponse(BaseModel):
    code: str


@app.post("/analyze", response_model=AnalysisResponse, status_code=status.HTTP_200_OK)
async def analyze(request: AnalysisRequest) -> AnalysisResponse:
    query = request.query.strip()
    if not query:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Query must not be empty.")

    try:
        result = await run_analysis(query, session_name=request.session_name, context=request.context)
    except InputGuardrailTripwireTriggered as exc:
        reasoning = getattr(getattr(exc, "output_info", None), "reasoning", None)
        detail = reasoning or "Query is not finance-related."
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    final_output = getattr(result, "final_output", result)
    output_text = str(final_output)

    return AnalysisResponse(query=query, output=output_text, session_name=request.session_name)


@app.post("/extract-strategy", response_model=ExtractionResponse, status_code=status.HTTP_200_OK)
async def extract_strategy(request: ExtractionRequest) -> ExtractionResponse:
    transcript = request.transcript.strip()
    if not transcript:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transcript must not be empty.")

    data = await _perform_extraction(transcript)
    return ExtractionResponse(**data)


@app.post("/extract-strategy-async", status_code=status.HTTP_202_ACCEPTED)
async def extract_strategy_async(request: ExtractionRequest, background_tasks: BackgroundTasks):
    transcript = request.transcript.strip()
    socket_id = request.socket_id
    
    if not transcript:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Transcript must not be empty.")

    background_tasks.add_task(process_extraction_background, transcript, socket_id)
    return {"message": "Extraction started in background", "status": "accepted"}


@app.post("/transcribe-audio", status_code=status.HTTP_200_OK)
async def transcribe_audio(request: AudioTranscriptionRequest):
    if not request.audio_base64.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="audio_base64 must not be empty.")

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENAI_API_KEY is not configured on the agent service.",
        )

    try:
        audio_bytes = base64.b64decode(request.audio_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid base64 audio payload.") from exc

    if not audio_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decoded audio payload is empty.")

    filename = (request.filename or "audio-upload.webm").strip() or "audio-upload.webm"
    _, extension = os.path.splitext(filename)
    suffix = extension if extension else ".webm"
    model_name = os.getenv("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe").strip() or "gpt-4o-mini-transcribe"

    temp_file_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(audio_bytes)
            temp_file.flush()
            temp_file_path = temp_file.name

        client = AsyncOpenAI(api_key=api_key)
        with open(temp_file_path, "rb") as audio_file:
            transcription = await client.audio.transcriptions.create(
                model=model_name,
                file=audio_file,
                language=request.language or "en",
                response_format="text",
            )

        transcript_text = transcription if isinstance(transcription, str) else str(transcription)
        transcript_text = transcript_text.strip()
        if not transcript_text:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Transcription service returned empty text.")

        return {"transcript": transcript_text}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Audio transcription failed: {exc}") from exc
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except OSError:
                pass


@app.post("/generate-strategy", response_model=CodeGenResponse, status_code=status.HTTP_200_OK)
async def generate_strategy(request: CodeGenRequest) -> CodeGenResponse:
    description = request.description.strip()
    if not description:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Description must not be empty.")

    prompt = f"Call generate_strategy_code with this description: {description}. Use the ZoneXI framework documentation to ensure it is valid Jesse code."
    
    # We disable guardrails for this technical generation task
    result = await run_analysis(prompt, skip_mcp=True, enforce_guardrail=False)
    
    final_output = getattr(result, "final_output", result)
    output_text = str(final_output).strip()
    
    # Extract code from potential markdown blocks
    import re
    code_match = re.search(r'```python\n(.*?)```', output_text, re.DOTALL)
    if code_match:
        output_text = code_match.group(1)
    elif "class " in output_text and "Strategy" in output_text:
        # Keep as is if it looks like code but lacks blocks
        pass
    else:
        # Fallback: maybe it's just raw text with code inside
        pass

    return CodeGenResponse(code=output_text)


async def _perform_extraction(transcript: str) -> dict[str, Any]:
    """Extract a structured trading strategy using SIFT's extraction engine."""
    import asyncio
    from core.sift_router import TEMPLATES, _configure_provider, _run_extraction

    _configure_provider(None, None)  # OpenAI-only local extraction engine
    fields = TEMPLATES["trading-strategy"]

    try:
        data = await asyncio.to_thread(
            _run_extraction, transcript, fields, "trading-strategy", ""
        )
    except Exception as exc:
        print(f"[AGENT] SIFT extraction failed, falling back to LLM: {exc}")
        return await _perform_extraction_llm_fallback(transcript)

    # Flatten parameters if SIFT returned nested maps
    params = data.get("parameters")
    if isinstance(params, dict):
        flat: dict[str, Any] = {}
        for k, v in params.items():
            if isinstance(v, dict):
                for nk, nv in v.items():
                    flat[f"{k}_{nk}"] = nv
            else:
                flat[k] = v
        data["parameters"] = flat

    if "parameter_definitions" not in data or not isinstance(data.get("parameter_definitions"), dict):
        data["parameter_definitions"] = {}

    for list_field in ("entry_rules", "exit_rules", "risk_management"):
        if list_field not in data or not isinstance(data.get(list_field), list):
            data[list_field] = []
        data[list_field] = [
            " ".join(item.values()) if isinstance(item, dict) else str(item)
            for item in data[list_field]
        ]
    if "type" not in data or not isinstance(data.get("type"), str):
        data["type"] = "custom"

    if "trading_method" not in data or data.get("trading_method") not in ("options", "futures", "equities"):
        t = data.get("type", "custom")
        if t == "futures":
            data["trading_method"] = "futures"
        elif t in ("0dte", "spreads"):
            data["trading_method"] = "options"
        else:
            data["trading_method"] = "equities"

    # Normalize contract_selection defaults
    if not data.get("contract_selection") or not isinstance(data.get("contract_selection"), dict):
        tm = data.get("trading_method", "equities")
        if tm == "options":
            data["contract_selection"] = {
                "contract_type": "call",
                "strike_selection": "atm",
                "dte_min": 7,
                "dte_max": 45,
            }
        elif tm == "futures":
            # Try to infer symbol from the underlying_ticker or strategy name
            ticker = data.get("underlying_ticker", "")
            symbol = ticker.upper() if ticker and ticker.upper() in ("ES", "NQ", "CL", "GC", "YM", "RTY") else "ES"
            data["contract_selection"] = {
                "symbol": symbol,
                "roll_strategy": "volume",
            }
        else:
            data["contract_selection"] = {}

    if not data.get("underlying_ticker") or not isinstance(data.get("underlying_ticker"), str):
        data["underlying_ticker"] = ""

    # Normalize spread_width: default 5 points for credit spreads
    _cs = data.get("contract_selection", {})
    if isinstance(_cs, dict) and _cs.get("spread_strategy") in ("credit_spread", "debit_spread"):
        if not _cs.get("spread_width") or _cs.get("spread_width") == 0:
            _cs["spread_width"] = 5

    # Fix contract_type when regime-based (call_and_put is not valid, default to put)
    if isinstance(_cs, dict) and _cs.get("contract_type") in ("call_and_put", "both", ""):
        _cs["contract_type"] = "put"  # regime_config handles the actual direction

    # Auto-inject default exit time_rules for credit spreads if none exist
    if isinstance(_cs, dict) and _cs.get("spread_strategy") in ("credit_spread", "debit_spread"):
        tr = data.get("time_rules", [])
        if isinstance(tr, list):
            has_profit_target = any(r.get("type") == "profit_target_pct" for r in tr if isinstance(r, dict))
            has_stop_loss = any(r.get("type") == "stop_loss_multiplier" for r in tr if isinstance(r, dict))
            has_proximity = any(r.get("type") == "proximity_exit" for r in tr if isinstance(r, dict))
            if not has_profit_target:
                tr.append({"type": "profit_target_pct", "target_pct": 50})
            if not has_stop_loss:
                tr.append({"type": "stop_loss_multiplier", "multiplier": 2.0})
            if not has_proximity:
                tr.append({"type": "proximity_exit", "pct_to_strike": 0.5, "min_minutes_remaining": 30})
            data["time_rules"] = tr

    # Normalize regime_config
    if not data.get("regime_config") or not isinstance(data.get("regime_config"), dict):
        data["regime_config"] = {}
    else:
        rc = data["regime_config"]
        for key in ("risk_on_tickers", "risk_off_tickers", "leader_tickers"):
            val = rc.get(key, "")
            if isinstance(val, str):
                rc[key] = [t.strip() for t in val.split(",") if t.strip()]
            elif not isinstance(val, list):
                rc[key] = []

    # Normalize time_rules
    if not data.get("time_rules") or not isinstance(data.get("time_rules"), list):
        data["time_rules"] = []

    return data


async def _perform_extraction_llm_fallback(transcript: str) -> dict[str, Any]:
    """Fallback extraction using the raw LLM agent when SIFT is unavailable."""
    prompt = f"""Extract a structured trading strategy from the following transcript.

Return ONLY valid JSON with these keys:
- "name": short strategy name (string)
- "description": one-paragraph description of the strategy (string)
- "hypothesis": the core trading hypothesis being tested (string)
- "type": one of "momentum", "mean_reversion", "volatility", "0dte", "spreads", "futures", or "custom" (string)
- "trading_method": one of "options", "futures", or "equities" — the instrument class being traded (string). Use "options" for any strategy involving options contracts (credit spreads, iron condors, straddles, 0DTE, puts, calls). Use "futures" for futures contracts (ES, NQ, CL, etc.). Use "equities" for stock/ETF strategies.
- "parameters": flat key-value object where every value is a string, number, or boolean — NOT nested objects. Use snake_case keys.
- "parameter_definitions": object mapping each parameter key to a plain-English definition.
- "entry_rules": array of strings, each describing a condition that must be true before placing a trade.
- "exit_rules": array of strings, each describing an exit rule, stop-loss condition, or profit-taking trigger.
- "risk_management": array of strings, each describing a risk management rule (position sizing, max daily loss, drawdown limits, etc.).

IMPORTANT:
- All parameter values must be primitives (string, number, boolean). Do NOT nest objects.
- For complex rules, break them into separate flat parameters with descriptive names.
- entry_rules, exit_rules, and risk_management must be arrays of plain-English rule strings.

Transcript:
{transcript}"""

    import re

    result = await run_analysis(prompt, skip_mcp=True, enforce_guardrail=False)
    final_output = getattr(result, "final_output", result)
    output_text = str(final_output).strip()

    json_match = re.search(r'(\{.*\})', output_text, re.DOTALL)
    if json_match:
        output_text = json_match.group(1)

    try:
        data = json.loads(output_text)
    except Exception as exc:
        raise ValueError(f"Failed to parse agent output as JSON: {output_text}") from exc

    if "parameter_definitions" not in data:
        data["parameter_definitions"] = {}
    for list_field in ("entry_rules", "exit_rules", "risk_management"):
        if list_field not in data or not isinstance(data.get(list_field), list):
            data[list_field] = []
        data[list_field] = [
            " ".join(item.values()) if isinstance(item, dict) else str(item)
            for item in data[list_field]
        ]
    if "type" not in data or not isinstance(data.get("type"), str):
        data["type"] = "custom"

    if "trading_method" not in data or data.get("trading_method") not in ("options", "futures", "equities"):
        t = data.get("type", "custom")
        if t == "futures":
            data["trading_method"] = "futures"
        elif t in ("0dte", "spreads"):
            data["trading_method"] = "options"
        else:
            data["trading_method"] = "equities"

    # Normalize contract_selection defaults
    if not data.get("contract_selection") or not isinstance(data.get("contract_selection"), dict):
        tm = data.get("trading_method", "equities")
        if tm == "options":
            data["contract_selection"] = {
                "contract_type": "call",
                "strike_selection": "atm",
                "dte_min": 7,
                "dte_max": 45,
            }
        elif tm == "futures":
            # Try to infer symbol from the underlying_ticker or strategy name
            ticker = data.get("underlying_ticker", "")
            symbol = ticker.upper() if ticker and ticker.upper() in ("ES", "NQ", "CL", "GC", "YM", "RTY") else "ES"
            data["contract_selection"] = {
                "symbol": symbol,
                "roll_strategy": "volume",
            }
        else:
            data["contract_selection"] = {}

    if not data.get("underlying_ticker") or not isinstance(data.get("underlying_ticker"), str):
        data["underlying_ticker"] = ""

    # Normalize spread_width: default 5 points for credit spreads
    _cs = data.get("contract_selection", {})
    if isinstance(_cs, dict) and _cs.get("spread_strategy") in ("credit_spread", "debit_spread"):
        if not _cs.get("spread_width") or _cs.get("spread_width") == 0:
            _cs["spread_width"] = 5

    # Fix contract_type when regime-based (call_and_put is not valid, default to put)
    if isinstance(_cs, dict) and _cs.get("contract_type") in ("call_and_put", "both", ""):
        _cs["contract_type"] = "put"  # regime_config handles the actual direction

    # Auto-inject default exit time_rules for credit spreads if none exist
    if isinstance(_cs, dict) and _cs.get("spread_strategy") in ("credit_spread", "debit_spread"):
        tr = data.get("time_rules", [])
        if isinstance(tr, list):
            has_profit_target = any(r.get("type") == "profit_target_pct" for r in tr if isinstance(r, dict))
            has_stop_loss = any(r.get("type") == "stop_loss_multiplier" for r in tr if isinstance(r, dict))
            has_proximity = any(r.get("type") == "proximity_exit" for r in tr if isinstance(r, dict))
            if not has_profit_target:
                tr.append({"type": "profit_target_pct", "target_pct": 50})
            if not has_stop_loss:
                tr.append({"type": "stop_loss_multiplier", "multiplier": 2.0})
            if not has_proximity:
                tr.append({"type": "proximity_exit", "pct_to_strike": 0.5, "min_minutes_remaining": 30})
            data["time_rules"] = tr

    # Normalize regime_config
    if not data.get("regime_config") or not isinstance(data.get("regime_config"), dict):
        data["regime_config"] = {}
    else:
        rc = data["regime_config"]
        for key in ("risk_on_tickers", "risk_off_tickers", "leader_tickers"):
            val = rc.get(key, "")
            if isinstance(val, str):
                rc[key] = [t.strip() for t in val.split(",") if t.strip()]
            elif not isinstance(val, list):
                rc[key] = []

    # Normalize time_rules
    if not data.get("time_rules") or not isinstance(data.get("time_rules"), list):
        data["time_rules"] = []

    return data


async def process_extraction_background(transcript: str, socket_id: str | None):
    try:
        data = await _perform_extraction(transcript)
        
        # Notify Node.js server
        server_url = "http://localhost:4000/api/lab/notify-extraction"
        async with httpx.AsyncClient() as client:
            payload = {
                "socketId": socket_id,
                "data": data,
                "status": "completed"
            }
            await client.post(server_url, json=payload)
            print(f"[AGENT] Extraction complete for {socket_id}, notified server.")
            
    except Exception as e:
        print(f"[AGENT] Background extraction failed: {e}")
        # Notify error
        if socket_id:
            try:
                server_url = "http://localhost:4000/api/lab/notify-extraction"
                async with httpx.AsyncClient() as client:
                    await client.post(server_url, json={
                        "socketId": socket_id,
                        "status": "error",
                        "error": str(e)
                    })
            except:
                pass


class RuleInterpretationRequest(BaseModel):
    entry_rules: list[str] = []
    exit_rules: list[str] = []
    risk_management: list[str] = []
    parameters: dict[str, Any] = {}
    context: dict[str, Any] = {}


class RuleInterpretationResponse(BaseModel):
    signal: int  # -1, 0, 1
    reasoning: str
    confidence: float


@app.post("/interpret-rules", response_model=RuleInterpretationResponse, status_code=status.HTTP_200_OK)
async def interpret_rules(request: RuleInterpretationRequest) -> RuleInterpretationResponse:
    """AI fallback for the hybrid signal engine. Interprets strategy rules against market context."""
    ctx = request.context
    bar = ctx.get("bar", {})

    prompt = (
        "You are a trading signal generator for a backtesting engine. "
        "Given strategy rules and current market state, determine the signal.\n\n"
        f"ENTRY RULES: {json.dumps(request.entry_rules)}\n"
        f"EXIT RULES: {json.dumps(request.exit_rules)}\n"
        f"RISK MANAGEMENT: {json.dumps(request.risk_management)}\n"
        f"PARAMETERS: {json.dumps(request.parameters)}\n\n"
        f"MARKET STATE:\n"
        f"  Bar: {bar.get('timestamp', 'N/A')} O={bar.get('open', 0):.2f} H={bar.get('high', 0):.2f} "
        f"L={bar.get('low', 0):.2f} C={bar.get('close', 0):.2f}\n"
        f"  Position: {'LONG' if ctx.get('position') == 1 else 'SHORT' if ctx.get('position') == -1 else 'FLAT'}\n"
        f"  Entry Price: {ctx.get('entryPrice', 0):.2f}\n"
        f"  SMA: {ctx.get('sma', 0):.2f}, EMA: {ctx.get('ema', 0):.2f}, "
        f"RSI: {ctx.get('rsi', 50):.1f}, ATR: {ctx.get('atr', 0):.2f}\n"
        f"  Equity: ${ctx.get('equity', 0):.0f} (Peak: ${ctx.get('peakEquity', 0):.0f})\n\n"
        "Respond with ONLY a JSON object: {\"signal\": 1, \"reasoning\": \"...\", \"confidence\": 0.8} "
        "where signal is 1 (long), -1 (short), or 0 (flat/exit)."
    )

    try:
        result = await run_analysis(prompt, skip_mcp=True, enforce_guardrail=False)
        final_output = str(getattr(result, "final_output", result)).strip()

        # Extract JSON from the response
        import re as _re
        json_match = _re.search(r'\{[^}]*"signal"[^}]*\}', final_output)
        if json_match:
            parsed = json.loads(json_match.group(0))
            return RuleInterpretationResponse(
                signal=int(parsed.get("signal", 0)),
                reasoning=str(parsed.get("reasoning", "AI interpretation")),
                confidence=float(parsed.get("confidence", 0.5)),
            )

        # If no JSON found, try to infer signal from text
        lower = final_output.lower()
        if "long" in lower or "buy" in lower:
            return RuleInterpretationResponse(signal=1, reasoning=final_output[:200], confidence=0.4)
        elif "short" in lower or "sell" in lower:
            return RuleInterpretationResponse(signal=-1, reasoning=final_output[:200], confidence=0.4)
        else:
            return RuleInterpretationResponse(signal=0, reasoning=final_output[:200], confidence=0.3)

    except Exception as exc:
        return RuleInterpretationResponse(
            signal=0,
            reasoning=f"AI fallback error: {str(exc)[:100]}",
            confidence=0.0,
        )


@app.post("/v1/chat/completions")
async def chat_completions(request: Request) -> JSONResponse:
    """Expose run_analysis via an OpenAI-compatible endpoint for LM Studio or other clients."""
    body = await request.json()
    messages = body.get("messages") or []
    if not messages:
        return JSONResponse({"error": "messages array required"}, status_code=status.HTTP_400_BAD_REQUEST)

    user_prompt = messages[-1].get("content", "").strip()
    if not user_prompt:
        return JSONResponse(
            {"error": "latest message has no content"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    session_name = body.get("session_name")
    context = body.get("context")

    try:
        result = await run_analysis(user_prompt, session_name=session_name, context=context)
    except InputGuardrailTripwireTriggered as exc:
        reasoning = getattr(getattr(exc, "output_info", None), "reasoning", None)
        detail = reasoning or "Query is not finance-related."
        return JSONResponse({"error": detail}, status_code=status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR)

    final_output = getattr(result, "final_output", result)
    return JSONResponse(
        {
            "id": "chatcmpl-local",
            "object": "chat.completion",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": str(final_output)},
                    "finish_reason": "stop",
                }
            ],
        }
    )


# ── Backtest executor endpoint ────────────────────────────────────────────────

from core.backtest_executor import BacktestRequest, BacktestResponse, execute_backtest  # noqa: E402


@app.post("/backtest", response_model=BacktestResponse, status_code=status.HTTP_200_OK)
async def run_backtest(request: BacktestRequest) -> BacktestResponse:
    """Run a strategy backtest using real market data. Supports equities, options, and futures."""
    try:
        return await execute_backtest(request)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Backtest execution failed: {exc}",
        )

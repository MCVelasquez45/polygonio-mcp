"""SIFT extraction endpoints — shared service for cross-project structured data extraction."""

from __future__ import annotations

import asyncio
import os
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from core.sift_openai_provider import OpenAIProvider

router = APIRouter(prefix="/sift", tags=["sift"])

# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SiftField(BaseModel):
    id: str
    type: str = "text"
    prompt: str


class SiftExtractRequest(BaseModel):
    transcript: str
    fields: list[SiftField]
    phase_name: str = ""
    context: str = ""
    provider: str | None = None
    model: str | None = None


class SiftExtractResponse(BaseModel):
    data: dict[str, Any]
    provider: str
    model: str


class SiftTemplateExtractRequest(BaseModel):
    transcript: str
    template: str = "trading-strategy"
    context: str = ""
    provider: str | None = None
    model: str | None = None


class SiftTemplateExtractResponse(BaseModel):
    data: dict[str, Any]
    template: str
    provider: str
    model: str


class SiftProviderInfo(BaseModel):
    name: str
    available: bool
    model: str | None = None


# ---------------------------------------------------------------------------
# Built-in templates — reusable extraction field sets
# ---------------------------------------------------------------------------

TEMPLATES: dict[str, list[dict[str, str]]] = {
    "trading-strategy": [
        {
            "id": "name",
            "type": "text",
            "prompt": "A short, descriptive name for the trading strategy discussed in the transcript.",
        },
        {
            "id": "description",
            "type": "text",
            "prompt": "A one-paragraph description of the strategy: what it does, when it trades, and its edge.",
        },
        {
            "id": "hypothesis",
            "type": "text",
            "prompt": "The core trading hypothesis being tested — the market belief the strategy relies on.",
        },
        {
            "id": "type",
            "type": "text",
            "prompt": (
                "Classify the strategy as one of: momentum, mean_reversion, volatility, "
                "0dte, spreads, futures, or custom. Pick the single best fit."
            ),
        },
        {
            "id": "trading_method",
            "type": "text",
            "prompt": (
                "Determine the primary instrument class this strategy trades. "
                "Return exactly one of: options, futures, or equities. "
                "If the strategy involves options (credit spreads, iron condors, straddles, 0DTE, "
                "puts, calls, verticals, butterflies, or any options contracts), return 'options'. "
                "If the strategy involves futures contracts (ES, NQ, CL, GC, etc.), return 'futures'. "
                "Otherwise return 'equities'."
            ),
        },
        {
            "id": "parameters",
            "type": "map",
            "prompt": (
                "Extract ALL tuneable parameters of the strategy as a FLAT key-value map. "
                "Every value must be a primitive (string, number, or boolean) — never nest objects. "
                "Use snake_case keys. For time values use strings like '09:30'. "
                "For boolean conditions use true/false. "
                "Break complex rules into separate flat parameters with descriptive names."
            ),
        },
        {
            "id": "parameter_definitions",
            "type": "map",
            "prompt": (
                "For EVERY key in the parameters map above, write a plain-English definition "
                "explaining what the parameter means and why it matters for the strategy. "
                "Keys must match the parameter keys exactly."
            ),
        },
        {
            "id": "entry_rules",
            "type": "list",
            "prompt": "List every entry rule or condition that must be true before placing a trade.",
        },
        {
            "id": "exit_rules",
            "type": "list",
            "prompt": "List every exit rule, stop-loss condition, or profit-taking trigger.",
        },
        {
            "id": "risk_management",
            "type": "list",
            "prompt": "List any risk management rules: position sizing, max daily loss, drawdown limits, etc.",
        },
        {
            "id": "underlying_ticker",
            "type": "text",
            "prompt": "The primary underlying ticker symbol this strategy trades (e.g. SPY, AAPL, QQQ for equities/options or ES, NQ, CL, GC for futures). Infer from context if not explicitly mentioned.",
        },
        {
            "id": "contract_selection",
            "type": "map",
            "prompt": "For options strategies: extract contract_type (call or put), strike_selection (atm, otm_1, otm_2, itm_1, or delta_target), delta_target (number if applicable), dte_min (integer minimum days to expiry), dte_max (integer maximum days to expiry), spread_strategy (credit_spread, debit_spread, iron_condor, or single_leg), spread_width (integer points between legs if multi-leg), short_leg_delta (target delta for the short leg if applicable). For futures strategies: extract symbol (ES, NQ, CL, GC), roll_strategy (volume, calendar, or open_interest). Return an empty map for equities strategies. Use snake_case keys only.",
        },
        {
            "id": "regime_config",
            "type": "map",
            "prompt": "If the strategy adjusts trade direction based on market regime, risk-on/risk-off conditions, or sector rotation, extract: risk_on_tickers (comma-separated ETF tickers indicating risk-on like XLK,XLF,XLY,SMH,ARKK), risk_off_tickers (comma-separated ETF tickers indicating risk-off like XLP,XLV,XLC,XLU), leader_tickers (comma-separated mega-cap leaders like NVDA,AAPL,MSFT,GOOG,AMZN,META,TSLA), risk_on_action (put_credit_spread or call_credit_spread — what to do when risk-on), risk_off_action (call_credit_spread or put_credit_spread — what to do when risk-off). Return an empty map if the strategy does not use regime-based direction."
        },
        {
            "id": "time_rules",
            "type": "list",
            "prompt": "Extract any time-based trading rules as structured items. Each item should have: type (one of: time_window, time_before_close, profit_target_pct, hold_until_close), and relevant values: start_time (HH:MM ET), end_time (HH:MM ET), minutes_before_close (integer), target_pct (number, e.g. 50 for close at 50% max profit). Return an empty list if no time-based rules are mentioned."
        },
    ],
    "meeting-notes": [
        {
            "id": "title",
            "type": "text",
            "prompt": "A short title summarising the meeting topic.",
        },
        {
            "id": "attendees",
            "type": "list",
            "prompt": "Names or roles of people who participated in the meeting.",
        },
        {
            "id": "key_decisions",
            "type": "list",
            "prompt": "Decisions made during the meeting.",
        },
        {
            "id": "action_items",
            "type": "list",
            "prompt": "Action items with owner and due date if mentioned.",
        },
        {
            "id": "summary",
            "type": "text",
            "prompt": "A concise summary of the full meeting.",
        },
    ],
    "user-interview": [
        {
            "id": "participant",
            "type": "text",
            "prompt": "Name or role of the interview participant.",
        },
        {
            "id": "pain_points",
            "type": "list",
            "prompt": "User pain points and frustrations expressed during the interview.",
        },
        {
            "id": "feature_requests",
            "type": "list",
            "prompt": "Feature requests or suggestions the participant made.",
        },
        {
            "id": "positive_feedback",
            "type": "list",
            "prompt": "Things the participant praised or found valuable.",
        },
        {
            "id": "quotes",
            "type": "list",
            "prompt": "Direct, notable quotes from the participant.",
        },
        {
            "id": "summary",
            "type": "text",
            "prompt": "Overall summary of the interview and key takeaways.",
        },
    ],
}


# ---------------------------------------------------------------------------
# Provider helpers
# ---------------------------------------------------------------------------

def _configure_provider(provider_name: str | None, model_name: str | None) -> None:
    """Set environment variables for the active (OpenAI-only) provider/model."""
    if provider_name and provider_name != "openai":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown provider '{provider_name}'. Available: openai",
        )

    if model_name:
        os.environ["SIFT_MODEL"] = model_name


def _get_provider_info() -> tuple[str, str]:
    """Return (provider_name, model_name) for the active provider."""
    provider = OpenAIProvider()
    return provider.name, provider.model


def _run_extraction(transcript: str, fields: list[dict], phase_name: str, context: str) -> dict:
    """Synchronous wrapper around the local extraction engine."""
    from core.sift_engine import extract_structured_data
    return extract_structured_data(
        transcript=transcript,
        extraction_fields=fields,
        phase_name=phase_name,
        context=context,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/extract", response_model=SiftExtractResponse)
async def sift_extract(request: SiftExtractRequest) -> SiftExtractResponse:
    """Stateless structured extraction with custom fields."""
    transcript = request.transcript.strip()
    if not transcript:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="transcript must not be empty.")
    if not request.fields:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="fields list must not be empty.")

    _configure_provider(request.provider, request.model)
    fields = [f.model_dump() for f in request.fields]

    try:
        data = await asyncio.to_thread(
            _run_extraction, transcript, fields, request.phase_name, request.context
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    provider_name, model_name = _get_provider_info()
    return SiftExtractResponse(data=data, provider=provider_name, model=model_name)


@router.post("/extract-template", response_model=SiftTemplateExtractResponse)
async def sift_extract_template(request: SiftTemplateExtractRequest) -> SiftTemplateExtractResponse:
    """Extract using a built-in template (trading-strategy, meeting-notes, etc.)."""
    transcript = request.transcript.strip()
    if not transcript:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="transcript must not be empty.")

    template_name = request.template.strip()
    if template_name not in TEMPLATES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown template '{template_name}'. Available: {list(TEMPLATES.keys())}",
        )

    _configure_provider(request.provider, request.model)
    fields = TEMPLATES[template_name]

    try:
        data = await asyncio.to_thread(
            _run_extraction, transcript, fields, template_name, request.context or ""
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    provider_name, model_name = _get_provider_info()
    return SiftTemplateExtractResponse(
        data=data, template=template_name, provider=provider_name, model=model_name
    )


@router.get("/templates")
async def sift_list_templates() -> dict[str, Any]:
    """List all available extraction templates and their fields."""
    return {
        "templates": {
            name: {
                "fields": fields,
                "field_count": len(fields),
            }
            for name, fields in TEMPLATES.items()
        }
    }


@router.get("/templates/{template_name}")
async def sift_get_template(template_name: str) -> dict[str, Any]:
    """Get a single template definition."""
    if template_name not in TEMPLATES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template '{template_name}' not found. Available: {list(TEMPLATES.keys())}",
        )
    return {"template": template_name, "fields": TEMPLATES[template_name]}


@router.get("/providers")
async def sift_list_providers() -> dict[str, Any]:
    """List available AI providers and their status."""
    provider = OpenAIProvider()
    info = SiftProviderInfo(name=provider.name, available=provider.is_available(), model=provider.model)
    return {"providers": [info.model_dump()]}

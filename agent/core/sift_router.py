"""SIFT extraction endpoints — shared service for cross-project structured data extraction."""

from __future__ import annotations

import asyncio
import os
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

# Register the custom OpenAI provider so OPENAI_API_KEY works with sift
from core.sift_openai_provider import register as _register_openai
_register_openai()

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
    """Set environment variables so sift picks the right provider/model."""
    from sift.providers import reset_provider
    from sift.core.config_service import get_config_service

    if provider_name:
        os.environ["SIFT_PROVIDER"] = provider_name
    elif "SIFT_PROVIDER" not in os.environ:
        os.environ["SIFT_PROVIDER"] = "openai"

    if model_name:
        os.environ["SIFT_MODEL"] = model_name

    # Force sift to re-read env vars and clear cached provider
    get_config_service().resolve(force=True)
    reset_provider()


def _get_provider_info() -> tuple[str, str]:
    """Return (provider_name, model_name) from the active sift provider."""
    from sift.providers import get_provider
    try:
        p = get_provider()
        return p.name, p.model
    except Exception:
        return os.environ.get("SIFT_PROVIDER", "unknown"), os.environ.get("SIFT_MODEL", "unknown")


def _run_extraction(transcript: str, fields: list[dict], phase_name: str, context: str) -> dict:
    """Synchronous wrapper around sift's extract_structured_data."""
    from sift.engine import extract_structured_data
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
    from sift.providers import PROVIDERS, _register_defaults, reset_provider

    _register_defaults()
    providers = []
    for name in sorted(PROVIDERS.keys()):
        info = SiftProviderInfo(name=name, available=False)
        try:
            instance = PROVIDERS[name]()
            info.available = instance.is_available()
            info.model = instance.model
        except Exception:
            pass
        providers.append(info.model_dump())
    reset_provider()
    return {"providers": providers}

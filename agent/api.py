"""FastAPI service exposing the Polygon market analysis agent."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Any

from agents.exceptions import InputGuardrailTripwireTriggered

from core.polygon_agent import run_analysis
from instrumentation import setup_telemetry

app = FastAPI(title="Polygon Market Analysis API", version="1.0.0")
setup_telemetry(app)

from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalysisRequest(BaseModel):
    query: str
    session_name: str | None = None
    context: dict[str, Any] | None = None


class AnalysisResponse(BaseModel):
    query: str
    output: str
    session_name: str | None = None


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

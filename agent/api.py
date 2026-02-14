"""FastAPI service exposing the Polygon market analysis agent."""

from __future__ import annotations

import json
from fastapi import FastAPI, HTTPException, Request, status, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Any
import httpx

from agents.exceptions import InputGuardrailTripwireTriggered

from core.polygon_agent import run_analysis
from instrumentation import setup_telemetry

app = FastAPI(title="Polygon Market Analysis API", version="1.0.0")
setup_telemetry(app)

from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
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


class ExtractionRequest(BaseModel):
    transcript: str
    socket_id: str | None = None


class ExtractionResponse(BaseModel):
    name: str
    description: str
    hypothesis: str
    parameters: dict[str, Any]


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
    prompt = f"Call extract_strategy_parameters with this transcript: {transcript}"
    
    # We disable guardrails for this technical extraction task to avoid false positives
    result = await run_analysis(prompt, skip_mcp=True, enforce_guardrail=False)
    
    final_output = getattr(result, "final_output", result)
    output_text = str(final_output).strip()
    
    # Extract JSON from potential conversational text
    import re
    json_match = re.search(r'(\{.*\})', output_text, re.DOTALL)
    if json_match:
        output_text = json_match.group(1)

    try:
        return json.loads(output_text)
    except Exception as exc:
        raise ValueError(f"Failed to parse agent output as JSON: {output_text}") from exc


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

# AI Features and Prompt Inventory

This document outlines every AI feature available in the trading stack, how to customize and automate it, and where each system prompt lives in the architecture.

## 1) Architecture Overview (Single-Instance)

Data + prompt flow (server-owned, enterprise pattern):

```
Client UI
  -> Node API (Express)
     -> Python Agent (FastAPI / OpenAI Agents SDK)
        -> MCP Polygon + FRED tools
        -> Structured response back to Node
  -> Client renders (no prompt logic in the UI)
```

Prompt ownership:
- Python agent core owns the base system prompt, guardrails, and tool policy.
- Node server owns feature-specific prompts (desk insight, watchlist reports, contract selection, contract summary, report saving).
- Client owns only user-facing prompt templates (quick prompts), not system prompts.

## 2) AI Feature Inventory

Each feature includes the entrypoint, server module, and prompt source.

### AI Desk Chat
- Entry: `POST /api/chat`
- Client: `client/src/components/chat/ChatDock.tsx`, `client/src/components/chat/ChatBot.tsx`
- Server: `server/src/features/conversations/chat.routes.ts`
- AI service: `server/src/features/assistant/agentClient.ts` -> FastAPI `/v1/chat/completions`
- Prompt source: base agent system prompt in `agent/core/polygon_agent.py`
- Notes: Context payload is attached (symbol, chain, timeframe) and forwarded to the agent.

### AI Desk Insight (Latest Insight card + Portfolio sentiment)
- Entry: `POST /api/analysis/insight`
- Server: `server/src/features/analysis/deskInsight.ts`
- Prompt source: inline prompt in `server/src/features/analysis/deskInsight.ts`
- Notes: Uses Polygon sentiment + FRED tools when available; falls back to deterministic insight if AI fails.

### AI Watchlist Scanner
- Entry: `POST /api/analysis/watchlist`
- Server: `server/src/features/options/services/watchlistReports.ts`
- Prompt source: inline prompt in `server/src/features/options/services/watchlistReports.ts`
- Notes: Falls back to snapshot-derived summaries if AI is offline.

### AI Contract Selection (Options Chain)
- Entry: `POST /api/analysis/contract-select`
- Server: `server/src/features/analysis/contractSelection.ts`
- Prompt source: `SYSTEM_PROMPT` in `server/src/features/analysis/contractSelection.ts`
- Notes: Returns structured JSON; deterministic fallback if parsing fails.

### AI Contract Summary (Analyze with AI)
- Entry: `POST /api/analysis/contract-summary`
- Server: `server/src/features/analysis/contractSummary.ts`
- Prompt source: `SYSTEM_PROMPT` in `server/src/features/analysis/contractSummary.ts`
- Notes: Returns beginner-friendly JSON explanation; deterministic fallback on failure.

### General AI Analyze Endpoint
- Entry: `POST /api/analyze`
- Server: `server/src/features/assistant/analyze.routes.ts`
- AI service: `agent/api.py` -> `run_analysis()`
- Prompt source: base agent system prompt in `agent/core/polygon_agent.py`
- Notes: Useful for custom automation or internal tooling outside the UI.

### Report Saving (AI Desk Report)
- Entry: `POST /api/chat/report`
- Server: `server/src/features/conversations/chat.routes.ts`
- Prompt source: inline prompt template in `server/src/features/conversations/chat.routes.ts`
- Notes: Calls the `save_analysis_report` tool to persist Markdown.

### 5-Minute Chart Analysis (Deterministic)
- Entry: client-only (no AI call)
- Client: `client/src/App.tsx`
- Notes: Uses local aggregates and rules; kept under AI settings for feature gating but does not call the agent.

## 3) Customization and Automation

### Feature toggles (UI)
AI settings are controlled in the client and stored in localStorage:
- `market-copilot.aiEnabled`
- `market-copilot.aiDeskInsightsEnabled`
- `market-copilot.aiContractSelectionEnabled`
- `market-copilot.aiContractAnalysisEnabled`
- `market-copilot.aiScannerEnabled`
- `market-copilot.aiPortfolioSentimentEnabled`
- `market-copilot.aiChatEnabled`
- `market-copilot.aiChartAnalysisEnabled`

Source: `client/src/App.tsx`

### Server-side AI limits and audit logging
Set limits in `server/src/shared/ai/controls.ts`:
- `AI_RATE_LIMIT_WINDOW_MS`
- `AI_RATE_LIMIT_MAX`
- `AI_DAILY_CALL_LIMIT`
- `AI_MAX_CONCURRENT`
- `AI_MAX_CONCURRENT_PER_USER`

Audit logs are written to Mongo via `server/src/shared/ai/audit.ts` (collection: `ai_request_audit`).

### Agent service configuration
Node -> Python bridge:
- `AGENT_API_URL` / `FASTAPI_URL` / `PYTHON_URL` (defaults to `http://localhost:5001`)

Python agent env (see `agent/env.example`):
- `OPENAI_API_KEY`
- `POLYGON_API_KEY`
- `FRED_API_KEY`
- `FINANCE_AGENT_REPORTS_DIR`
- `FINANCE_AGENT_HISTORY_LIMIT`

### Model selection and tool set
The model is pinned in code:
- `agent/core/polygon_agent.py` -> `OpenAIResponsesModel(model="gpt-5")`
- `server/src/features/assistant/agentClient.ts` (chat payload) -> `model: 'gpt-5'`

To change models, update both locations so analyze + chat stay aligned.

Tool catalog lives in `agent/core/polygon_agent.py` inside `create_financial_analysis_agent()`.

### Automation surfaces
- CLI automation: `agent/main.py` (see `agent/README.md` for scripted usage).
- HTTP automation: `agent/api.py` exposes `/analyze` and `/v1/chat/completions`.
- Internal automation: schedule calls to `POST /api/analysis/watchlist` or `/api/analysis/checklist` for daily desk scans.
- Report automation: call `POST /api/chat/report` to persist AI outputs in Markdown.

## 4) System Prompt Inventory (Authoritative)

These are the system-level or instruction prompts that shape AI behavior. Each entry lists the file path and the prompt text.

### A) Base Agent System Prompt
Location: `agent/core/polygon_agent.py` (`create_financial_analysis_agent()`)

```
Financial analysis agent. Steps:
1. Verify finance-related using guardrail
2. Call Polygon tools precisely; pull the minimal required data.
3. Include disclaimers.
4. Offer to save reports if not asked by the user to save a report.

RULES:
Double-check math; limit news to <=3 articles/ticker in date range.
If the user asks to save a report, save it to the reports folder using the save_analysis_report tool.
When using any polygon.io data tools, be mindful of how much data you pull based on the users input to minimize context being exceeded.
If data unavailable or tool fails, explain gracefully - never fabricate.
TOOLS:
Polygon.io data, save_analysis_report, get_polygon_options_snapshot,
get_polygon_option_contract_snapshot, get_polygon_option_quotes,
get_polygon_option_trades, get_polygon_intraday_aggregates,
get_polygon_exchanges, get_polygon_ticker_sentiment,
get_polygon_earnings, get_polygon_dividends, get_polygon_financials,
get_capitol_trades, get_fred_series, get_fred_release_calendar
Disclaimer: Not financial advice. For informational purposes only.
```

### B) Finance Guardrail Prompt
Location: `agent/core/polygon_agent.py` (`guardrail_agent`)

```
Classify if the user query is finance-related.
Include: stocks, ETFs, crypto, forex, market news, fundamentals, economic indicators, ROI calcs, corporate actions.
Exclude: non-financial topics (cooking, general trivia, unrelated tech).
Disambiguate: if term (e.g., Apple, Tesla) could be both, check for finance context words (price, market, earnings, shares). If unclear, return non-finance.
Output: is_about_finance: bool, reasoning: brief why/why not.
```

### C) Response Formatting Guardrails
Location: `agent/core/polygon_agent.py` (`_formatting_guardrails()`)

```
RESPONSE FORMAT:
- Start with **Summary:** (1-2 sentences)
- Then 3-6 bullet points for key data/reasons
- End with **Conclusion:** (1 short sentence)
- Expand acronyms at least once (e.g., IV = implied volatility)
- Keep the tone concise and trader-friendly
```

### D) Contract Selection System Prompt
Location: `server/src/features/analysis/contractSelection.ts`

```
You are an institutional options selection engine operating within a systematic trading platform.
Your responsibility is to select a SINGLE options contract that optimizes execution quality, liquidity,
and risk-adjusted exposure given the current market context.

SELECTION MANDATE
- Align with directional bias (bullish -> calls, bearish -> puts)
- Prioritize contracts with superior exit liquidity
- Minimize bid-ask friction and slippage
- Favor near-the-money exposure with efficient delta
- Reject contracts that introduce unnecessary execution risk

LIQUIDITY CONSTRAINTS (NON-NEGOTIABLE)
- Reject contracts with wide bid-ask spreads
- Reject contracts with insufficient open interest
- Reject contracts where exit quality is compromised

OUTPUT REQUIREMENTS
Return ONLY valid JSON with:
{
  "selectedContract": string | null,
  "side": "call" | "put" | null,
  "confidence": number | null,
  "reasons": string[],
  "warnings": string[]
}
```

### E) Contract Summary System Prompt
Location: `server/src/features/analysis/contractSummary.ts`

```
You are a beginner-friendly trading explainer.

Your job is to explain a professional options decision in plain language.
Assume the user is learning and needs clarity, not jargon.

OUTPUT (STRICT JSON):
{
  "whatThisTradeDoes": string,
  "whatNeedsToHappen": string[],
  "mainRisks": string[],
  "whyAIChoseThis": string[],
  "riskLevel": string | null
}

Rules:
- Be concise. No filler.
- Avoid jargon; if you mention it, explain it briefly.
- Use the provided numbers only; do not invent data.
- Use decision.reasons and decision.warnings as your sources for "why" and "risks".
- Include 2 to 4 bullets per list at most.
```

### F) Desk Insight System Prompt
Location: `server/src/features/analysis/deskInsight.ts`

```
You are the AI desk for a trading app.
Provide a concise insight for <SYMBOL>.

Use the structured JSON context below. Use your tools to fetch sentiment and Fed calendar data; do not invent values.

Return ONLY valid JSON with this shape:
{"symbol":"AMD","summary":"...","sentiment":{"label":"bullish|bearish|neutral","score":0.1},"fedEvent":{"title":"...","date":"YYYY-MM-DD","impact":"high"},"highlights":["..."]}
Rules:
- summary under 200 characters
- highlights: 2-4 short bullets
- sentiment.score between -1 and 1 (or null if unavailable)
- fedEvent can be null if nothing notable in the next 14 days
- if tools are unavailable, set sentiment and fedEvent to null
- consider shortInterest and shortVolume metrics when framing sentiment or risks
- flag if shortInterest changePct >= 20 or daysToCover >= 5
- flag if shortVolume spike is true or shortVolumeRatio >= 50
- if shortInterest is elevated (changePct >= 20 or daysToCover >= 5), sentiment should lean bearish unless strong positive price action contradicts it
- if shortInterest is falling (changePct <= -20) and daysToCover <= 3, sentiment can lean bullish
```

### G) Watchlist Report System Prompt
Location: `server/src/features/options/services/watchlistReports.ts`

```
You are a market desk assistant. Generate concise option flow notes for the following tickers:
<TICKERS>

Here is structured JSON context for each ticker:
<CONTEXT_JSON>

Return ONLY valid JSON of this shape:
[{"symbol":"SPY","headline":"...", "summary":"...", "sentiment":"bullish","flow":"+4.2M","contract":"O:SPY...", "expiry":"2025-12-19","ivRank":45}]
Keep summaries under 200 characters.
If shortInterest or shortVolume metrics are elevated, mention it in the summary or headline.
Flag shortInterest when changePct >= 20 or daysToCover >= 5.
Flag shortVolume when spike is true or shortVolumeRatio >= 50.
Use the options snapshot (reference contract, volume, open interest) to infer put/call bias when possible.
```

### H) Save Report System Prompt
Location: `server/src/features/conversations/chat.routes.ts`

```
Save a report using the save_analysis_report tool.
Title: <TITLE>
Content:
<CONTENT>
Return only the confirmation string from save_analysis_report.
```

## 5) Client Prompt Templates (Non-System)

Quick prompts that seed user messages in the chat UI:
- Location: `client/src/components/chat/ChatBot.tsx`
- Purpose: presets for common trader questions (e.g., "Explain what is happening on this chart...").

These are user prompts, not system prompts, but they are the only client-controlled prompt text in the UI.

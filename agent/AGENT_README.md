# Polygon Market Analysis Agent (Internal Documentation)

This document provides a deep dive into the AI Agent architecture, intended for developers and agents understanding the system internals.

## 1. Project Overview

- **Type**: AI Agent (CLI & API)
- **Engine**: OpenAI Agents SDK (GPT-5) + Model Context Protocol (MCP)
- **Runtime**: Python 3.10+
- **Key Libraries**:
  - `openai-agents`: Core orchestration.
  - `fastapi`: REST interface.
  - `rich`: Console UI formatting.
  - `pydantic`: Data validation.
  - `httpx`: Async HTTP client.

The agent is a specialized financial analyst that uses the Polygon.io MCP server to fetch real-time market data and `gpt-5` to reason about it. It features a "finance-only" guardrail to prevent token waste on non-relevant queries.

## 2. Directory Structure

```
agent/
├── api.py                 # FastAPI application (HTTP entrypoint)
├── main.py                # CLI entrypoint script
├── cli/                   # CLI Implementation
│   ├── app.py             # Event loop & session management
│   └── messages.py        # Rich output formatting
├── core/                  # Core Business Logic
│   └── polygon_agent.py   # Agent factory, Tools, Guardrails, Data Fetching
└── reports/               # Default output directory for generated reports
```

## 3. Architecture & Key Components

### The Agent Core (`core/polygon_agent.py`)
This file is the heart of the application.
- **`PolygonDataFetcher`**: A dedicated helper class that makes direct HTTP calls to Polygon.io for specialized data (options snapshots, sentiment) that might not be fully covered by the generic MCP server or requires custom handling.
- **`create_financial_analysis_agent()`**: The factory function that assembles the agent. It:
  - Configures the `gpt-5` model.
  - Registers the **MCP Client** to talk to the Polygon MCP server.
  - Adds the **Guardrail** (simple prompt-based check) to ensure queries are financial.
  - Registers tools like `save_analysis_report` and `get_ticker_sentiment`.
- **`run_analysis()`**: The unified execution function used by both CLI and API. It handles tracing, session context injection, and error mapping.

### Session Management
- **`SQLiteSession`**: The agent uses a local SQLite database to persist conversation history.
- **History Limit**: Controlled by `FINANCE_AGENT_HISTORY_LIMIT`. Limits the context window to prevent blowing up token usage on long-running sessions.

### Interfaces
1.  **CLI (`cli/app.py`)**:
    - Manages the lifecycle of the **MCP Server** (stdio).
    - Runs a `while True` loop collecting input.
    - Renders Markdown responses using `rich`.
2.  **API (`api.py`)**:
    - Exposes a `POST /analyze` endpoint.
    - Designed for stateless HTTP clients but supports `session_name` to link turns.

## 4. Data Flow

1.  **User Input** -> `run_analysis(query)`
2.  **Guardrail**: Is this financial? -> If No, abort.
3.  **Agent Loop**:
    - GPT-5 decides it needs data (e.g., "Get SPY price").
    - **MCP Call**: Agent sends tool call to Polygon MCP Server (via stdio).
    - **Polygon API**: MCP Server fetches data.
    - **Response**: Data returned to Agent.
4.  **Reasoning**: Agent analyzes data.
5.  **Output**: Markdown response returned to user.

## 5. Development Guidelines

### Adding a New Tool
1.  Define the Python function in `core/polygon_agent.py`.
2.  Register it in the `tools=[...]` list within `create_financial_analysis_agent`.
3.  Ensure typing is strict (Pydantic models preferred) for better LLM adherence.

### Debugging
- **Common Error**: `InputGuardrailTripwireTriggered` means the agent refused to answer a non-financial query.
- **Tracing**: The `run_analysis` function wraps execution in a tracing span, useful if you have a tracing backend configured.

### Environment
- Requires `POLYGON_API_KEY` in `.env`.
- Uses `uv` for minimal, fast dependency management.

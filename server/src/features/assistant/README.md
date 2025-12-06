# Assistant Feature

This module is the gateway between the Node API and the external Python MCP/AI
service. It keeps all networking logic in one place so other features can focus
on their own responsibilities.

## Files

| File | Purpose |
| --- | --- |
| `analyze.routes.ts` | Express router that validates `/api/analyze` payloads and forwards them to the agent. |
| `agentClient.ts` | Axios-powered HTTP client reused by both analyze and chat flows. Provides `agentAnalyze` + `agentChat`. |

## Environment

- `PYTHON_URL` – Base URL (default `http://localhost:5001`). Set this to your
  FastAPI deployment when running outside local dev.

## Error Handling

Both helper functions log outgoing/incoming payloads. Errors are re-thrown so
Express error middleware can serialize them consistently.

## Extending

If the agent exposes additional endpoints (e.g., summarization), add new helper
functions in `agentClient.ts` and wire them up through a dedicated router. This
keeps transport concerns co-located with route validation logic.

# Assistant Feature

Bridges to the Python MCP/AI agent:
- `analyze.routes.ts`: validates `/api/analyze` requests and forwards them to the Python service.
- `agentClient.ts`: shared axios client for both analyze and chat flows.

Environment variable `PYTHON_URL` controls the agent host.

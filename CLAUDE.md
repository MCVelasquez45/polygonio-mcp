# Project instructions for AI assistants

## Market data provider: Massive (primary)

This project uses **Massive** (https://massive.com) as its primary market-data
provider during development. Massive exposes a Polygon-compatible REST + WebSocket
API (`https://api.massive.com`, `wss://socket.massive.com`).

**Do not guess how the Massive API works.** Before writing or debugging any
Massive integration code, use Massive's official AI resources as the source of
truth:

1. **Massive MCP server** (configured in `.mcp.json`) — query the live API and
   search endpoints directly. Authenticate once with `/mcp` → `massive` →
   Authenticate (OAuth in the browser; no API key needed). Tools: `search_endpoints`,
   `call_api`, `query_data`.
2. **LLM docs** — `https://massive.com/docs/llms.txt` (index) and
   `https://massive.com/docs/llms-full.txt` (full schemas). Any doc page is also
   available as clean Markdown by appending `.md` (e.g.
   `https://massive.com/docs/rest/stocks/aggregates.md`).
3. **`/massive` skill** (`.claude/skills/massive/SKILL.md`) — conventions and
   common pitfalls for adjusted prices, options symbols, pagination, sessions,
   corporate actions, WebSocket subscriptions, rate limits, and retries.

See **[docs/massive/README.md](docs/massive/README.md)** for the full workflow
and **[docs/massive/GAP_REPORT.md](docs/massive/GAP_REPORT.md)** for the current
audit of the repo's Massive integration and the prioritized fix list.

Where the repo's Massive code lives:
- REST wrapper: `server/src/shared/data/massive.ts` (`massiveGet` + endpoint helpers)
- WebSocket client: `server/src/shared/data/massiveWs.ts`
- Provider abstraction: `server/src/features/marketData/massiveProvider.ts`
- Python (agent/screener) hit the same API via `POLYGON_API_KEY` (same key as
  `MASSIVE_API_KEY`; see docs/massive/README.md).

## Constraints (this repo)

Do not change trading logic, MongoDB schemas, GPT prompts, or evaluation logic
when doing infrastructure/data-provider work. Prefer accuracy against the
current Massive documentation over assumptions.

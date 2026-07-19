# Massive Integration — Developer Workflow

Massive (https://massive.com) is this project's primary market-data provider.
It exposes a **Polygon-compatible** REST + WebSocket API. The same API key works
against both `https://api.massive.com` and `https://api.polygon.io` (verified),
because Massive is a Polygon-compatible gateway — this is why the Python services
read the credential as `POLYGON_API_KEY` while the Node server reads it as
`MASSIVE_API_KEY` (same value; see the environment audit).

The goal of this setup: **future development relies on Massive's official AI
resources instead of assumptions.** Do not guess endpoint shapes — query them.

---

## 1. Massive MCP server (primary tool)

The repo ships a project MCP config at [`.mcp.json`](../../.mcp.json) pointing at
Massive's **remote** MCP server (nothing to install, OAuth per developer):

```json
{ "mcpServers": { "massive": { "type": "http", "url": "https://mcp.massive.com/" } } }
```

**Authenticate once (per developer):**

```
claude          # start Claude Code in the repo
/mcp            # → select "massive" → 1. Authenticate → browser sign-in (OAuth)
```

There is no API key to copy or store — MCP access mirrors your Massive account
entitlements. The server exposes three composable tools:

- `search_endpoints` — find endpoints/functions by natural-language query
- `call_api` — call any Massive REST endpoint (optionally store results in SQLite)
- `query_data` — run SQL (CTEs/window functions) over stored results

> Equivalent one-liner if you prefer the CLI over the checked-in config:
> `claude mcp add --transport http massive https://mcp.massive.com/`

The hosted environment gives each session ~64 MB of working storage and up to 10
concurrent workspaces — ample for typical analysis. Access mirrors your Massive
plan entitlements (e.g. requesting Options data without an Options plan returns an
access-denied error).

**Why remote and not self-hosted:** the sprint calls for no self-hosting unless
there's a clear advantage. The remote server needs zero install, auto-tracks the
latest API, and uses OAuth (no shared secret in the repo). The **self-hosted**
server ([`github.com/massive-com/mcp_massive`](https://github.com/massive-com/mcp_massive))
adds a local data workspace on top of the core tools — store results as in-memory
DataFrames, run SQL against them, and apply built-in financial functions (Greeks,
returns, technical indicators). Only reach for it if you need API-key auth instead
of OAuth, must run offline, or routinely pull very large local datasets:
`uv tool install "mcp_massive @ git+https://github.com/massive-com/mcp_massive@v0.10.0"`
then `claude mcp add massive -e MASSIVE_API_KEY=... -- mcp_massive`.

---

## 2. LLM-friendly documentation

Use these when the MCP isn't enough or you want to read schemas directly. Prefer
`llms.txt` when context is tight, `llms-full.txt` when you need full parameter
and response detail:

The `llms.txt` / `llms-full.txt` pair exists at **every level** of the nav tree —
move higher for a broad view, lower to scope tightly to one category:

| Scope | Index | Full |
| --- | --- | --- |
| Root | `https://massive.com/docs/llms.txt` | `https://massive.com/docs/llms-full.txt` |
| REST | `https://massive.com/docs/rest/llms.txt` | `https://massive.com/docs/rest/llms-full.txt` |
| Stocks | `https://massive.com/docs/rest/stocks/llms.txt` | `https://massive.com/docs/rest/stocks/llms-full.txt` |
| Category | `https://massive.com/docs/rest/stocks/tickers/llms.txt` | `https://massive.com/docs/rest/stocks/tickers/llms-full.txt` |

**Any doc page → Markdown:** append `.md` to the URL, e.g.
`https://massive.com/docs/rest/stocks/aggregates.md`. Fetch these instead of
scraping the rendered site.

Official client libraries (use as production references, not for guessing) —
they handle auth, retries, pagination, and response parsing:

- Python — `https://github.com/massive-com/client-python`
- JavaScript — `https://github.com/massive-com/client-js`
- Go — `https://github.com/massive-com/client-go`
- Kotlin/JVM — `https://github.com/massive-com/client-jvm`

Massive's own guide to these integration options is the **AI Tools Quickstart**
(Docs → AI Tools → Quickstart at `https://massive.com/docs`) — it compares MCP vs.
`llms.txt` vs. direct REST vs. Skills and when to use each.

---

## 3. Recommended workflow for AI-assisted Massive work

1. **Confirm the endpoint first.** `search_endpoints` (MCP) or the section
   `llms.txt`, then the endpoint's `.md` page for exact params/response schema.
2. **Validate against live data.** `call_api` for a real sample response before
   writing parsing code — this is how you catch response-shape drift.
3. **Follow the `/massive` skill** ([`.claude/skills/massive/SKILL.md`](../../.claude/skills/massive/SKILL.md))
   for conventions (adjusted prices, options symbols, pagination, sessions,
   corporate actions, WebSockets, rate limits, retries, common mistakes).
4. **Change runtime code deliberately.** The repo's wrappers live in
   `server/src/shared/data/massive.ts` and `massiveWs.ts`. Reuse `massiveGet`
   rather than calling axios directly.

---

## 4. Where Massive is used in this repo

| Area | File |
| --- | --- |
| REST wrapper (`massiveGet`, aggregates, trades, quotes, chains, snapshots) | `server/src/shared/data/massive.ts` |
| WebSocket client (auth/subscribe, reconnect) | `server/src/shared/data/massiveWs.ts` |
| Provider abstraction (`getStockBars`/`getOptionBars`) | `server/src/features/marketData/massiveProvider.ts` |
| Live feed / chart hub (WS fan-out) | `server/src/features/market/services/liveFeed.ts` |
| Options chain / checklist / watchlist consumers | `server/src/features/options/services/*` |
| Backtests | `server/src/features/strategy/backtest/*`, `agent/core/backtest_executor.py` |
| Python direct REST (agent + screener) | `agent/core/polygon_agent.py`, `python-screener-service/screener.py` |

See [GAP_REPORT.md](GAP_REPORT.md) for the endpoint-by-endpoint audit and fixes.

## 5. Subscription profile: Options Advanced

The account attached to this repo is **Options Advanced**: real-time options
(REST + WebSocket, greeks/IV/OI, minute+second aggregates), **no real-time
stock entitlement** (stock daily aggregates are DELAYED; current-day stock
intraday returns `NOT_AUTHORIZED`; the stocks WebSocket is not included; the
underlying block inside options snapshots is DELAYED).

Server-side option-chain data is owned by the **Options Market Data
Orchestrator** (`server/src/features/marketData/`): request coalescing,
narrow provider filters, session-aware caching, explicit `ChainCompleteness`,
priority-classed requests, and a single managed options-WS connection. New
consumers must use it — do not call Massive chain/snapshot endpoints directly.

Key environment variables (defaults in parentheses):

- `MASSIVE_SUBSCRIPTION_PROFILE` (`options-advanced`) — gates every stock
  stream/intraday dependency; automation fails closed without a stocks plan.
- `MASSIVE_STOCKS_WS_ENABLED` (`false`) — stocks WS hard switch (requires a
  stocks-entitled profile as well).
- `MASSIVE_ENTITLEMENT_BLOCK_TTL_MS` (6 h) — how long a `NOT_AUTHORIZED`
  endpoint class is blocked from further requests.
- `OPTIONS_CHAIN_CACHE_OPEN_TTL_MS` / `OPTIONS_CHAIN_CACHE_CLOSED_TTL_MS`
  (5 s / 5 min) and `OPTIONS_REFERENCE_CACHE_TTL_MS` (6 h) — orchestrator caches.

Health: `GET /api/market-data/health` and
`GET /api/market-data/options/:underlying/status`.

Full analysis: [docs/market-data/options-advanced-alignment-audit.md](../market-data/options-advanced-alignment-audit.md)
and [docs/market-data/options-advanced-alignment-delivery.md](../market-data/options-advanced-alignment-delivery.md).

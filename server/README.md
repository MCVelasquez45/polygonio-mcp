# Express TypeScript Gateway

## Start
```bash
cd server
npm run dev
```

## Feature Layout

The backend is organized by feature to keep related routes and services together:

* `src/features/market` – charting + Massive integration (aggregates, caching, status worker).
* `src/features/options` – checklist, watchlist analytics, selection persistence, option chain cache.
* `src/features/broker` – Alpaca account/position/order proxies.
* `src/features/analysis` – AI-driven watchlist + checklist REST surface.
* `src/features/assistant` – bridge to the Python agent for /api/analyze.
* `src/features/conversations` – chat + conversation history store.

Shared utilities such as the Mongo helper and Massive client now live under `src/shared`.

## API Routes

* `/api/analyze` → proxies to Python MCP `/analyze`
* `/api/chat` → proxies to Python MCP `/chat`
* `/api/market` → REST surface for Massive option aggregates, SMA, quotes, trades, and contract detail (requires `MASSIVE_API_KEY`)

## Logging

All requests are logged to console:

* `[SERVER]` request start
* `[SERVER]` response received
* `[SERVER]` error caught
* `[SERVER]` WebSocket handshake and disconnect events

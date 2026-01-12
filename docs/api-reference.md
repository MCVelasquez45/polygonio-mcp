# API Reference

This repo exposes a small REST surface so the dashboard, FastAPI brain, and background jobs can stay in sync. Below is the current contract for every HTTP entry point that this build depends on.

> Base URL: `http://localhost:4000`

## Market Data

### `GET /api/market/watchlist`
Fetches live watchlist snapshots (underlyings + contracts). Pass `tickers=SPY,AAPL` to scope the list. Each entry surface fields for price, change, IV, open interest, and the reference contract ticker which the sidebar uses for auto-highlighting.

### `GET /api/market/watchlist?tickers=<symbols>`
Explicit variant used by the trading sidebar when the user toggles symbols. Identical schema to the default route.

### `GET /api/market/aggs`
Parameters: `ticker`, `multiplier`, `timespan`, `window`. Always returns normalized candles with ISO timestamps plus `sessionMeta` fields (`marketClosed`, `usingLastSession`, etc.). The backend caches Massive aggregate responses and serves the UI intervals: `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `1d`. Option 1m charts may switch to live WebSocket aggregates once the socket feed is connected.

### `GET /api/market/options/chain/:ticker`
Resolves the option chain grouped by expiration. Response embeds strikes, legs (calls/puts), and contract metadata (volume, OI, greeks, IV). Used by the chain panel and the entry checklist.

### `GET /api/market/options/expirations/:ticker`
Returns available expiration dates for a ticker so the selectors stay in sync with Massive constraints.

### `POST /api/market/options/selection`
Body: `{ ticker, contract, expiration, strike, type, userId }`. Persists the active contract for the default user session so the backend can hydrate trades/quotes on refresh.

### `GET /api/market/options/selection`
Returns the currently selected contract payload (used for reloads / hydration).

### `GET /api/market/quotes/:contract`
Streams the latest NBBO snapshot (`bid`, `ask`, `mid`, `spread`, `timestamp`).

### `GET /api/market/trades/:contract`
Recent prints for the active option, capped at 100.

### `GET /api/market/watchlist?tickers=<list>`
Same contract as above but used by the watchlist scanner to hydrate multiple names at once.

## WebSocket (Options Live Feed)

Base URL: `ws://localhost:4000` via socket.io (client uses `io()` against the server).

### `live:subscribe`
Payload: `{ symbol: "O:SPY251219C00650000" }`. Subscribes the socket to Massive option streams for that contract.

### `live:unsubscribe`
Payload: `{ symbol: "O:SPY251219C00650000" }`. Stops live events for the contract.

### Server Events
- `live:quote` – NBBO updates for the subscribed contract (`bp`, `ap`, `bs`, `as`, timestamps).
- `live:trades` – trade prints (`p`, `s`, `t`, `x`, `c`).
- `live:agg` – aggregate bars for the subscribed contract (`ev` is `AM` for per-minute, `A` for per-second).

## Analysis & AI

### `POST /api/analysis/watchlist`
Body: `{ symbols: string[] }`. Compiles context (snapshot + cached bars) and calls the FastAPI agent for scanner notes. Falls back to `FALLBACK_ROWS` when FastAPI is offline.

### `POST /api/analysis/checklist`
Body: `{ tickers: string[], force?: boolean }`. Runs the professional options entry checklist for every ticker provided. The Node service gathers Massive aggregates, computes EMAs/support/resistance, inspects the liquid reference contract for Greeks/IV/spread, fetches sentiment + Fed calendar intel from FastAPI (when configured), stores the results in Mongo, and returns `{ results: ChecklistResult[] }`.

### `GET /api/analysis/checklist/:symbol`
Returns the latest cached checklist document for a symbol so the UI (or tooling) can inspect the pass/fail factors without re-running the analysis.

### `GET /api/conversations`
Lists AI desk conversations (title, last updated).

### `GET /api/conversations/:id`
Fetches a single conversation transcript.

### `POST /api/conversations`
Body: `{ title }` to seed a chat thread.

### `POST /api/conversations/:id/messages`
Body: `{ role, content }`. Proxies to the FastAPI/Codex stack and streams assistant responses back to the UI.

## Background Worker (optional)

- `server/src/services/aggregatesWorker.ts` runs when `AGG_WORKER_ENABLED=true`. It pre-warms 1m caches for heavy names and respects Massive rate limits.

## Notes

- All option/aggregate data flows through Mongo caches so that Massive endpoints are shielded from burst traffic.
- Every response includes `fetchedAt` and `cache` metadata so the client can decide whether to show the “Market Closed” banner or frozen state.

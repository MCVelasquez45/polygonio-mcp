# Market Feature

Owns every endpoint under `/api/market`. The goal is to shield the frontend
from Massive.com rate limits by caching, normalizing, and serving data in a
stable format (candles, chains, quotes, trades, metadata).

## Files

| File | Purpose |
| --- | --- |
| `market.routes.ts` | Express router exposing `/aggs`, `/trades`, `/quotes`, option chain helpers, etc. All routes log requests for debugging. |
| `services/aggregatesService.ts` | Fetches option aggregates from Massive, merges them with cached bars, and handles fallback logic (daily vs intraday). |
| `services/marketCache.ts` | Thin Mongo wrapper providing `fetchWithCache` for frequently-hit endpoints. |
| `services/aggregatesStore.ts` | Persists aggregate bars locally to enable cache hits + offline fallbacks. |
| `services/aggregatesWorker.ts` | Optional background worker that pre-populates aggregates for a ticker set. Controlled via env vars. |
| `services/marketStatus.ts` | Provides a normalized market status snapshot (open/closed/after-hours) for UI banners. |
| `services/liveFeed.ts` | Bridges Massive WS channels (trades, quotes, aggregates) to socket.io for the client. |

## Environment Variables

| Variable | Description |
| --- | --- |
| `MASSIVE_API_KEY` / `MASSIVE_BASE_URL` | Credentials + host for Massive.com APIs. Required for live data. |
| `MASSIVE_OPTIONS_WS_URL` | Override the Massive options WS endpoint (default `wss://socket.massive.com/options`). |
| `MASSIVE_OPTIONS_WS_CHANNELS` | Comma-separated WS channels (e.g. `T,Q,AM,A`) for option subscriptions. `AM` streams 1m aggregates; `A` streams 1s aggregates. |
| `MASSIVE_OPTIONS_WS_STORE_AGGS` | When `true`, store live `AM` aggregates into the Mongo cache (defaults to on outside production). |
| `AGG_WORKER_ENABLED` | When `true`, `aggregatesWorker` polls tickers in the background. |
| `AGG_WORKER_TICKERS`, `AGG_WORKER_INTERVAL_MS`, `AGG_WORKER_REQUEST_DELAY_MS` | Fine-tune the worker's behavior. |

## Flow

1. Router validates inputs and delegates to Massive helpers.
2. `fetchWithCache` throttles requests and caches results in Mongo.
3. Aggregates service normalizes responses and caches bars for future requests.
4. When Massive returns empty or rate-limited responses, cached bars or daily
   fallbacks keep charts populated.
5. The optional warm list (`POST /api/market/aggs/warm`) can append tickers to
   the aggregate worker’s polling set for faster local cache hydration.

## Extending

When adding new market endpoints:
1. Add the handler in `market.routes.ts`.
2. Place shared logic under `services/` to keep routes lean.
3. Document any new env vars in `docs/setup-instructions.md` if necessary.

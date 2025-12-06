# Market Feature

Handles option/underlying market data interactions:
- `market.routes.ts`: REST endpoints for aggregates, option chain snapshots, quotes, trades, and metadata.
- `services/aggregatesService.ts`: orchestrates fetching/normalizing Massive aggregates plus caching + fallbacks.
- `services/marketCache.ts`: Mongo-backed cache helpers used for high-churn endpoints.
- `services/aggregatesWorker.ts`: optional polling worker to keep aggregates warm.
- `services/marketStatus.ts`: resolves market open/close state for status banners.

Shared dependencies live under `src/shared` (Mongo + Massive clients).

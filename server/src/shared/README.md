# Shared Utilities

Centralized helpers that power multiple features. Each subfolder groups a
category of shared logic.

## `db/mongo.ts`

- Provides `initMongo`, `getCollection`, and `closeMongo` so features don't
  have to manage their own Mongo connections.
- `initMongo` is called once at server startup; calling it again is safe (no-op).
- Throws descriptive errors when accessed before initialization so misconfigured
  environments fail fast.

## `data/massive.ts`

- Handles everything related to Massive.com: authentication, request queuing,
  automatic retries, caching, and helper methods for common endpoints
  (`getOptionAggregates`, `getMassiveOptionsChain`, etc.).
- Respects a variety of env vars for tuning rate limits and timeouts.

### Massive Environment Variables

| Variable | Description |
| --- | --- |
| `MASSIVE_API_KEY` | Required API key. Requests fail fast if unset. |
| `MASSIVE_BASE_URL` | Override the API host (default `https://api.massive.com`). |
| `MASSIVE_CACHE_TTL_MS` | Default TTL for `massiveGet` cache entries. |
| `MASSIVE_INTRADAY_AGGS_CACHE_TTL_MS` | Cache TTL for intraday aggregate pulls (minute/hour). |
| `MASSIVE_TIMEOUT_MS` | HTTP request timeout for Massive calls. |
| `MASSIVE_MAX_CONCURRENT` | Maximum concurrent HTTP requests. |
| `MASSIVE_MIN_INTERVAL_MS` | Minimum delay between requests (rate limiting). |
| `MASSIVE_MAX_RETRIES` / `MASSIVE_RETRY_BASE_MS` / `MASSIVE_RETRY_MAX_MS` | Control exponential backoff. |
| `MASSIVE_REFERENCE_MAX_PAGES`, `MASSIVE_SNAPSHOT_MAX_PAGES`, `MASSIVE_SNAPSHOT_PAGE_LIMIT`, `MASSIVE_MAX_CHAIN_LIMIT` | Bounds for chain/snapshot pagination. |

Feel free to add more shared modules under `src/shared/<category>` as the
project grows (e.g., `shared/http`, `shared/auth`).

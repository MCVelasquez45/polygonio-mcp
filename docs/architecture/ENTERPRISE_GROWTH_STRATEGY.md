# AI-Trader Enterprise Growth Strategy

Date: 2026-07-25
Baseline: `v1.1-enterprise-baseline`

## Strategy

AI-Trader is entitlement-limited, not capability-limited. The enterprise
baseline uses the current Massive `options-advanced` profile as fully as is
practical without adding subscriptions, APIs, or infrastructure.

The platform should continue to evolve as an options-first trading system:
Massive owns market data, Alpaca owns broker truth and paper execution, MongoDB
owns application state, and the AI agent synthesizes platform evidence without
changing trading rules.

## Current Architecture

```text
React/Vite client
  |-- Trading desk, charts, options matrix, ticket, watchlist
  |-- Portfolio, automation command center, cockpit, health dashboard
  `-- AI desk and trading intelligence views

Node/Express backend
  |-- Massive REST and options WebSocket ownership
  |-- Socket.IO fanout to browser clients
  |-- Automation scheduler, monitor, risk gates, order intents
  |-- Alpaca paper broker REST wrapper
  |-- MongoDB persistence and reporting models
  `-- FastAPI agent proxy and health coalescing

FastAPI agent
  `-- Advisory AI responses and health endpoint

MongoDB Atlas
  `-- Watchlist, automation sessions, intents, reports, journals, conversations
```

## Current Massive Capabilities

Implemented and used:

- Options snapshots for chains, selected contracts, held positions, watchlist
  context, and fallback marks.
- Options trades and quotes through REST hydration and options WebSocket `T` and
  `Q` channels.
- Options aggregate channels and REST aggregates where authorized.
- Greeks, implied volatility, open interest, bid/ask, day stats, expiration,
  strike, and contract metadata from Massive options endpoints.
- Market status through `/v1/marketstatus/now`.
- News and sentiment context for the AI desk where provider data is available.
- Short-interest and short-volume routes for equity context.
- Provider-aware caches, request coalescing, endpoint-class entitlement blocks,
  Retry-After handling, and priority queues.
- Flat-file and historical data remain architecture-approved data sources for
  future offline research jobs, but the production baseline does not require a
  separate worker to be green.

Entitlement boundaries:

- Stocks WebSocket is disabled under `options-advanced`.
- Current-day stock intraday aggregates are not used as a production dependency.
- Underlying-equity data surfaced from options snapshots is labeled delayed or
  snapshot and cannot satisfy live-data claims.

## Enterprise Priorities

1. Keep broker execution governed.
   Alpaca remains paper-only in the certified automation path. Manual and
   automated submissions continue through durable intents, paper/live guards,
   reconciliation, and market/session checks.

2. Keep market data single-owned.
   The backend owns Massive credentials, REST throttling, websocket connections,
   cache freshness, and entitlement fallback. The browser never connects
   directly to Massive.

3. Make health statuses literal.
   Green means the subsystem is actually available for its certified purpose.
   Snapshot-only and delayed data must be labeled as such rather than inflated
   to live status.

4. Let AI consume evidence.
   The agent should synthesize options data, charts, portfolio state, reports,
   news, sentiment, macro/catalyst context, and platform history. It must remain
   advisory unless a future governed automation change explicitly promotes an AI
   decision into the rule set.

5. Optimize within entitlements first.
   Prefer smarter option filtering, caching, chain narrowing, event fanout,
   portfolio enrichment, and reporting over paid data expansion.

## Near-Term Roadmap

- Persist user/account-scoped watchlists while preserving the server watchlist as
  the automation universe source of truth.
- Promote static sidebar intel into real persisted signal, news, and risk events.
- Expand trading intelligence reports to persist full greeks and volatility
  fields for post-trade analytics.
- Add controlled flat-file ingestion for offline research, backtesting, and
  historical feature generation.
- Add production load/soak tests around options subscriptions, quote fanout,
  automation visibility, and broker reconciliation.
- Add operational dashboards for queue depth, cache hit rate, Massive endpoint
  blocks, websocket subscription counts, AI latency, and broker latency.
- Keep production Playwright serialized for hosted verification while Socket.IO
  uses same-origin long polling through Vercel; use separate load/soak suites
  for concurrency validation.

## Roadmap Requiring Additional Entitlements

- Real-time stocks WebSocket streaming.
- Current-day stock intraday aggregates as a strategy input.
- Broader market breadth, sector, rates, commodity, and index feed expansion if
  not available under the current plan.
- Higher provider websocket connection limits if production concurrency exceeds
  the single-connection options design.

## Enterprise Readiness

The v1.1 baseline is ready for enterprise platform development. The final
production deployment proves:

- Local and production Playwright suites are green.
- Server and client tests are green.
- Lint, build, audits, and whitespace checks are green.
- Render backend, Render agent, Vercel frontend, and GitHub reference the same
  tagged release.
- No production blocker remains open.

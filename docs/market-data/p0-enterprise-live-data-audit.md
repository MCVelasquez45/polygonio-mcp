# P0 Enterprise Live Data Audit

Date: 2026-07-21

## Executive Summary

The platform now has one primary client-side subscription path for live market data and one primary server-side owner for provider WebSocket subscriptions.

Streaming is preferred for:

- Option quotes and trades
- Option aggregate candles
- Stock quotes/trades/aggregates when the subscription profile and `MASSIVE_STOCKS_WS_ENABLED` allow it
- Automation visibility / broker truth snapshots over Socket.IO
- Futures paper/engine updates where existing futures sockets are already present

REST remains the source for historical, slow-changing, reference, and entitlement-limited data.

## Source Map

```text
Massive WebSocket
  |
  |-- server/src/shared/data/massiveWs.ts
  |
  |-- Options stream
  |     |
  |     |-- server/src/features/marketData/optionsSubscriptionManager.service.ts
  |     |     |-- Q/T option quotes/trades
  |     |     |-- A/AM option aggregate candles
  |     |     |-- reconnects indefinitely with bounded backoff
  |     |     |-- ref-counts by symbol/kind/consumer
  |     |
  |     |-- server/src/features/marketData/optionsQuoteCache.service.ts
  |     |     |-- latest option quote cache for automation and fallbacks
  |     |
  |     |-- server/src/features/market/services/liveFeed.ts
  |     |     |-- Socket.IO live:quote
  |     |     |-- Socket.IO live:trades
  |     |
  |     |-- server/src/features/market/services/chartHub/index.ts
  |           |-- Socket.IO chart:snapshot
  |           |-- Socket.IO chart:update
  |
  |-- Stocks stream
        |
        |-- server/src/features/market/services/liveFeed.ts
              |-- entitlement-gated by MASSIVE_STOCKS_WS_ENABLED and profile
              |-- disabled under options-advanced profile by default

Massive REST
  |
  |-- server/src/features/market/services/aggregatesService.ts
  |     |-- historical/backfill candles
  |     |-- snapshot fallback candles
  |
  |-- server/src/shared/data/massive.ts
  |     |-- option chains
  |     |-- expirations
  |     |-- contract snapshots
  |     |-- option quote/trade REST fallback
  |     |-- stock previous-close/watchlist snapshots
  |     |-- short interest / short volume
  |
  |-- server/src/features/marketData/optionsMarketDataOrchestrator.service.ts
        |-- option chain cache and completeness metadata

Broker / Automation
  |
  |-- Alpaca REST
  |     |-- account snapshot
  |     |-- positions
  |     |-- orders
  |
  |-- server/src/features/portfolio/automationVisibilitySocket.service.ts
        |-- Socket.IO automation:visibility
        |-- broker account truth
        |-- active trades
        |-- pending orders
        |-- automation timeline

Client Socket.IO
  |
  |-- client/src/lib/socket.ts
        |-- one shared socket for the whole app

Client Live Store
  |
  |-- client/src/lib/liveMarketStore.ts
        |-- latest quotes
        |-- latest trades
        |-- trade histories
        |-- non-reactive request-time reads for AI context

Client Subscription Manager
  |
  |-- client/src/hooks/useCockpitLiveSubscription.ts
        |-- acquireLiveMarketSubscription
        |-- useLiveMarketSubscription
        |-- useLiveMarketSubscriptions
        |-- reconnect resubscribe
        |-- client-side ref-counting
```

## WebSocket Audit

| Feed | Owner | Subscriptions | Reconnect | Duplicate Control | Current Status |
| --- | --- | --- | --- | --- | --- |
| Massive options quotes/trades | `optionsSubscriptionManager.service.ts` | `T,Q` by contract | Yes, indefinite bounded backoff | Server ref-count by symbol/kind/consumer | PASS |
| Massive options aggregates | `optionsSubscriptionManager.service.ts` via `liveFeed.ts` | `A,AM` by focused chart symbol | Yes | Server ref-count by symbol/kind/consumer | PASS |
| Massive stock quotes/trades | `liveFeed.ts` | `T,Q` by symbol | Yes when enabled | Server room membership + client ref-count | ENTITLEMENT GATED |
| Massive stock aggregates | `liveFeed.ts` | `A,AM` by focused chart symbol | Yes when enabled | Chart focus keys by socket | ENTITLEMENT GATED |
| Client Socket.IO | `client/src/lib/socket.ts` | multiplexed app events | Yes | Singleton socket | PASS |
| Client market subscriptions | `useCockpitLiveSubscription.ts` | all market-facing consumers | Yes | Client ref-count | PASS |
| Automation visibility | `automationVisibilitySocket.service.ts` | broker/automation snapshot stream | Socket.IO reconnect | Shared socket listeners | PASS |
| Futures updates | existing futures/lab components | `futures:*` events | Shared socket | Shared socket | EXISTING |

## REST Audit

REST should remain for:

- Historical candle backfill
- Daily aggregates and long chart history
- Expiration dates
- Reference contracts
- Option chain snapshots
- Greeks, implied volatility, open interest, metadata
- Short interest and short volume
- Broker REST account/positions/orders initial load and fallback
- AI source data that is not stream-backed

REST should not be used as the first source for:

- Current option quote marks when a fresh WebSocket quote exists
- Displayed option NBBO in ticket/matrix/ladder/cockpit
- Intraday chart candle updates while a live aggregate stream is active
- Watchlist prices when a stream tick exists and entitlement allows it

## Cache Strategy

Streaming data:

- Stored only in process/UI memory.
- No persistence beyond bounded quote/trade state.
- Examples: quotes, trades, active candle updates, broker visibility snapshots.

Slow-changing data:

- Cached with TTLs or persisted snapshots.
- Examples: expirations, option reference contracts, open interest, greeks, company/watchlist metadata.

Historical data:

- Cached aggressively and backfilled into chart buffers.
- Streaming live candles overlay backfilled bars and win for the active bucket.

## Component Audit

## P0 Live Architecture Fix - 2026-07-21

The stale chart and offline Matrix Depth symptoms had one shared architectural
cause: live entitlement and live quote ownership were split.

```
Massive WebSocket
  stocks: T/Q/A/AM
  options: Q/T/A/AM
        |
        v
Live Market Service
  liveFeed.ts
  optionsSubscriptionManager.service.ts
  optionsQuoteCache.service.ts
  chartHub/index.ts
        |
        +--> chart snapshots/updates -> Charts + indicators
        +--> live quote store -------> Watchlist
        +--> live quote store -------> Header / market context
        +--> live quote store -------> Trading Ticket
        +--> live quote store -------> Matrix Depth / Price Ladder
        +--> live quote cache -------> Automation mark/quote consumers
        +--> client live block ------> AI Context
        +--> scanner/watchlist feeds -> Cockpit
```

Fixes:

- `MASSIVE_STOCKS_WS_ENABLED=true` alone does not imply stock entitlement.
  `MASSIVE_SUBSCRIPTION_PROFILE` must be explicitly set to a stocks-entitled
  profile; otherwise the platform fails closed as `options-advanced`.
- Chart snapshot health now uses the live candle's `lastUpdatedAt`, not the
  candle bucket start. A still-forming 1m/3m/5m/15m/30m/1h candle no longer
  presents as stale while aggregate updates are arriving.
- `live:subscribe` replays the canonical option quote cache to the socket. The
  Trading Ticket and Matrix Depth now bootstrap from the same quote source
  instead of Ticket using REST detail while Matrix waits blank for a tick.
- REST quote fallbacks now hydrate and broadcast from the same canonical quote
  cache, so an existing Matrix subscription receives the same bid/ask/bid-size/
  ask-size update that the Ticket REST fallback just fetched.
- Live validation on 2026-07-21 found the current Massive key does not have
  stocks WebSocket access (`auth_failed: plan doesn't include websocket access`)
  and the options WebSocket is currently blocked by provider `max_connections`.
  The platform now logs and exposes provider status instead of silently
  reconnecting.

| Area | Previous Risk | Current Live Path | Status |
| --- | --- | --- | --- |
| Charts | Live candle freshness could read stale on 15m/30m buckets because age came from bucket start | Live candles now carry `lastUpdatedAt`; chart health uses receipt/update time | PASS |
| 1m/3m/5m/15m/30m/1h charts | REST backfill plus live aggregate updates | `chart:focus` -> server chart hub -> provider `A/AM` -> `chart:update` | PASS when stream entitlement exists |
| Watchlist | REST snapshots only; independent polling made rows look static | Watchlist subscribes all symbols via shared live manager and overlays live quotes over REST snapshots | PASS, stock live is entitlement-gated |
| Watchlist high/low | Not in normalized snapshot type | `dayHigh`/`dayLow` added to snapshot payload and row secondary line | PASS |
| Trading header | Read live store but did not own a subscription | Header subscribes selected underlying through shared manager | PASS |
| Market context bar | Direct subscribe/unsubscribe could collide with other consumers | Uses shared ref-counted subscriptions | PASS |
| Trading ticket | Already read selected contract live quote from store | Active chain/contract subscription is now ref-counted through shared manager | PASS |
| Options matrix | Already read quote/trade maps from live store | Near-money strip subscriptions now use shared manager | PASS |
| Price ladder | Reads live quote/trade/history | Covered by active selected contract subscription | PASS |
| Portfolio | Account strip was REST initial load only | Account summary updates from `automation:visibility` stream, with REST fallback | PASS |
| Automation monitor | Held-contract mark went to REST before checking WebSocket cache | Holds a shared option subscription and uses fresh WebSocket quote cache first | PASS |
| AI desk chat | Context could omit current live quote/trade | Chat payload enriched at send time from live store; agent data package includes client live market state | PASS |
| Cockpit | Existing cockpit quote hooks read shared live store | Subscription manager remains compatible with cockpit hook | PASS |

## UX Semantics

Live values are labeled from actual transport/source state:

- Stream + connected + fresh: `LIVE`
- REST value + fresh: `SNAPSHOT`
- Stream retained but socket down: `DISCONNECTED`
- Any known value older than threshold: `STALE`
- Market closed chart: `Snapshot` / closed-market state

Live chart health no longer becomes stale merely because a still-forming higher-timeframe candle started several minutes ago.

## Validation

| Subsystem | Result | Evidence |
| --- | --- | --- |
| Client build | PASS | `npm --prefix client run build` |
| Server build | PASS | `npm --prefix server run build` |
| Live market store tests | PASS | `npm --prefix client test -- src/__tests__/liveMarketStore.test.ts ...` |
| Socket singleton tests | PASS | same targeted client test run |
| Market data UI status tests | PASS | same targeted client test run |
| Chart hub builder tests | PASS | `node --test tests/chartHub.builder.test.mjs` |
| Server market WS tests | PASS | `node --test tests/marketdata.ws.test.mjs` with localhost bind approval |
| Localhost manual browser | NOT RUN | Build/tests only in this pass |
| Preview deployment | NOT RUN | Not deployed in this pass |
| Production deployment | NOT RUN | Not deployed in this pass |

## Known Entitlement Boundary

The current backend intentionally disables the stock WebSocket under the `options-advanced` profile unless both conditions are true:

- `MASSIVE_STOCKS_WS_ENABLED=true`
- `MASSIVE_SUBSCRIPTION_PROFILE` is explicitly set to a stocks-entitled profile

When those conditions are not met, equity watchlist/header/context rows still subscribe through the same live manager, but the server honestly serves REST snapshot fallback and the UI must not label those equity values live.

## Follow-Up Hardening

- Add a production smoke that asserts no duplicate `live:subscribe` provider frames for repeated UI consumers.
- Add a browser-level memory test around watchlist symbol churn and chart timeframe churn.
- Add a broker streaming integration if Alpaca account updates are available as a true broker push feed in the configured account; current implementation streams the platform's broker-truth snapshot over Socket.IO.

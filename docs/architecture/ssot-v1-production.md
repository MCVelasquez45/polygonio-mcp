# AI-Trader V1 SSOT Architecture

This document is the production stabilization source of truth. It documents data ownership; it is not a feature roadmap.

## Market Data

Massive Options Advanced is the provider for options market data.

```
Massive Options WebSocket
  -> server/src/features/marketData/optionsSubscriptionManager.service.ts
  -> server/src/features/marketData/optionsQuoteCache.service.ts
  -> server/src/features/market/services/liveFeed.ts
  -> Socket.IO
  -> client/src/lib/liveMarketStore.ts
  -> Matrix / Ticket / Time & Sales / Cockpit
```

Rules:

- One provider options WebSocket is owned by `optionsSubscriptionManager.service.ts`.
- Components subscribe to backend Socket.IO only; no React component opens a provider WebSocket.
- Quote and trade events hydrate `optionsQuoteCache.service.ts`.
- Matrix and Ticket consume the same client live store, which is fed by the backend quote cache.
- REST quote/trade endpoints are initial snapshot and fallback only. They must not poll while live Socket.IO data is healthy.
- Options Advanced does not entitle stock WebSocket streaming. Stock WS stays disabled unless `MASSIVE_STOCKS_WS_ENABLED=true` and a stocks-entitled `MASSIVE_SUBSCRIPTION_PROFILE` is configured.

Massive WebSocket contract verified from Massive docs:

- Endpoint: `wss://socket.massive.com/options` for live options; delayed examples use `wss://delayed.massive.com/options`.
- Auth payload: `{ "action": "auth", "params": "<api key>" }`.
- Subscribe payload: `{ "action": "subscribe", "params": "Q.O:SPY...,T.O:SPY..." }`.
- Quote schema: `ev=Q`, `sym`, `bp`, `ap`, `bs`, `as`, `t` Unix ms, `q` sequence.
- Trade schema: `ev=T`, `sym`, `p`, `s`, `x`, `c`, `t` Unix ms, `q` sequence.
- Aggregate schema: `ev=A` / `AM`, OHLCV fields, `s` / `e` Unix ms.
- Quote limit: 1,000 option contracts per connection.

## Broker State

Alpaca paper is the only broker source of truth for:

- Account
- Cash, equity, buying power
- Positions
- Orders
- Order status
- Fills

MongoDB stores application/automation state only. It is never used to infer a broker position. Automation may act only on positions with a proven automation ownership chain.

Alpaca options positions are returned by the standard `/positions` model with `asset_class: "us_option"`. The app may attempt `/options/positions` for SDK compatibility, but a 404 fallback to `/positions` is expected and must filter by `asset_class` or canonical option-symbol shape.

## Symbol Translation

Canonical service: `server/src/shared/symbols/optionSymbol.ts`.

Conversions:

- Massive: `O:SPY260721C00748000`
- Internal canonical: `SPY260721C00748000`
- Alpaca: `SPY260721C00748000`
- Mongo comparison key: `SPY260721C00748000`

No broker, automation, or market-data code should implement local OCC parsing when this service can answer the question.

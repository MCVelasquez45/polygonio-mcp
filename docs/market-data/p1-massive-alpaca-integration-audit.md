# P1 Massive + Alpaca Integration Audit

Date: 2026-07-21

Scope: provider request cleanup, websocket ownership, Alpaca lookup verification,
symbol translation, scanner source-of-truth validation, and repetitive log
cleanup. No trading strategy, automation policy, prompts, Mongo schemas, UI
layout, or order logic changes.

## Canonical Architecture

```
Massive Options Advanced
  |
  | one backend-owned options WebSocket
  | endpoint: wss://socket.massive.com/options
  | auth: {"action":"auth","params":"<api key>"}
  | subscriptions: Q.O:*, T.O:*, AM.O:* / A.O:* only
  v
optionsSubscriptionManager.service.ts
  |
  v
optionsQuoteCache.service.ts
  |------------------|
  |                  |
  v                  v
Quote Cache       Trade Cache
  |                  |
  |------------------|
          |
          v
liveFeed.ts backend Socket.IO broadcaster
          |
          v
React Socket.IO clients
  |        |          |
  v        v          v
Matrix   Ticket   Time & Sales
          |
          v
AI/automation context through backend market-state services
```

Equity symbols such as `SPY`, `QQQ`, `DIA`, and `IWM` are not streamed under
the options-only entitlement. They are handled through REST snapshots and REST
aggregates only.

## Symbol Flow

```
Massive provider symbol
  O:SPY260721C00748000
      |
      v
server/src/shared/symbols/optionSymbol.ts
      |
      | canonical compact OCC
      v
SPY260721C00748000
      |
      | provider adapters
      |-- Massive: O:SPY260721C00748000
      |-- Alpaca:  SPY260721C00748000
      |-- Mongo:   SPY260721C00748000
      v
Automation, portfolio, reconciliation, order submission
```

No component should parse option roots, expirations, call/put side, or provider
prefixes directly. Server-side routing now uses `server/src/shared/symbols/`.

## Massive Integration Audit

Verified documentation:

- Options websocket quotes use `Q.<option ticker>` and emit `ev=Q`, `sym`, bid,
  ask, bid/ask sizes, Unix millisecond timestamp, and sequence number.
- Options websocket trades use `T.<option ticker>` and emit `ev=T`, `sym`, price,
  size, exchange, conditions, Unix millisecond timestamp, and sequence number.
- Options aggregate websocket channels are `AM` and `A`.
- Real-time options endpoint is `wss://socket.massive.com/options`.
- Quote docs state a maximum of 1,000 option contracts per connection.

Subscription audit:

| Component | Backend Service | Massive Channel | Consumer |
| --- | --- | --- | --- |
| Options matrix active contract | `liveFeed` -> `optionsSubscriptionManager` | `Q.O:*`, `T.O:*` | Matrix, ticket, top of book |
| Ticket active contract | `liveFeed` -> `optionsSubscriptionManager` | `Q.O:*`, `T.O:*` | Ticket |
| Time & Sales | `liveFeed` -> `optionsSubscriptionManager` | `T.O:*` | Time & Sales |
| Chart live option aggs | `chartHub` -> `liveFeed` -> `optionsSubscriptionManager` | `AM.O:*` / `A.O:*` | Chart cache/UI |
| Market context bar indexes | `liveFeed` | none under options-only profile | REST-only equity state |
| Trading header underlying | `liveFeed` | none under options-only profile | REST-only equity state |
| Sidebar watchlist equities | `liveFeed` | none under options-only profile | REST snapshots |
| Terminal equity symbol | `liveFeed` | none under options-only profile | REST-only equity state |

Result: `SPY`, `QQQ`, `DIA`, and `IWM` Socket.IO live requests no longer create
Massive stock websocket subscriptions under the options-only profile. The
backend accepts them as `equity_rest_only` and emits one structured
`LIVE_PROVIDER_UNAVAILABLE` event per symbol/channel instead of repeating
`stocks_ws_unavailable_or_not_entitled`.

## Alpaca Integration Audit

Verified documentation:

- Options contract lookup is through `/v2/options/contracts` with filters such
  as `underlying_symbols`, expiration, type, style, and strike.
- Single option contract lookup is `/v2/options/contracts/{symbol_or_id}`.
- Option orders use the trading orders API with option symbols such as
  `PTON240126C00000500`.
- Alpaca documents that option positions show up through the existing positions
  model. There is no required `/options/positions` first call for this app.
- Generic asset lookup is for equities/assets. `SPY` returns `asset_class:
  us_equity`; an OCC option symbol is not a generic asset lookup target.

Finding:

The previous `listAlpacaOptionPositions()` implementation tried
`/options/positions` first and logged:

```
options positions endpoint unavailable, falling back to /positions
```

That request is incorrect for the documented trading API surface. The fixed
implementation calls `/positions` directly through the Alpaca SDK, filters
positions by `asset_class` containing `option` or by canonical OCC option
symbol, and normalizes returned option symbols through the shared translator.

## Asset Lookup

| Lookup Type | Correct Source | Current Behavior |
| --- | --- | --- |
| Equity asset | Alpaca assets | `SPY` / `AMD` resolve as `us_equity` |
| Option contract metadata | Alpaca `/v2/options/contracts` when broker metadata is needed | Do not use generic asset lookup for OCC contracts |
| Market snapshots, quotes, trades, chains, Greeks, IV, OI | Massive | Market data remains Massive-owned |
| Broker positions/orders/account/buying power | Alpaca | Broker state remains Alpaca-owned |

## Scanner Audit

Automation scanning remains market-data first:

```
Universe/scanner
  -> Massive options chain/snapshot/flow services
  -> contract selection
  -> Alpaca only for broker account/order/position state
```

Alpaca does not select contracts and Massive does not infer broker state.

## Files Modified

- `server/src/features/market/services/liveFeed.ts`
- `server/src/features/broker/services/alpaca.ts`
- `server/src/features/marketData/massiveProvider.ts`
- `server/src/shared/data/massive.ts`
- `server/src/features/automation/services/brokerUpdateIngestion.service.ts`
- `server/src/features/analysis/deskInsight.ts`
- `server/src/features/options/services/watchlistReports.ts`
- `server/src/features/market/services/aggregatesWorker.ts`
- `server/src/features/market/services/aggregatesService.ts`
- `server/src/features/market/market.routes.ts`
- `server/src/features/conversations/chat.routes.ts`
- `server/tests/marketdata.live-architecture.test.mjs`

## Validation

| Gate | Result |
| --- | --- |
| Server build | PASS (`npm --prefix server run build`) |
| Server tests | PASS (`npm --prefix server test`, 415 tests) |
| Client build | PASS (`npm --prefix client run build`) |
| Client tests | PASS (`npm --prefix client test`, 134 tests) |
| Dev workflow tests | PASS (`npm run test:dev`, 25 tests) |
| Automation tests | PASS (`npm --prefix server run test:automation`, 310 tests) |
| Massive stock websocket suppression | PASS by unit coverage |
| Equity live subscribe REST-only handling | PASS by unit coverage |
| Shared symbol translation routing | PASS by build and focused tests |
| Alpaca options positions endpoint cleanup | PASS by code audit |
| Scanner source ownership | PASS by automation suite and code audit |
| Trading logic changes | None |
| UI layout changes | None |
| Mongo model changes | None |

## Remaining Blockers

- Massive account-level `max_connections` was observed during prior local
  websocket smoke validation. That is an external provider/account state issue,
  not an application duplicate-owner issue. Release validation still requires a
  clean provider websocket connection when no other Massive websocket session is
  active.
- Production deployment and merge are intentionally not performed in this P1
  cleanup pass.

# Final SSOT Production Alignment

Date: 2026-07-21

Scope: architecture verification only. No UI redesign, GPT prompt changes,
Mongo schema changes, strategy changes, or automation logic removals.

## Architecture Verification

```
Massive Options Advanced
  |-- REST: chains, expirations, Greeks, IV, OI, snapshots, aggregates
  `-- WebSocket: Q/T/AM/A option channels only
          |
          v
optionsSubscriptionManager.service.ts
          |
          v
optionsQuoteCache.service.ts
          |
          v
liveFeed.ts -> Socket.IO -> React liveMarketStore
          |
          |-- Matrix
          |-- Ticket / Top of Book
          |-- Time & Sales
          |-- Watchlist display
          |-- AI context inputs
          `-- Automation held-contract marks

Alpaca -> broker/services/alpaca.ts -> broker adapter -> reconciliation/execution
MongoDB -> app state, automation metadata, journals, conversations, reports
```

Verified: the frontend does not connect directly to Massive. Provider streaming
is backend-owned.

## SSOT Verification

| Data Type | Owner | Verification |
| --- | --- | --- |
| Option quotes/trades | Massive | `optionsSubscriptionManager` ingests websocket `Q/T` into `optionsQuoteCache` |
| Option aggregates | Massive | chart focus routes through `liveFeed`/chart hub; REST fallback uses `massiveGet` |
| Chains, expirations, Greeks, IV, OI | Massive | options orchestrator and market routes use `shared/data/massive.ts` |
| Orders, positions, account, buying power, cash, equity, fills | Alpaca | broker adapter reads/submits through `broker/services/alpaca.ts` |
| Conversations, AI reports, automation metadata, journals, strategy state | MongoDB | persisted models are application state only |
| Manual/external broker positions | Alpaca/portfolio read-side | reconciliation never adopts positions by symbol |

## Symbol Translation

Canonical translator: `server/src/shared/symbols/optionSymbol.ts`.

```
Massive:   O:SPY260724C00500000
Canonical: SPY260724C00500000
Alpaca:    SPY260724C00500000
Mongo:     SPY260724C00500000
```

Server provider routing, broker normalization, portfolio reconciliation,
automation marks, and report/watchlist symbol checks now delegate to this
translator. Remaining direct `O:` prefix handling is inside the translator.

## Scanner And Execution

Scanner source order:

```
Massive market data
  -> option chain / flow snapshot
  -> deterministic contract selection
  -> risk engine
  -> order intent
  -> Alpaca broker validation/account state
  -> paper order submission
  -> broker order ingestion
  -> automation position tracking
  -> exit/report
```

Verified: scanner opportunity discovery does not use Alpaca. Alpaca is used for
clock/account/order/position broker truth only.

## Live Data

| Consumer | Live Source |
| --- | --- |
| Matrix | React `liveMarketStore`, fed by Socket.IO quote cache events |
| Ticket / Top of Book | Same store/cache as Matrix |
| Time & Sales | Socket.IO trade events from `optionsQuoteCache` trade cache |
| Watchlist | Socket.IO for display subscriptions; equity streams are REST-only under options profile |
| Automation | `getFreshQuote()` first, then targeted Massive snapshot fallback |
| Portfolio | Alpaca broker truth plus targeted Massive held-contract quote/snapshot enrichment |
| AI Desk | Application market context; no separate provider websocket |

REST snapshots hydrate the same live store/cache and are guarded as initial or
stale/disconnected fallback, not an independent live quote owner.

## REST Optimization

Implemented/verified controls:

- `massiveGet`: shared queue, in-flight dedup, TTL cache, priority queue,
  endpoint-class entitlement blocks, Retry-After aware 429 backoff.
- Options orchestrator: in-flight chain dedup, session-aware cache,
  long-lived reference cache.
- Market routes: `fetchWithCache` wrapper around UI-facing REST surfaces.
- Watchlist universe: TTL cache with explicit invalidation.
- Broker routes: short TTL for account/positions/orders.
- Equity live subscriptions under options-only entitlement: accepted as
  `equity_rest_only`, no stock websocket attempt.

## Log Cleanup

Expected conditions are structured INFO/DEBUG:

- `LIVE_PROVIDER_UNAVAILABLE` for stock websocket not entitled.
- `NO_OPTION_POSITIONS` DEBUG when Alpaca `/positions` contains only equities.
- `EVALUATION_HEARTBEAT` / `MONITOR_HEARTBEAT` with `LEASE_NOT_OWNED`.

ERROR/critical remains reserved for provider auth failures, broker failures,
websocket provider disconnect/failure states, failed submissions, and failed
reconciliation.

## Provider Verification

Alpaca connector results:

- `SPY` resolves as `asset_class: us_equity` with `has_options`.
- `SPY260724C00500000` is not a generic asset lookup target.
- Option snapshot accepts compact OCC symbol `SPY260724C00500000`.
- Clock endpoint returned closed market with next open/close.

Alpaca docs verification:

- Options positions use the existing positions API model.
- Option contracts are retrieved through `/v2/options/contracts` and
  `/v2/options/contracts/{symbol_or_id}`.
- Option orders use compact OCC symbols and `day` time-in-force.

Massive verification:

- Official docs specify `wss://socket.massive.com/options` for realtime options.
- Auth payload is `{"action":"auth","params":"<api key>"}`.
- Quote channel is `Q.O:*`; trade channel is `T.O:*`.
- Aggregate channels are `AM.O:*` and `A.O:*`.
- Quote docs state a 1,000 option-contract limit per connection.
- Quickstart/FAQ state account websocket connection limits; live smoke hit
  `max_connections`.

No standalone Massive MCP connector was exposed in this environment; verification
used official Massive docs and live provider smoke.

## Release Gates

| Validation | Result |
| --- | --- |
| Server Build | PASS |
| Client Build | PASS |
| Server Tests | PASS, 415 tests |
| Client Tests | PASS, 134 tests |
| Automation Tests | PASS, 310 tests |
| Massive REST | PASS |
| Massive WebSocket | FAIL/BLOCKED, provider returned `max_connections` |
| Shared Quote Cache | PASS |
| Shared Symbol Translation | PASS |
| Scanner | PASS |
| Alpaca Broker | PASS |
| Broker Reconciliation | PASS |
| AI Desk | PASS by code audit/tests |
| Matrix | PASS by live cache path/tests |
| Ticket | PASS by live cache path/tests |
| Time & Sales | PASS by live trade cache path/tests |
| Portfolio | PASS by code audit/tests |
| REST Deduplication | PASS |
| Log Cleanup | PASS |
| Production Ready | FAIL/BLOCKED |

## Smoke Results

- Backend `/health` on existing local backend: PASS.
- Massive REST quote for `O:SPY260724C00500000`: PASS.
- Alpaca account smoke: PASS.
- Alpaca option positions smoke: PASS, 0 option positions and no equity leakage.
- Local owner backend on port 4010: Mongo connected, startup reconciliation CLEAN.
- Socket.IO option subscription: PASS for backend ownership and provider payload.
- Massive provider auth/subscription: FAIL/BLOCKED due account `max_connections`.
- Dev orchestrator note: `npm run dev:backend` reused the existing backend but
  the optional `python-mcp` sidecar failed dependency resolution under Python
  3.13. Standalone backend startup on port 4010 was used for the core smoke.

## Production Readiness

Not ready to deploy.

The application architecture is aligned, but deployment policy requires every
release gate to pass. Massive WebSocket did not pass because the account rejected
the designated single backend connection with `max_connections`. Do not merge,
push, or deploy until the competing Massive websocket session is closed or the
provider connection limit is increased and the same smoke test passes.

# Options Advanced — Market-Data Alignment Audit

Date: 2026-07-13 (Monday, market open)
Branch audited: `feat/automation-phase-2b-decision-engine`
Subscription: **Massive Options Advanced** (real-time US options; no real-time stocks entitlement)
Verification method: Massive MCP server (`search_endpoints`, `call_api`) + controlled
single-shot REST probes with the project's `MASSIVE_API_KEY` + official docs
(`massive.com/docs/...md`). No assumption was taken from memory.

---

## 1. Current Massive request inventory

All server REST traffic funnels through two clients:

| Client | File | Auth | Queue/retry |
|---|---|---|---|
| `massiveGet` (shared) | `server/src/shared/data/massive.ts:161` | `apiKey` param + Bearer + X-API-Key | 1-concurrent queue, 1 000 ms min interval, retry via `massiveRetry.ts` |
| backtest provider | `server/src/features/marketData/massiveProvider.ts:42` | same | own axios client, **bypasses the shared queue** |

Plus one WebSocket client class (`server/src/shared/data/massiveWs.ts`) instantiated
twice by `liveFeed.ts` (options + **stocks**).

Python services (`agent/core/polygon_agent.py`, `python-screener-service/screener.py`)
hit the same API with the same key; they are out of scope for this server-side
correction but inherit the same entitlement constraints (documented in §16).

## 2. Stock endpoint call sites (file:line)

| Endpoint | Call site | Trigger |
|---|---|---|
| `/v2/aggs/ticker/{stock}/range/…` | `shared/data/massive.ts:285` (`getOptionAggregates` — misnamed; also used for stocks) | automation underlying bars, charts, agg worker |
| `/v2/aggs/ticker/{stock}/range/…` | `features/marketData/massiveProvider.ts:188` (`getStockBars`) | lab/backtests |
| `/v2/aggs/ticker/{stock}/range/1/day/…` | `features/futures/services/polygonGateway.service.ts:73` | futures lab |
| `/v2/aggs/ticker/{sym}/prev` | `shared/data/massive.ts:1611` (`getMassiveStockSnapshot`) | watchlist stock rows |
| `/stocks/v1/short-interest` | `shared/data/massive.ts:1719` | watchlist/deskInsight |
| `/stocks/v1/short-volume` | `shared/data/massive.ts:1754` | watchlist/deskInsight |
| `/v1/marketstatus/now` | `features/market/services/marketStatus.ts:63` | session logic (cached 60 s) |
| stock 1-min polling loop | `features/market/services/aggregatesWorker.ts` (`SPY,AAPL,TSLA,NVDA,MSFT,META,QQQ` + warm list, every 180 s when `AGG_WORKER_ENABLED=true`) | cache pre-warming |

Consumers driving stock aggregate calls:
- `automationMarketData.service.ts:69` → `resolveAggregates({ticker: 'SPY', timespan:'minute', multiplier:5})`
- `market.routes.ts:72` (chart aggregates endpoint, any ticker)
- `chartHub/backfill.ts:79`
- `aggregatesService.ts:536` daily fallback, `:551` snapshot fallback

## 3. Options endpoint call sites (file:line)

| Endpoint | Call site |
|---|---|
| `/v3/snapshot/options/{u}` (chain, paginated) | `massive.ts:651` (`fetchSnapshotOptions` ← `getMassiveOptionsChain:745`) |
| `/v3/snapshot/options/{u}` (unfiltered, 1 page) | `massive.ts:1424` (`getMassiveOptionsSnapshot`) |
| `/v3/snapshot/options/{u}/{c}` | `massive.ts:1512` (`getMassiveOptionContractSnapshot`) |
| `/v3/reference/options/contracts` | `massive.ts:505, 556, 624` (list/expirations/`fetchReferenceContracts`) |
| `/v3/reference/options/contracts/{t}` | `massive.ts:450` |
| `/v3/trades/{t}` | `massive.ts:344` |
| `/v3/quotes/{t}` | `massive.ts:399` |
| `/v2/aggs/ticker/O:…` | `massive.ts:285`, `massiveProvider.ts:188` |
| `/v1/indicators/{sma,ema,rsi,macd}/{t}` | `massive.ts:1830` |
| `/v3/reference/exchanges`, `/v3/reference/conditions` | `massive.ts:585, 596` |

Chain consumers (each independently triggers snapshot+reference pagination):
- automation: `automationMarketData.service.ts:146` → `getMassiveOptionsChain(underlying, 250)` — **no expiration or strike filter**
- UI chain route: `market.routes.ts:218, 232`
- watchlist/checklist/deskInsight: `getMassiveOptionsSnapshot` (unfiltered whole-chain page) at `optionsChecklist.ts:404,656,658`, `deskInsight.ts:150`, `watchlistReports.ts`
- aggregates snapshot fallback: `aggregatesService.ts:620`

## 4. Massive WebSocket connections (file:line)

| Connection | Site | Status |
|---|---|---|
| `wss://socket.massive.com/options` | `liveFeed.ts:20,139` | entitled (Options Advanced) |
| `wss://socket.massive.com/stocks` | `liveFeed.ts:25,152` — created for any non-`O:` symbol (`getClientForSymbol:166`) | **NOT entitled — root of the logged `/stocks` connect attempts** |

`MassiveWsClient` (`massiveWs.ts`): auth-then-subscribe is correct; reconnect is
exponential 3 s→60 s but **gives up permanently after 20 attempts**
(`massiveWs.ts:129`) and has **no jitter** and no exposed health state.

## 5. Current cache inventory

| Cache | Location | TTL | Notes |
|---|---|---|---|
| `responseCache` (in-mem, per path+params) | `massive.ts:54` | default 10 s; snapshot 5 s; reference 60 s; contract meta 120 s | single TTL knob; no market-hours awareness; no completeness metadata |
| `inflightRequests` dedupe | `massive.ts:55` | — | dedupes only *identical* path+params |
| `barCache` | `massiveProvider.ts:47` | 60 s | separate, duplicated logic |
| Mongo `market_cache` | `market/services/marketCache.ts` | per call (chain route 120 s) | keyed by hashed params |
| Mongo `option_chain_snapshots` | `options/services/optionsChainStore.ts` | 24 h TTL index, 10 min freshness | per underlying+expiration |
| Mongo aggregate bars | `aggregatesStore.ts` | rolling | written by REST + WS |
| `intradayBlockedUntilBySymbol` | `aggregatesService.ts:31` | 15 min (403) / Retry-After (429) | good idea, but silent to consumers |
| market status | `marketStatus.ts` | 60 s | fine |
| watchlist reports | `watchlistReports.ts` | 10 min | fine |

**Gap:** no separation of snapshot vs reference TTL policy at the orchestration
level, no provider timestamps kept, no completeness/staleness metadata surfaced.

## 6. Duplicate-request map

For one SPY automation tick while the dashboard is open:

```
automation  → getMassiveOptionsChain(SPY, 250)     ── snapshot pages (unfiltered) + reference page
UI chain    → market.routes fetchWithCache(120 s)  ── separate getMassiveOptionsChain(SPY, …)
watchlist   → getMassiveOptionsSnapshot(SPY)       ── another unfiltered snapshot page
checklist   → getMassiveOptionsSnapshot(SPY)       ── ditto (per symbol)
deskInsight → getMassiveOptionsSnapshot(SPY)       ── ditto
aggs fallback → getMassiveOptionsSnapshot(SPY)     ── ditto when stock bars fail
chart       → resolveAggregates(SPY 5-min)         ── stock aggs (NOT_AUTHORIZED intraday)
agg worker  → getOptionAggregates(SPY,1,minute)    ── stock aggs ×7 tickers / 3 min
```

The `massiveGet` in-flight map only coalesces byte-identical requests, so the
five differently-parameterized SPY chain/snapshot requests above are five
provider fetches.

## 7. Subscription-entitlement map (probed 2026-07-13 with the project key)

| Capability | Result | Evidence |
|---|---|---|
| Options chain snapshot (`/v3/snapshot/options/SPY`) | ✅ real-time; quotes `timeframe: REAL-TIME` | live probe |
| Option contract snapshot | ✅ | endpoint doc + probe family |
| Options reference contracts | ✅ (limit ≤ 1000, `expired` filter) | MCP `search_endpoints` |
| Options trades `/v3/trades/O:…` | ✅ real-time | live probe |
| Options quotes `/v3/quotes/O:…` | ✅ real-time | live probe |
| Options last trade `/v2/last/trade/O:…` | ✅ | live probe |
| Options minute aggs (current day) | ✅ real-time | live probe (O:SPY260720C00753000, bars ≤ 1 min old) |
| Options WS `/options` — `T,Q,A,AM` | ✅ (Q requires Advanced; **≤ 1 000 contracts/connection; no wildcard on Q**) | docs `websocket/options/*.md` |
| Underlying price in options snapshot | ✅ present but **`timeframe: "DELAYED"`** with `last_updated` | live probe |
| Stock daily aggs | ⚠️ 200 OK, `"status": "DELAYED"` | live probe |
| Stock intraday aggs (current day) | ❌ `NOT_AUTHORIZED — "Your plan doesn't include this data timeframe"` | live probe |
| Stock intraday aggs (historical) | ❌ 200 OK with **0 results** (silent empty) | live probes (2026-07-06, 07-10) |
| Stock WS `/stocks` | ❌ not part of Options Advanced | subscription spec; runtime failures in logs |
| Market status `/v1/marketstatus/now` | ✅ | live probe |
| Short interest / short volume | ✅ (reference-class, delayed by nature) | existing runtime behavior |

## 8. MCP capability map

Tools exposed by the connected `massive` MCP server: `search_endpoints`,
`call_api`, `query_data`, `workspace`. Key endpoints confirmed via MCP:

- `GET /v3/snapshot/options/{underlyingAsset}` — filters: `strike_price(.gte/.lte)`,
  `expiration_date(.gte/.lte)`, `contract_type`, `order`, `limit` (≤ 250), `sort`.
  Response rows include `details_*`, `greeks_*`, `implied_volatility`,
  `last_quote_*` (+ `last_updated`, `timeframe`), `open_interest`,
  `underlying_asset_price`, `underlying_asset_last_updated`,
  `underlying_asset_timeframe`. Pagination via `next_url`/cursor.
- `GET /v3/reference/options/contracts` — filters incl. `underlying_ticker`,
  `expiration_date(.gte/.lte)`, `strike_price(.gte/.lte)`, `contract_type`,
  `expired` (default false), `limit` ≤ 1000.
- `GET /v3/snapshot/options/{u}/{contract}`, `/v2/last/trade/{t}`,
  `/v1/open-close/{t}/{date}`, `/v1/indicators/ema/{t}` (options tickers).
- WS channels (docs): `/options` — `AM` (min aggs), `A` (sec aggs), `T` (trades),
  `Q` (quotes, Advanced+, ≤ 1 000 contracts/conn), FMV (Business).

**Entitlement exposure:** the MCP server exposes **no account-plan /
entitlement / authorization tool**. This is stated explicitly as required.
Operating constraint therefore = the confirmed Options Advanced spec in the
mission + the live probes above (which behaviorally confirm it: real-time
options everywhere, `DELAYED` underlying, `NOT_AUTHORIZED` current-day stock
intraday).

Note: the MCP authenticates via its own OAuth account; entitlement probes were
run with the **project API key** directly so results reflect the runtime key.

## 9. Required vs unnecessary stock calls

| Call | Verdict |
|---|---|
| SPY 5-min bars for automation | **Not authorized** in real time. Must fail closed (Solution C). Historical intraday is silently empty, so backfill cannot help. |
| Agg worker polling 7 stock tickers/3 min | Unnecessary + unauthorized → remove stock tickers from default worker set / gate on entitlement profile |
| Watchlist `getMassiveStockSnapshot` (prev close) | Allowed (daily/delayed class) but must be **labeled delayed prev-close**, never fed to any real-time gate |
| Stock WS connection | Not authorized → must not be opened under the options-advanced profile |
| Market status | Authorized, keep (cached) |
| Short interest/volume | Authorized, keep (long TTL) |
| Futures/lab backtest daily stock bars | Daily = DELAYED but returned; keep for lab only; never for automation gates |

## 10. Authorized source for underlying SPY context

- **Solution A (partial): delayed underlying spot.** Every options-snapshot row
  carries `underlying_asset.price`, `last_updated`, `timeframe: "DELAYED"`.
  Authorized, already fetched with the chain — becomes the *labeled, delayed*
  underlying spot for UI and for strike-window centering. It is **not** a
  real-time gate input.
- **Solution C: real-time 5-minute SPY bars (VWAP/EMA9/EMA21/RSI/vol-avg).**
  Confirmed NOT included: current-day intraday → `NOT_AUTHORIZED`; historical
  intraday → silent empty; daily → `DELAYED`. Underlying bars cannot be derived
  from any authorized source, and fabricating them from option prices is
  forbidden. Therefore the underlying-data gate is **UNAVAILABLE** under this
  plan: automation entry decisions must fail closed
  (`DATA_REJECTED` / readiness=false), while options-side corrections proceed.
- Requirement to lift the gate: a Massive **Stocks** plan with real-time (or
  at minimum 15-min-delayed-accepted-by-policy) intraday aggregates, or an
  alternative authorized real-time equity feed. Documented in §16.

## 11. Rate-limit root cause

1. `MASSIVE_RETRY_BASE_MS = 500` with 3 retries → the observed 500 ms → 1 s → 2 s
   retry ladder (`massive.ts:17,232`; `massiveRetry.resolveMassiveRetryDelayMs`).
   `Retry-After` *is* honored when present, but there is **no jitter**, and the
   429 responses from Massive did not carry usable headers in the logged cases,
   so pure fast exponential retry amplified the burst.
2. Two HTTP clients: `massiveProvider.ts` bypasses the shared 1-rps queue.
3. Unfiltered SPY chain fetches: snapshot pagination up to 5–25 pages ×150 plus
   a concurrent reference page (`getMassiveOptionsChain` with no
   expiration/strike/type filters from automation) — dozens of requests per tick.
4. Duplicate consumers (§6) each re-trigger the above.
5. Agg worker + watchlist stock polling consume the same 1-rps budget as
   automation (no priorities), including **unauthorized** intraday stock calls
   that can never succeed (current-day → NOT_AUTHORIZED; but the *same code
   path* also runs for previous-session windows which return empty 200s,
   wasting quota every cycle).
6. No endpoint-level throttle state: after a 429 on one endpoint, unrelated
   queued calls still fire immediately.

## 12. Chain completeness risks

- `fetchSnapshotOptions` caps pages (5 unfiltered / 25 filtered) and only
  records `exhausted`; `getMassiveOptionsChain` returns
  `metadata.snapshotComplete/referenceComplete` but **no consumer checks it** —
  automation ranks contracts from whatever arrived (`fetchOptionChain` drops
  `metadata` entirely).
- Reference fetch for the unfiltered path uses `maxPages: 1` → logged
  "reference contracts truncated".
- The automation request (limit 250, no filters) covers a small arbitrary
  lexicographic slice (`sort: 'ticker'`) of the full SPY chain — the 7–21 DTE
  window is not proven covered, so a "best" contract may be missing while
  ranking proceeds anyway.

## 13. Negative-DTE root cause

`massive.ts:1038 computeDte`:

```ts
const expDate = new Date(expiration);          // "2026-07-13" → 2026-07-13T00:00:00Z
Math.round((expDate.getTime() - Date.now()) / 86_400_000);
```

Parsing an ISO date yields **UTC midnight**. On expiration day after ~12:00 UTC
(before the ET close), the difference is ≈ −0.6 days → `Math.round` → **−1**,
matching the logged `expiration: 2026-07-13, dte: -1`. A second, different
implementation exists at `optionSelector.service.ts:25` (expiry pinned to
`T21:00:00Z`, `Math.ceil`) — inconsistent (off during DST: 21:00 Z = 17:00 EDT)
and duplicated. There is no exchange-calendar/`America/New_York` normalization,
no expired-contract exclusion at the chain layer, and no same-day cutoff rule.

## 14. Proposed file-by-file correction

New module (existing feature dir `server/src/features/marketData/`, camelCase
per repo convention):

| File | Responsibility |
|---|---|
| `optionsData.types.ts` | `ChainCompleteness`, normalized contract/chain, underlying context, health, `RequestPriority` |
| `optionsMarketDataOrchestrator.service.ts` | single owner of SPY chain/reference/quotes; narrow provider filters (`expiration_date.gte/lte`, `strike_price.gte/lte`, `contract_type`); page+time budget; completeness metadata; request coalescing by normalized key; delayed underlying context extraction |
| `optionsChainCache.service.ts` | snapshot cache — short TTL market-open / long TTL closed, provider timestamps, completeness, stale reason |
| `optionsContractCache.service.ts` | reference contracts — long TTL, keyed by underlying+expiration window |
| `optionsQuoteCache.service.ts` | per-contract quote freshness (WS preferred, REST hydration) |
| `optionsSubscriptionManager.service.ts` | refcounted, deduped options-WS subscriptions (≤ 1000/conn), unsubscribe-on-idle, health |
| `optionsDataHealth.service.ts` | health registry backing the new endpoints |
| `marketData.routes.ts` | `GET /api/market-data/health`, `GET /api/market-data/options/:underlying/status` |
| `tradingCalendar.ts` (shared) | ET trading-date + DTE (`computeDteEt`), same-day = 0, expired exclusion |

Changed files:

| File | Change |
|---|---|
| `shared/data/massive.ts` | priority-aware queue (`massiveGet(..., {priority})`); jittered retry; per-endpoint-class throttle state incl. permanent stop on `NOT_AUTHORIZED`; replace `computeDte` with shared calendar; remove full-cursor/raw-payload logs (hash cursors); structured summary logs |
| `shared/data/massiveRetry.ts` | add jitter helper + entitlement classification (`NOT_AUTHORIZED` never retried) |
| `shared/data/massiveWs.ts` | never permanently give up while subs exist; capped backoff + jitter; expose state (`connected/connecting/reconnecting/attempts/lastEvent`) |
| `market/services/liveFeed.ts` | subscription profile gate — under `options-advanced` the stocks WS is never constructed; delegate options subs to subscription manager; expose WS health |
| `market/services/aggregatesService.ts` | classify `NOT_AUTHORIZED` as entitlement-blocked (no retry loop, long block, health `UNAVAILABLE` + reason); snapshot-fallback bar keeps **provider** timestamp (no `Date.now()` masquerade) and is flagged `synthetic: true` |
| `market/services/aggregatesWorker.ts` | stock tickers removed under options profile; worker only polls option tickers/warm list it is entitled to |
| `automation/services/automationMarketData.service.ts` | chain via orchestrator with 7–21 DTE + contract-type + strike-window filters; completeness/freshness/entitlement surfaced; underlying-bars path returns explicit `unavailable` when source is not authorized real-time intraday |
| `automation/services/closedBarProcessor.service.ts` | fail-closed wiring: entitlement/completeness/staleness → `DATA_REJECTED` before strategy; unchanged evaluation logic |
| `automation/services/optionSelector.service.ts` | use shared `computeDteEt`; reject `dte < 0`; incomplete-window ⇒ `NO_CONTRACT_SELECTED / DATA_INCOMPLETE` |
| `automation/automation.config.ts` | new reason codes only (`UNDERLYING_DATA_UNAUTHORIZED`, `CHAIN_INCOMPLETE`, `DATA_INCOMPLETE`, `OPTIONS_STREAM_DISCONNECTED`) |
| `market/market.routes.ts` | chain endpoint served from orchestrator (same response shape); data-status fields (`live/delayed/cached/stale/incomplete/entitlement`) added, not hidden |
| `index.ts` | mount `/api/market-data` |
| `.env` docs / `agent/.env.example` / `docs/massive/README.md` | subscription-profile documentation |

Constraints honored: no trading-logic, GPT-prompt, Mongo-schema, or evaluation
changes; no broker execution; no Phase 2C.

## 15. Tests required before acceptance

Node `--test` suites (matching `server/tests/*.test.mjs` convention):

1. `marketdata.orchestrator.test.mjs` — coalescing (5 concurrent identical chain
   requests → 1 provider call, same result to all 5); separate snapshot vs
   reference TTLs; reference not re-fetched on quote refresh; completeness
   marking on truncated pagination; narrow filters forwarded to provider.
2. `marketdata.dte.test.mjs` — same-day = 0; expired excluded; UTC-midnight,
   `America/New_York` boundary, weekend, holiday, DST cases; never −1 while valid.
3. `marketdata.ratelimit.test.mjs` — `Retry-After` honored; jitter bounds;
   `NOT_AUTHORIZED` never retried and enters entitlement-blocked state;
   watchlist-priority requests yield to automation-priority.
4. `marketdata.ws.test.mjs` — dedupe/refcount, unsubscribe-on-idle, stock WS
   never constructed under options profile, reconnect never gives up while
   subscriptions active, health transitions DEGRADED/UNAVAILABLE.
5. `automation2b.datagates.test.mjs` — stale quote ⇒ DATA_REJECTED; incomplete
   window ⇒ NO_CONTRACT_SELECTED/DATA_INCOMPLETE; missing underlying
   entitlement blocks evaluation; prev-close can't satisfy real-time gate;
   fresh authorized options data permits evaluation; disconnected WS + stale
   REST blocks entry; no path reaches `broker.submitOrder`.
6. Log hygiene — serialized log lines contain no `apiKey`, no full `next_url`,
   no full cursor.
7. Regression — existing `automation*.test.mjs` and `massive.*.test.mjs` stay green.

---

### Decision

The correction path is unambiguous: proceed to implementation. Underlying
five-minute real-time bars are **not** available under Options Advanced, so the
underlying gate is implemented fail-closed (Solution C) with the delayed
options-snapshot spot used only as labeled context (Solution A), and all
options-side corrections are completed.

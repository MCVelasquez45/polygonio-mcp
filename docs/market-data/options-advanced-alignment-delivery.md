# Options Advanced Alignment — Delivery Report

Branch: `fix/options-advanced-market-data-alignment` (from `feat/automation-phase-2b-decision-engine`)
Date: 2026-07-13
Companion audit: [options-advanced-alignment-audit.md](options-advanced-alignment-audit.md)

Status: implemented, all tests green. **Not deployed. Not merged. Awaiting review.**

---

## 1. MCP entitlement / capability report

The connected Massive MCP server exposes `search_endpoints`, `call_api`,
`query_data`, `workspace` — **no account-plan/entitlement API exists on the
MCP**, so entitlements were established from the confirmed Options Advanced
specification plus controlled single-shot probes with the project's
`MASSIVE_API_KEY` (sanitized results below; full detail in audit §7–8).

| Capability | Verified result |
|---|---|
| `/v3/snapshot/options/SPY` (+ filters `expiration_date.gte/lte`, `strike_price.gte/lte`, `contract_type`, `limit≤250`) | ✅ real-time (`last_quote.timeframe: REAL-TIME`) |
| `/v3/snapshot/options/{u}/{contract}` | ✅ |
| `/v3/reference/options/contracts` (`limit≤1000`, `expired=false`) | ✅ |
| `/v3/trades/O:…`, `/v3/quotes/O:…`, `/v2/last/trade/O:…` | ✅ real-time |
| `/v2/aggs/ticker/O:…/range/1/minute/…` (current day) | ✅ real-time (bars ≤1 min old at 10:34 ET) |
| WS `wss://socket.massive.com/options`, channels `T,Q,A,AM` | ✅ `auth_success` + `subscribed to: Q.O:SPY260720C00753000` with the project key. Q requires Advanced; ≤1 000 contracts/connection; no wildcard on Q |
| Underlying block in options snapshots | ✅ present, **`timeframe: "DELAYED"`** + `last_updated` (ns) |
| Stock daily aggregates | ⚠️ 200 OK, `"status": "DELAYED"` |
| Stock intraday aggregates, current day | ❌ `NOT_AUTHORIZED — "Your plan doesn't include this data timeframe."` |
| Stock intraday aggregates, historical | ❌ silent empty (200 OK, 0 results) |
| Stocks WebSocket | ❌ not in plan |
| `/v1/marketstatus/now` | ✅ |

## 2. Endpoint inventory

See audit §2–§4 for the complete pre-change inventory with file:line. Post-change,
all option-chain traffic flows through the orchestrator; direct Massive access
remains only in the shared client (`massiveGet`) and narrowly-scoped helpers.

## 3. File-by-file change report

**New files**

| File | Purpose |
|---|---|
| `server/src/shared/time/tradingCalendar.ts` | Exchange-calendar (America/New_York) DTE: `computeDteEt` (same-day = 0), `isExpiredContract` (16:15 ET cutoff), `expirationWindowForDte` |
| `server/src/features/marketData/optionsData.types.ts` | `ChainCompleteness`, `UnderlyingContext`, health-report types, chain request/response types |
| `server/src/features/marketData/optionsMarketDataOrchestrator.service.ts` | Single owner of chains: request coalescing (in-flight promise map keyed by normalized request), narrow provider filters, completeness metadata, delayed-underlying extraction, `getAutomationChain` (direction + 7–21 DTE + ±12% strikes), one-row `getUnderlyingContext` |
| `server/src/features/marketData/optionsChainCache.service.ts` | Session-aware snapshot chain cache (5 s open / 5 min closed / labeled-stale grace) |
| `server/src/features/marketData/optionsContractCache.service.ts` | Long-TTL (6 h) reference-contract cache keyed by underlying+window |
| `server/src/features/marketData/optionsQuoteCache.service.ts` | Per-contract quote cache: WS preferred, REST hydration, provider timestamps, stale rejection |
| `server/src/features/marketData/optionsSubscriptionManager.service.ts` | One options-WS connection; refcounted deduped subscriptions; 1 000-contract cap; unsubscribe-on-idle; health state |
| `server/src/features/marketData/optionsDataHealth.service.ts` | Health registry + `automationDataReadiness()` (fail-closed) + subscription profile |
| `server/src/features/marketData/marketData.routes.ts` | `GET /api/market-data/health`, `GET /api/market-data/options/:underlying/status` |

**Changed files**

| File | Change |
|---|---|
| `shared/data/massive.ts` | Priority-aware request queue (8 classes, `CRITICAL_EXIT`→`BACKGROUND`); entitlement registry (403/`NOT_AUTHORIZED` → endpoint-class block, fail-fast, no retry); sanitized logging (cursors → 8-char hash, no API key, no raw payload dumps); `computeDte` → exchange calendar; expired expirations filtered from chains; chain filters (`expirationGte/Lte`, `contractType`, `strikeGte/Lte`) pushed into provider queries; completeness metadata (pages, next cursors, covered window); flat-v3 `underlying_asset` extraction fix (was silently null); `normalizeProviderTimestamp` (ns/µs/ms/s) |
| `shared/data/massiveRetry.ts` | `MassiveEntitlementError` (never retried); `isEntitlementFailure`; jitter (`applyRetryJitter` ±25%); Retry-After honored as a floor (never clamped below, jittered only upward) |
| `shared/data/massiveWs.ts` | Removed permanent 20-attempt give-up; bounded exponential backoff (≤60 s) with ±20% jitter; `getState()` (connected/authenticated/attempts/nextReconnectAt/lastEventAt) |
| `market/services/liveFeed.ts` | Stocks WS gated by `MASSIVE_SUBSCRIPTION_PROFILE` **and** `MASSIVE_STOCKS_WS_ENABLED` (never constructed under `options-advanced`); option symbols delegated to the subscription manager |
| `market/services/aggregatesService.ts` | Entitlement failures → long block (`6 h`) with reason, no retry loop; block reasons surfaced as `intradayEntitlement`/`intradayBlockReason` on every response; snapshot-fallback bar now keeps the **provider** timestamp (refuses to fabricate when missing) — the prev-close-masquerade fix |
| `market/services/aggregatesWorker.ts` | Stock tickers dropped from polling under the options profile |
| `market/market.routes.ts` | Chain endpoint served via the orchestrator (VISIBLE_UI priority; same response shape + `completeness`/`cacheStatus`) |
| `automation/automation.config.ts` | New reason codes only: `UNDERLYING_DATA_UNAUTHORIZED`, `UNDERLYING_DATA_NOT_REALTIME`, `CHAIN_INCOMPLETE`, `DATA_INCOMPLETE`, `OPTIONS_STREAM_DISCONNECTED` |
| `automation/services/automationMarketData.service.ts` | `fetchOptionChain(config, direction, priceHint, now)` via `getAutomationChain`; `assessUnderlyingAuthorization` (pure, tested) feeding `MarketDataHealth.underlyingAuthorized` |
| `automation/services/closedBarProcessor.service.ts` | Fail-closed gate: unauthorized/degraded underlying → `DATA_REJECTED` before strategy; direction-specific chain fetch. **No evaluation/strategy logic changed** |
| `automation/services/optionSelector.service.ts` | Shared exchange-calendar DTE; expired contracts excluded; incomplete window → `NO_CONTRACT_SELECTED`/`DATA_INCOMPLETE` |
| `options/services/watchlistReports.ts`, `options/services/optionsChecklist.ts`, `analysis/deskInsight.ts` | Snapshot calls demoted to `WATCHLIST`/`SCANNER` priority + 30 s TTL |
| `index.ts` | Mount `/api/market-data` |
| `server/.env` | `MASSIVE_SUBSCRIPTION_PROFILE=options-advanced`, `MASSIVE_STOCKS_WS_ENABLED=false` |

**Not changed** (constraints): trading/evaluation logic, GPT prompts, MongoDB
schemas, broker execution (Phase 2C), Python agent/screener.

## 4. Request-flow diagram (before → after)

```
BEFORE
  automation ──► getMassiveOptionsChain(SPY, unfiltered) ─► 5+ snapshot pages + reference
  UI chain   ──► getMassiveOptionsChain(SPY, …)          ─► again
  watchlist  ──► getMassiveOptionsSnapshot(SPY)          ─► again      ┐ same 1-rps queue,
  checklist  ──► getMassiveOptionsSnapshot(SPY)          ─► again      │ no priorities,
  aggWorker  ──► stock 1-min aggs ×7 tickers / 3 min     ─► 403/empty  │ 429 retries
  automation ──► SPY 5-min stock bars                    ─► NOT_AUTHORIZED → fallback
  liveFeed   ──► wss://…/stocks (SPY)                    ─► unauthorized connect loop
  fallback bar stamped Date.now() → passed freshness gates

AFTER
                      Massive Options REST + /options WS  (only authorized endpoints)
                                     │  priority queue (CRITICAL_EXIT … BACKGROUND)
                                     ▼
                 Options Market Data Orchestrator
                   • coalesced fetches (5 consumers → 1 op)
                   • narrow filters (DTE window / type / ±12% strikes)
                   • chain cache (5 s open / 5 min closed) + 6 h reference cache
                   • ChainCompleteness on every response
                   • delayed underlying context (labeled DELAYED)
                   • WS subscription manager (dedupe, refcount, ≤1 000, health)
                                     │
      ┌──────────────┬───────────────┼────────────────┬──────────────┐
      ▼              ▼               ▼                ▼              ▼
  automation      UI chain       watchlist        scanner      /api/market-data
  (AUTOMATION_    (VISIBLE_UI)   (WATCHLIST,      (SCANNER)      health/status
   DECISION,                      30 s TTL)
   fail-closed gates)
  stock WS: never opened (profile gate)   stock intraday: entitlement-blocked, no retries
```

## 5. Rate-limit root-cause report

Cause chain (full analysis: audit §11):
1. `MASSIVE_RETRY_BASE_MS=500` ⇒ the logged 500 ms → 1 s → 2 s retry ladder, un-jittered.
2. Unfiltered SPY chain builds (snapshot pagination + concurrent reference) per consumer.
3. Zero cross-consumer coalescing beyond byte-identical requests.
4. Agg worker + watchlist stock polling competing with automation on one 1-rps queue.
5. Repeated calls to endpoints the plan can never serve (current-day stock intraday).

Fixes: provider-directed `Retry-After` honored as a floor; jitter everywhere;
entitlement blocks (no retry, fail-fast, 6 h); orchestrated coalescing; narrow
filters; priority classes; stock polling removed under the profile; page budgets
with explicit truncation metadata; structured logs with hashed cursors.

## 6. Test-to-requirement matrix

| # Requirement | Test |
|---|---|
| 1. concurrent identical chain requests → one provider call | `marketdata.orchestrator.test.mjs` "1 + integration" |
| 2. separate snapshot/reference TTL policies | `marketdata.orchestrator.test.mjs` "2+3" |
| 3. reference not re-fetched on quote refresh | same |
| 4. WS subscriptions deduplicated | `marketdata.ws.test.mjs` "4+5" |
| 5. unused contracts unsubscribed | same |
| 6. stock WS never used for options / never constructed | `marketdata.ws.test.mjs` "6" |
| 7. unauthorized stock aggs: no retry loops | `marketdata.entitlement.test.mjs` "7" |
| 8. Retry-After respected for 429 | `marketdata.entitlement.test.mjs` "8" + `massive.retry.test.mjs` |
| 9. watchlist yields to automation | `marketdata.entitlement.test.mjs` "9" |
| 10. incomplete pagination marked incomplete | `marketdata.orchestrator.test.mjs` "10" |
| 11. automation rejects incomplete window | `automation2b.datagates.test.mjs` "11" |
| 12. ranking uses normalized server cache | orchestrator tests (all consumers same result) + `automation2b.selection.test.mjs` |
| 13. same-day DTE = 0 | `marketdata.dte.test.mjs` + `automation2b.datagates.test.mjs` "13" |
| 14. expired contracts excluded | `marketdata.dte.test.mjs` + datagates "14" |
| 15. UTC/ET boundaries never flip DTE sign | `marketdata.dte.test.mjs` (UTC midnight, DST, weekend) |
| 16. stale quote ⇒ DATA_REJECTED | `automation2b.selection.test.mjs` "12" + datagates "17" |
| 17. WS down + stale REST blocks entry | datagates "17" |
| 18. fresh authorized options data permits evaluation | datagates "complete window ranks normally" + `automation2b.pipeline.test.mjs` |
| 19. missing authorized underlying blocks evaluation | datagates "19" |
| 20. prev-close cannot satisfy real-time gate | datagates "20" |
| 21. no cursors/credentials in logs | `marketdata.entitlement.test.mjs` "21" |
| 22. Phase 2A tests green | `automation.gates/intents/reconcile.test.mjs` — 76/76 pass |
| 23. Phase 2B tests green | `automation2b.*.test.mjs` — pass |
| 24. no signal path reaches `broker.submitOrder` | datagates "24" + existing pipeline tests |
| Integration: 5 consumers → 1 op → same chain | orchestrator test 1 |
| Integration: entitlement error → no retry + options still available + fail-closed | entitlement test 7 + datagates 19 |

Runs: `npm run test:massive` (extended), `npm run test:automation`, plus
`node --test tests/marketdata.*.test.mjs tests/automation2b.datagates.test.mjs`.
Result: **124 tests, 0 failures.**

## 7. Manual MCP verification report (sanitized)

Tools used: `mcp__massive__search_endpoints` (chain/reference/trade/quote/agg
endpoint schemas + params), `mcp__massive__call_api` (real response shapes),
`WebFetch` of `massive.com/docs/websocket/options/*.md`, plus controlled
single-shot `curl` probes with the project key (never in loops, small limits):

- Option chain snapshot: verified flat `results[]` rows with
  `details_*/greeks_*/implied_volatility/last_quote_*/open_interest/underlying_asset_*`;
  `underlying_asset_timeframe: DELAYED`, option quotes `REAL-TIME`.
- Option minute aggs / trades / quotes / last trade: current-day real-time data
  returned for an active ATM contract (`O:SPY260720C00753000`).
- Options WS: `connected` → `auth_success` → `subscribed to: Q.O:…` (project key).
- Stock probes: daily = `DELAYED`; current-day 5-min = `NOT_AUTHORIZED` (plan
  message); historical 5-min = silent empty.
- Entitlement API: not exposed by the MCP — stated explicitly; the provided
  Options Advanced spec is the operating constraint.

## 8. Environment documentation

New/changed variables (all optional, defaults shown):

```bash
# Provider plan profile. 'options-advanced' (default) disables every
# stocks-stream/intraday-stock dependency; any other value re-enables them.
MASSIVE_SUBSCRIPTION_PROFILE=options-advanced
# Stocks WebSocket hard switch (both this AND a stocks-entitled profile required).
MASSIVE_STOCKS_WS_ENABLED=false
# Entitlement block duration after a NOT_AUTHORIZED/403 (per endpoint class).
MASSIVE_ENTITLEMENT_BLOCK_TTL_MS=21600000
# Orchestrator chain cache TTLs.
OPTIONS_CHAIN_CACHE_OPEN_TTL_MS=5000
OPTIONS_CHAIN_CACHE_CLOSED_TTL_MS=300000
OPTIONS_CHAIN_CACHE_STALE_GRACE_MS=600000
# Reference (static contract) cache TTL.
OPTIONS_REFERENCE_CACHE_TTL_MS=21600000
# Delayed underlying-context cache TTL.
OPTIONS_UNDERLYING_CONTEXT_TTL_MS=15000
# Options WS per-connection contract cap (Massive documents 1000).
MASSIVE_OPTIONS_WS_MAX_CONTRACTS=1000
# Entitlement block for intraday stock aggs at the aggregates-service level.
MARKET_INTRADAY_ENTITLEMENT_BLOCK_TTL_MS=21600000
```

Health surfaces: `GET /api/market-data/health`,
`GET /api/market-data/options/SPY/status` (subscription profile, capability
verification, REST/WS status, underlying source + entitlement, cache ages,
completeness, throttle state, pending requests by priority, reconnect state,
active subscriptions, `automationDataReady` + reasons).

## 9. Exact known limitations

1. **Real-time SPY 5-minute bars are not available under Options Advanced.**
   Current-day intraday is `NOT_AUTHORIZED`; historical intraday is silently
   empty; daily is `DELAYED`. The automation entry pipeline therefore fails
   closed at the underlying-data gate (`DATA_REJECTED` with
   `UNDERLYING_DATA_UNAUTHORIZED` / `UNDERLYING_DATA_NOT_REALTIME`) and
   `automationDataReady=false`. Deterministic risk exits are not gated on this.
2. The delayed underlying spot from options snapshots (typically ~15 min) is
   surfaced for display/strike-centering only — it is labeled `DELAYED` and can
   never satisfy the real-time gate.
3. Entitlement blocks are per-process (in-memory); a restart re-probes once.
4. The Python agent/screener still call stock endpoints directly with the same
   key (out of scope here); they inherit the same plan limits and should be
   aligned in a follow-up.
5. UI stock tickers (non-options watchlist rows) continue to use delayed
   prev-close data — now explicitly labeled, never real-time.
6. The FMV WebSocket channel (Business tier) was not integrated.

## 10. Recommendation — can Options Advanced support the SPY 5-minute strategy?

**No — not without an additional stock-data entitlement.** The strategy's
signal leg (5-minute SPY bars → VWAP, EMA 9/21, RSI, volume average) requires
current-day intraday stock aggregates or a stocks WebSocket, both of which are
outside Options Advanced (verified live: `NOT_AUTHORIZED`). Options-side data
(chains, quotes, greeks, IV, OI, aggregates, WS) is fully covered and now
correctly consumed.

Options to lift the gate:
1. **Add a Massive Stocks plan with real-time (or accepted-delay) intraday
   aggregates + stocks WS** — smallest change: flip
   `MASSIVE_SUBSCRIPTION_PROFILE`, re-enable `MASSIVE_STOCKS_WS_ENABLED`, and the
   existing pipeline (already coded and tested) goes live.
2. Use the broker's (Alpaca) market-data feed for SPY bars — requires a new
   authorized-source adapter behind `fetchUnderlyingBars`.
3. Redesign the signal to options-native inputs (e.g. ATM-synthetic/FMV-based
   context) — a strategy change, explicitly out of scope for this correction.

Until one of these lands, the system runs safely: options data flows in real
time, automation evaluates only when authorized data exists (i.e. it fails
closed), and nothing polls endpoints the plan cannot serve.

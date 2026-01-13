# ARCHITECTURE.md — Enterprise-Grade Charting Plan (Equities + Options)

Goal: make charting reliable, low-latency, rate-limit resilient, and scalable to multiple clients without each client becoming its own market-data engine.

---

## 1) Current State (What We Have Today)

### Options (1-minute)
- Live: WebSocket `live:agg` updates (streaming)
- Chart behavior: last candle is updated continuously while the socket is connected

### Equities / Underlyings + Non-1m timeframes
- Live: REST refresh (polling)
- Chart behavior: candles update only when REST returns (prone to throttling + bursty loads)

---

## 2) Why This Isn't Enterprise-Grade (Yet)

### 2.1 Single data source + rate limits = predictable failure modes
- When the provider throttles REST:
  - equity charts degrade into stale/cached sessions
  - updates become inconsistent (trust drops)

### 2.2 No real-time equity stream in the current flow
- Options have WS streaming
- Equities rely on REST polling -> inherently less stable and less "live"

### 2.3 No server-side fan-out / shared stream cache
- Each client view can cause its own fetch cycles
- No centralized cache/buffer to:
  - smooth gaps
  - backfill missing candles once
  - broadcast to all connected clients

### 2.4 No data health/validation signals
- Users cannot see "Last update" or whether the chart is live vs cached
- No integrity checks for gaps/duplicates/out-of-order candles

---

## 3) Target Architecture (Enterprise Pattern)

### 3.1 Principles
- Stream-first for the active symbol only (focus-based)
- Server owns market data (not each browser tab)
- Ring buffer + backfill to prevent blank charts and smooth gaps
- Single-flight (one request per symbol/timeframe at a time)
- Rate-limit aware (degrade gracefully)
- Data validation (trust + debugging)

---

## 4) Data Flow Overview

### 4.1 High-level flow (recommended)

```text
            +-------------------------------+
            |           Provider            |
            |  WS (options, maybe equities) |
            |  REST (history + fallback)    |
            +---------------+---------------+
                            |
                            v
+------------------------------------------------------------+
| Chart Server Hub                                           |
| - Subscriptions manager (active symbol/timeframe)          |
| - Ring buffer (per symbol/timeframe)                       |
| - Backfill worker (REST)                                   |
| - Single-flight and cancellation                           |
| - Rate-limit handling (Retry-After / cooldown)             |
| - Candle builder / merger                                  |
| - Validation + health metadata                             |
+---------------+-------------------------------+------------+
                |                               |
                v                               v
       +-------------------+          +-------------------+
       |   Client Chart A  |          |   Client Chart B  |
       | - renders bars    |          | - renders bars    |
       | - shows health UI |          | - shows health UI |
       +-------------------+          +-------------------+
```

### 4.2 Why this pattern works
- Only one server-side stream per active symbol/timeframe (not per client)
- All clients get consistent bars (fan-out)
- Backfill happens once, merged consistently

---

## 5) Core Components

### 5.1 Subscription Manager
Responsible for:
- tracking the currently active chart focus (`symbol`, `timeframe`)
- opening/closing WS subscriptions
- enforcing "only stream what matters"

Rules
- Stream only the symbol currently in focus
- Unsubscribe on symbol switch (immediately)
- Keep REST polling as fallback if WS not available

### 5.2 Ring Buffer (In-memory to start; Redis later)
Per `symbol + timeframe`, store:
- last session + today (or last N bars)
- last update time
- source flags

Benefits
- instant chart load on symbol switch
- smooth UI even when provider throttles

### 5.3 Backfill Worker (REST)
On symbol switch or detected gap:
- request missing candle range via REST
- merge into buffer
- broadcast updated dataset

### 5.4 Single-flight Controller
Guarantees:
- only one in-flight fetch per `symbol + timeframe`
- old requests are cancelled or ignored on superseding focus change

### 5.5 Candle Builder / Merger
- merges WS updates into the current (in-progress) candle
- finalizes candle on minute boundary
- prevents duplicate timestamps and out-of-order bars

### 5.6 Rate-limit Handler
- respects `Retry-After` when provided
- applies cooldowns + jitter
- never blanks chart; shows degraded state

### 5.7 Data Validation Layer
Checks:
- ascending timestamps
- no duplicates
- gaps detection (missing minute(s))
- candle sanity (H >= max(O,C), L <= min(O,C), etc.)

---

## 6) Candle Data Model (Contract + Equity)

### 6.1 Canonical Candle Shape
```json
{
  "symbol": "SOFI",
  "timeframe": "1m",
  "t": 1736690400000,
  "o": 8.12,
  "h": 8.18,
  "l": 8.10,
  "c": 8.15,
  "v": 124553,
  "source": "live|backfill|cache",
  "isFinal": false,
  "lastUpdatedAt": 1736690412123
}
```

### 6.2 Chart Payload Example (client-ready)
```json
{
  "symbol": "SOFI",
  "timeframe": "1m",
  "bars": [
    { "t": 1736690340000, "o": 8.10, "h": 8.14, "l": 8.09, "c": 8.12, "v": 84211, "isFinal": true },
    { "t": 1736690400000, "o": 8.12, "h": 8.18, "l": 8.10, "c": 8.15, "v": 124553, "isFinal": false }
  ],
  "health": {
    "mode": "LIVE|DEGRADED|BACKFILLING",
    "source": "ws|rest|cache",
    "lastUpdateMsAgo": 420,
    "providerThrottled": false,
    "gapsDetected": 0
  }
}
```

---

## 7) Options Quote + Order Book Primer (for UI / tooltips)

### 7.1 Quote Fields
- Bid: highest price buyers offer
- Ask: lowest price sellers accept
- Mid: (Bid + Ask) / 2
- Spread: Ask - Bid
- Last: most recent traded price
- Volume: contracts traded today
- Open Interest: outstanding contracts

### 7.2 Example Quote Payload
```json
{
  "contract": "O:SOFI250117C00008000",
  "bid": 3.00,
  "ask": 3.05,
  "mid": 3.03,
  "spread": 0.05,
  "last": 3.02,
  "volume": 12345,
  "openInterest": 45678
}
```

### 7.3 Order Book Mini-snapshot (teaching)
```json
{
  "bids": [
    { "price": 3.00, "size": 120 },
    { "price": 2.99, "size": 80 },
    { "price": 2.98, "size": 200 }
  ],
  "asks": [
    { "price": 3.05, "size": 110 },
    { "price": 3.06, "size": 90 },
    { "price": 3.07, "size": 160 }
  ]
}
```

---

## 8) Streaming Prioritization Policy (Must-have)

Policy
- Stream only the active chart's symbol (and timeframe if needed)
- Keep watchlist cards on REST snapshots (not streams)
- Options:
  - stream contract candle data only when user is focused on that contract
- Cap WS subscriptions (hard limit) to avoid runaway usage

Suggested limits
- Max 1 active equity stream
- Max 1 active option stream
- Max 0 watchlist streams (REST only)

---

## 9) Rate-Limit Strategy (Degrade Without Breaking)

Behavior
- If throttled:
  - keep last bars displayed
  - set health.mode = DEGRADED
  - show small banner: "Rate-limited — showing last known data"
  - respect Retry-After; apply cooldown

Logging
- log each throttle event with:
  - endpoint
  - symbol/timeframe
  - Retry-After value
  - cooldown time applied

---

## 10) Implementation Plan (Phased)

### Phase 1 — Immediate Reliability (High ROI)
- Server-side ring buffer (in-memory)
- Single-flight control (server + client)
- Backfill-on-focus + gap detection
- Rate-limit cooldown + UI health banner
- Health metadata: last update + source

### Phase 2 — True "Live" Equities (If available)
- Add equity WS stream for 1m bars (active symbol only)
- Candle builder merges WS into current minute
- Finalize on minute boundary, append, broadcast

### Phase 3 — Production Scaling
- Redis ring buffer (optional if multi-instance)
- Multi-instance fan-out (pub/sub)
- Provider redundancy strategy (secondary provider fallback)
- Automated data validation alerts

---

## 11) Open Questions (to finalize the best path)
- Does your plan include equity WebSockets, or only options WebSockets?
- Are you okay starting with in-memory cache (best for local/single instance), or do you want Redis now?
- Expected concurrency: 1-10, 10-100, or 100+ clients?
- Is the server running as a single node today, or will it be multi-instance soon?

---

## 12) Definition of "Enterprise-Grade" (Acceptance Criteria)

A chart is "enterprise-grade" when:
- It can be live for the active symbol without client-side request storms
- It handles throttling without blanking or lying
- It backfills gaps and guarantees candle integrity
- It exposes health metadata (source + last update)
- It can scale to multiple clients with consistent results

---

## 13) One-Page Mental Model (Textual)

```text
           +---------------------------+
           |        Massive.com        |
           |  WS: Q / T / A / AM       |
           |  REST: chains / aggs      |
           +-------------+-------------+
                         |
                         v
        +-----------------------------------+
        |        Backend Data Hub           |
        |  - Subscriptions manager          |
        |  - Ring buffer (short-term)       |
        |  - MongoDB (long-term)            |
        |  - Backfill + validation          |
        |  - Health + rate-limit handling   |
        +-------------+---------------------+
                      |
                      v
        +-----------------------------------+
        |           Frontend UI             |
        |  - Charts (read-only renderer)    |
        |  - Options chain + quotes         |
        |  - Health badges + stale state    |
        +-----------------------------------+
```

Rule: the frontend never owns market data. The backend is the single source of truth.

---

## 14) Why Charts Break (Troubleshooting Guide)

### Symptom: candles jump or reset
- Cause: multiple in-flight requests overwrite newer data.
- Fix: single-flight requests + chart key remount per symbol/timeframe.

### Symptom: live + REST collide
- Cause: REST returns finalized bars while WS updates partial bars.
- Fix: explicit candle lifecycle (A updates current, AM finalizes).

### Symptom: blank charts during throttling
- Cause: 429 responses are treated as hard failures.
- Fix: rate-limit cooldown, serve cached bars, set health to DEGRADED.

### Symptom: stale but not indicated
- Cause: no health metadata in responses.
- Fix: return `health` with source + last update and render a badge.

### Symptom: too many requests on symbol switch
- Cause: client fetch loops + no debounce/cancel.
- Fix: cancel old requests and keep last chart visible while updating.

---

## 15) Server-Side DataStore Interface (Core Contract)

```ts
type Candle = {
  symbol: string;
  timeframe: string;
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  source: 'live' | 'backfill' | 'cache' | 'snapshot';
  isFinal: boolean;
  lastUpdatedAt: number;
};

type Health = {
  mode: 'LIVE' | 'DEGRADED' | 'BACKFILLING';
  source: 'rest' | 'cache' | 'snapshot';
  lastUpdateMsAgo: number | null;
  providerThrottled: boolean;
  gapsDetected: number;
};

interface DataStore {
  getBars(symbol: string, timeframe: string): Candle[];
  upsertLiveAggregate(symbol: string, candle: Candle): void;
  finalizeCandle(symbol: string, candle: Candle): void;
  getChainSnapshot(underlying: string): unknown;
  updateLiveQuote(optionSymbol: string, quote: unknown): void;
  getLastQuote(optionSymbol: string): unknown;
  getMarketState(): { isOpen: boolean; isAfterHours: boolean; lastUpdate: number };
  getHealth(symbol: string, timeframe: string): Health;
}
```

---

## 16) TradingView Model Mapping

| TradingView Concept | This System |
| --- | --- |
| Datafeed adapter | Backend data hub |
| Realtime bars | WS `A` / `AM` aggregates |
| Historical bars | REST + MongoDB cache |
| Bar finalization | `AM` events + minute boundary |
| Market status | `marketClosed` + `afterHours` |
| Frozen charts | After-hours mode + cached bars |
| Health indicators | `health` payload + badge |

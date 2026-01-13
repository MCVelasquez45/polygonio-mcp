# Technical Architecture Specification - Trading Application

## 1) Module Specifications

### Chart Data Pipeline (REST + WebSocket)

**Historical data via REST**
- Endpoint: `GET /api/market/aggs`.
- Returns normalized OHLCV bars plus session metadata (`marketClosed`, `afterHours`, `usingLastSession`, `resultGranularity`, `note`).
- Cached in MongoDB (`option_aggregates`) to protect provider limits.
- Unique index: `(ticker, timespan, multiplier, timestamp)` to avoid duplicate bars.
- Aggregates worker can pre-warm popular symbols (opt-in via `AGG_WORKER_ENABLED=true`).
- Default UI timeframe is `1/day` to ensure context on first load.

**Intraday live updates via WebSockets**
- Massive WebSocket provides `A` (sub-minute) and `AM` (1-minute) aggregate events.
- Chart hub builds candles, maintains a ring buffer, and emits `chart:snapshot`/`chart:update` events.
- Client renders bars only (no candle merging or buffering).
- Higher timeframes rely on REST refresh + cache; no live streaming for 1h/1d.

**Underlying vs. option charting**
- Intraday option charts use the underlying ticker candles to avoid gaps.
- Daily charts can use the option’s own historical bars.

**Session + fallback handling**
- Rate-limit aware: on 429, intraday fetches are blocked temporarily and cached bars are served.
- Response includes `note` and `usingLastSession` when fallbacks are used.
- UI shows “Frozen” or “Degraded” indicators when appropriate; never blanks the chart.

**Data flow summary**
- Only the active symbol/timeframe is streamed.
- Server is the hub: single-flight REST fetch, Mongo cache, fan-out to clients.
- Clients see a consistent bar series (real-time when possible, cached when not).

### Quote Event Handler (Real-Time Updates + Fallback)

**NBBO streaming**
- Massive `Q` events deliver bid/ask updates.
- Client subscribes via `live:subscribe` for the selected contract + near-ATM set.
- Backend broadcasts `live:quote`; client updates `liveChainQuotes` map.

**Trade ticks**
- Massive `T` events broadcast as `live:trades`.
- Client stores latest trade per symbol and appends to tape for the active contract.

**Subscription management**
- Server tracks socket subscriptions per symbol and unsubscribes when unused.
- Prevents unnecessary bandwidth and provider load.

**Failure modes**
- Socket.IO falls back to polling on WS failure.
- Initial REST snapshot (`/api/market/quotes/:contract`) hydrates UI before first tick.
- Market closed: no live updates; UI shows stale/paused status.

### Option Chain Rendering + Selection

**Chain structure**
- Endpoint: `GET /api/market/options/chain/:ticker`.
- Returns `expirations[]` with `strikes[]` and `call/put` legs per strike.
- Expirations list via `GET /api/market/options/expirations/:ticker`.

**Selection flow**
- Clicking a contract persists selection (`POST /api/market/options/selection`).
- Client hydrates quotes + trades on select.
- `GET /api/market/options/contracts/:symbol` fills missing Greeks/IV/OI.

**Live chain updates**
- Near-ATM symbols are subscribed for live quotes.
- Live quotes override snapshot bids/asks; non-streamed strikes show cached values.

### Bid-Ask Matrix Strategy

- Stream only near-ATM strikes + selected contract.
- Merge live NBBO into the chain grid, fallback to snapshots.
- Unsubscribe symbols that leave the near-ATM window to prevent stale “live” data.

## 2) Data Schema (MongoDB)

### `option_aggregates`
- `ticker`, `timespan`, `multiplier`, `timestamp` (unique compound index).
- OHLCV + optional `vwap`, `transactions`.
- `source` and `updatedAt` for provenance and recency.

### `option_chain_snapshots`
- Keyed by `underlying` + `expiration` (unique index).
- Stores full chain snapshot in `data`.
- TTL on `updatedAt` (24 hours) to avoid stale chains.

### (Optional) `option_quotes` (future)
- `ticker` (unique), `bidPrice`, `askPrice`, `lastPrice`, `midpoint`, `updatedAt`.
- Helps recover last known quotes after restarts or in multi-instance deployments.

### Market status (in-memory cache)
- Fetched from Massive `/v1/marketstatus/now`.
- Cached for ~30s and embedded in aggregate responses.

## 3) Backend API Contract

### REST
- `GET /api/market/watchlist?tickers=`: watchlist snapshots.
- `GET /api/market/aggs`: aggregate bars + session metadata.
- `POST /api/market/aggs/warm`: warm-up hints.
- `GET /api/market/options/chain/:ticker`: option chain.
- `GET /api/market/options/expirations/:ticker`: expirations list.
- `POST /api/market/options/selection`: save selection.
- `GET /api/market/options/selection`: load selection.
- `GET /api/market/quotes/:contract`: NBBO snapshot.
- `GET /api/market/trades/:contract`: recent trades.

### WebSocket (Socket.IO)
**Client -> Server**
- `live:subscribe { symbol }`: subscribe to option streams.
- `live:unsubscribe { symbol }`: remove subscription.
- `chart:focus { symbol, timeframe, sessionMode }`: set active chart focus.

**Server -> Client**
- `live:quote`: NBBO updates.
- `live:trades`: trade ticks.
- `live:error`: subscription errors.
- `chart:snapshot`: initial chart payload (bars + session meta + health).
- `chart:update`: incremental bar updates + health.
- `chart:error`: chart backfill or stream errors.

## 4) Frontend State & Data Shapes

### Chart Panel
- `bars: AggregateBar[]`
- `indicators: IndicatorBundle`
- `timeframe: string`
- `sessionMeta: { marketClosed, afterHours, usingLastSession, note, ... }`
- Chart hub streams the active focus; client renders bars only.

### Options Chain
- `groups: OptionChainExpirationGroup[]`
- `selectedExpiration: string | null`
- `selectedContract: OptionLeg | null`
- `liveQuotes: Record<symbol, QuoteSnapshot>`
- `liveTrades: Record<symbol, TradePrint>`

### Live Maps
- `liveChainQuotes` and `liveChainTrades` are keyed by option symbol.
- Entries are removed on unsubscribe to prevent stale “live” visuals.

### Market Status Indicators
- Banner for closed/after-hours.
- “Frozen”/“Degraded” signals from `sessionMeta.note`.
- Live dots only when quotes are actively streaming.

## 5) Deployment and Scaling Considerations

**Rate limits**
- 429 handling blocks intraday fetch for a cooldown window.
- Cached data is served with explicit notes to avoid blank charts.

**Single-flight**
- In-flight request dedupe per symbol/timeframe to prevent duplicate provider calls.

**Scaling strategy**
- For multi-instance: use Socket.IO Redis adapter for room fan-out.
- Consider centralized stream ingestion + Redis pub/sub for live events.
- MongoDB remains the durable cache; Redis is optional for speed + fan-out.

**Operational notes**
- Ensure `MASSIVE_API_KEY` and Mongo URI are set in all environments.
- Keep `AGG_WORKER_ENABLED` off unless you need warm-up in production.

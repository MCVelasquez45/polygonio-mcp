# Trading Workflows

This document summarizes how the desk should use the latest build. Share it with any operator so they can reproduce the exact UX we designed.

## 1. Launching the Stack
1. Start the server: `cd server && npm run dev` (needs Massive + Mongo env vars).  
2. Start the client: `cd client && npm run dev`.  
3. Optional: start the FastAPI “brain” if you want AI scanner notes.

## 2. Watchlist & Scanner Flow
1. Use the sidebar search (supports equities or `O:` contracts).  
2. Add to watchlist; the client immediately calls `GET /api/market/watchlist` to hydrate price, change, IV, and reference contracts.  
3. Every watchlist change triggers `POST /api/analysis/watchlist`, so the AI scanner displays fresh desk notes. If FastAPI is offline we render the hardcoded fallback rows.

## 3. Charting & Timeframes
- Default timeframe is `1/day` to guarantee context at load.  
- Buttons expose `1m | 3m | 5m | 15m | 30m | 1h | 1d`.  
- Backend always fetches 1m Massive bars, aggregates higher intervals locally, and caches results for 2–5 minutes.  
- If Massive says the market is closed, we automatically fall back to the last session and show the “Frozen” badge.

## 4. Selecting Contracts
1. Pick any strike/expiration in the chain (grid updates in real time).  
2. Selection POSTs back to the server, which hydrates quotes + trades for that contract.  
3. The Greeks/Risk panel reads the hydrated leg and displays:  
   - Meta (strike, premium, IV, OI).  
   - Breakeven calculator.  
   - Raw Greeks.  
   - Entry Checklist (break-even gap, delta ITM odds, IV condition, theta bleed, liquidity).  
   - Risk donut (directional/convexity/decay/vol/liquidity mix) with a delta-based ITM probability badge.

## 5. Market Closed Experience
- When `marketClosed=true`, the UI displays a banner, freezes the last candle with a lock badge, and pauses live polling.  
- Order ticket converts BUY into “Submit DAY Order (Queued)” language and disables market orders (coming from OrderTicketPanel logic).  
- Options chain still loads but warns that quotes are stale.

## 6. AI Desk & Chat
1. “Latest Insight” card shows the most recent AI blurb for the active ticker.  
2. “Ask AI” opens ChatDock. Contract context, chart timeframe, and watchlist snapshot are piped into FastAPI so the assistant can answer position/risk questions.  
3. Conversations persist locally (see `STORAGE_KEY = 'market-copilot.conversations'`).

## 7. Portfolio Panel (Alpaca Paper)
- Displays buying power, equity, cash, and a card-per-position summary by calling Alpaca endpoints (`getBrokerAccount`, `getOptionPositions`).  
- Errors are surfaced inline so ops can see Alpaca outages.

## 8. Background Worker Usage
- Leave `AGG_WORKER_ENABLED` off for local dev.  
- Enable it only when you need continuous cache warming; it respects Massive rate limits but still counts toward your quota.

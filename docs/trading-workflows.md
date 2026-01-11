# Trading Workflows

This document summarizes how the desk should use the latest build. Share it with any operator so they can reproduce the exact UX we designed.

## 1. Launching the Stack
1. Start the server: `cd server && npm run dev` (needs Massive + Mongo env vars).  
2. Start the client: `cd client && npm run dev`.  
3. Optional: start the FastAPI “brain” if you want AI scanner notes.

## 2. Watchlist & Scanner Flow
1. Use the sidebar search (supports equities or `O:` contracts).  
2. Add to watchlist; the client immediately calls `GET /api/market/watchlist` to hydrate price, change, IV, and reference contracts.  
3. The Scanner tab uses a manual “Run AI Scan” button to call `POST /api/analysis/watchlist` and render desk notes (no automatic scan on load). If FastAPI is offline we render the hardcoded fallback rows.
4. The same manual scan triggers `POST /api/analysis/checklist` for the watchlist symbols, highlighting any that clear the entry rules as “High-ROI Ready.”

## 3. Charting & Timeframes
- Default timeframe is `1/day` to guarantee context at load.  
- Buttons expose `1m | 3m | 5m | 15m | 30m | 1h | 1d`.  
- Intraday charts use the underlying ticker so the candles reflect the full trading session, even when an option contract is thinly traded.  
- Time axes and tooltips render in the user’s local timezone (standard time for their locale).  
- 1-hour view uses a 24-bar lookback to show multiple sessions instead of just a single day.  
- Backend always fetches 1m Massive bars, aggregates higher intervals locally, and caches results for 2–5 minutes.  
- If Massive says the market is closed, we automatically fall back to the last session and show the “Frozen” badge.
- RTH/EXT toggle (next to timeframes) switches between regular market hours (9:30–16:00 ET) and extended sessions.
- “Run 5-min analysis” button on the chart runs an opening-range breakout read (5-minute range, volume confirmation, trend alignment, short interest/short volume context). The button is disabled when chart analysis is turned off in Settings.

## 4. Selecting Contracts
1. Pick any strike/expiration in the chain (grid updates in real time).  
2. Selection POSTs back to the server, which hydrates quotes + trades for that contract.  
3. The Greeks/Risk panel reads the hydrated leg and displays:  
   - Meta (strike, premium, IV, OI).  
   - Breakeven calculator.  
   - Raw Greeks.  
   - Entry Checklist (break-even gap, delta ITM odds, IV condition, theta bleed, liquidity).  
   - Risk donut (directional/convexity/decay/vol/liquidity mix) with a delta-based ITM probability badge.
4. The “Entry Checklist” card above the Greeks panel mirrors the backend status (green when all auto rules pass, amber when factors are missing).

## 5. Order Ticket (Beginner Mode)
- Each input has an “Explain” checkbox that reveals a plain-English tip for that field.  
- Use the toggles when onboarding new users so they can follow the order flow step by step.

## 6. Market Closed Experience
- When `marketClosed=true`, the UI displays a banner, freezes the last candle with a lock badge, and pauses live polling.  
- Order ticket converts BUY into “Submit DAY Order (Queued)” language and disables market orders (coming from OrderTicketPanel logic).  
- Options chain still loads but warns that quotes are stale.

## 7. AI Desk & Chat
1. “Latest Insight” card shows the most recent AI blurb for the active ticker.  
2. “Ask AI” opens ChatDock. Contract context, chart timeframe, and watchlist snapshot are piped into FastAPI so the assistant can answer position/risk questions.  
3. Conversations persist locally (see `STORAGE_KEY = 'market-copilot.conversations'`).
4. Settings → AI Request Controls lets you toggle AI features (master switch, chat, desk insights, contract selection/analysis, chart analysis, scanner, portfolio sentiment) and their auto modes.

## 8. Portfolio Panel (Alpaca Paper)
- Displays buying power, equity, cash, and a card-per-position summary by calling Alpaca endpoints (`getBrokerAccount`, `getOptionPositions`).  
- Errors are surfaced inline so ops can see Alpaca outages.

## 9. Background Worker Usage
- Leave `AGG_WORKER_ENABLED` off for local dev.  
- Enable it only when you need continuous cache warming; it respects Massive rate limits but still counts toward your quota.

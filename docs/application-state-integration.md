# Application State & Integration Report

This document factors in the current state of the codebase (as of Jan 15, 2026) with the requirements and issues discussed in the user transcripts.

## 1. Top Priority: Chart Stability Status

### A. The "Race Condition" (History Overwriting Live Data) - **[SOLVED]**
*   **Transcript Issue:** History backfill (REST) finishing after Live updates (WebSocket) caused the history to overwrite and delete the new live candles.
*   **Codebase Status:** Confirmed Fixed.
*   **Evidence:** In `server/src/features/market/services/chartHub/buffer.ts`, the `mergeBars` function explicitly handles this scenario:
    ```typescript
    const newerLiveBars = buffer.bars.filter(bar => bar.t > lastBackfill.t);
    const combined = [...backfilledFinal, ...newerLiveBars];
    ```

### B. The "Live Equity Updates Blocked" - **[FIXED]**
*   **Transcript Issue:** "Live equity updates blocked... supposed to prevent subscribing to live updates for non-option symbols."
*   **Codebase Status:** **Fixed.**
*   **Action Taken:** Modified `server/src/features/market/services/chartHub/index.ts` to remove the `.startsWith('O:')` check. Equities (SPY, AMD, etc.) now receive live aggregate updates.

---

## 2. Architecture & Data Flow Overview

### A. Market Data Pipeline
*   **Provider:** Massive (Polygon MCP Wrapper).
*   **Ingestion:**
    *   **REST:** Historical Backfills (Day/Minute bars).
    *   **WebSocket:** Real-time Aggregates (`ingestLiveAggregate` in `chartHub`), Quotes, and Trades.
*   **Distribution:** `ChartHub` (Socket.IO) acts as the central broadcaster to the React Frontend. It manages "Buffer State" per ticker/timeframe to ensure clients get a clean merged view of History + Live.

### B. Automation & Trading Engine
*   **Broker:** Alpaca (Paper Trading confirmed).
*   **Integration:** `server/src/features/broker/services/alpaca.ts` handles:
    *   **Order Submission:** `submitAlpacaOptionsOrder`
    *   **Position Sync:** `listAlpacaOptionPositions`
    *   **Status:** The plumbing is ready. The frontend `OrderTicketPanel` is wired to these endpoints.
*   **"Remove Guardrails":** The transcript mentions "allowing it to auto-submit."
    *   **Current State:** `App.tsx` has `AUTO_SUBMIT_ORDERS_KEY`. If enabled, the system *should* be capable of firing orders via `agentClient` -> `contractSelection` -> `alpacaService`.

### C. AI / Scanner Architecture
*   **Agents:**
    *   **Contract Selection:** `analysis/contractSelection.ts` uses a strict JSON prompt to pick a contract based on "Liquidty Constraints" (Spread, OI, Volume).
    *   **Desk Insight:** `analysis/deskInsight.ts` aggregates Short Interest, Short Volume, and Fed Calendar data to give a "Morning Briefing" style summary.
*   **Scanner:**
    *   **Frontend:** `App.tsx` loop polls `analysisApi.getWatchlistReports`.
    *   **Data:** `analysis/deskInsight.ts` already fetches Short Interest/Volume, satisfying the "Big Cap vs Small Cap" filtering needs if wired correctly.

---

## 3. "Journaling" & Visual Markers

*   **Transcript Goal:** "Visual marker of the entrance... so that you can journal each trade."
*   **Codebase Status:** **Partially Implemented.**
*   **Evidence:**
    *   `App.tsx` polls Alpaca for filled orders (`getOptionOrders`).
    *   It maps these fills to `SeriesMarker` objects (`arrowUp` for Buy, `arrowDown` for Sell).
    *   These markers are passed to `ChartPanel`.
*   **Verification:** The logic checks `o.symbol === displayTicker`. We need to ensure that if I am charting `SPY`, and I buy an option `O:SPY250117C00500000`, the marker still appears on the SPY chart.
    *   *Current Logic:* `o.symbol === displayTicker || (o.symbol && o.symbol.startsWith(\`O:${displayTicker}\`))`
    *   *Verdict:* **Logic looks correct.** It validates against the underlying ticker.

---

## 4. Summary of Next Steps

1.  **Deployment:** Dockerize the application as requested ("Stabilize and Deploy").
2.  **Verify Automation:** Test the "Auto Submit" flow with a small paper trade (ensure `AUTO_SUBMIT_ORDERS` flag works end-to-end).
3.  **Strategy Implementation:** The "5-Minute Opening Range" and "Goldback" patterns need to be formalized into the `analysis` logic or a dedicated `strategy` service.

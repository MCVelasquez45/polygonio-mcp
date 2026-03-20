# Transcript Breakdown & Analysis

## Overview
This document breaks down the conversation between Sirrele, Mark, and Fresco regarding the "Polygonio MCP" trading platform. The discussion covers critical bug fixes, architectural changes, trading strategies, and future automation goals.

## 1. Current Platform Capabilities
The application is a trading dashboard connected to **Alpaca** (brokerage/paper trading) and **Massive/Polygon** (market data).
*   **Core Components:**
    *   **Watchlist:** List of assets to monitor.
    *   **Charts:** Real-time candlestick charts (1m, 3m, 5m, etc.).
    *   **Options Chain:** Interface to select call/put contracts.
    *   **Matrix:** Live bid/ask/price book.
    *   **Order Panel:** Manual order entry (Buy/Sell, Limit Price, Take Profit).
    *   **Portfolio:** View open positions and trade history.
    *   **AI Analytics:** System prompts running against live market data to generate insights (currently gated/toggleable).

## 2. Critical Technical Issues (The "Blockers")
Two main issues were identified preventing the platform from being reliable ("stable").

### A. Chart Instability & Data Feed (The "Live Equity" Bug)
*   **Symptom:** Charts render inconsistently when switching tickers or timeframes. "Unusable" charts with missing candles or weird rendering.
*   **Diagnosis:** The system was **blocking live updates for non-option symbols**.
    *   *Transcript Quote:* "Live equity updates blocked... supposed to prevent subscribing to live updates for non-option symbols."
    *   The app was only pulling live data for Options contracts, not the underlying Equities (Stocks like SPY, PLTR), causing charts to fail or look "wonky" for the requested stock tickers.
*   **Proposed Fix:** Remove the artificial filter/restriction so equities satisfy the same "needsLive" condition as options.

### B. Race Condition (The "Overwriting" Bug)
*   **Symptom:** "Chart to jump backwards and losing most recent trades."
*   **Diagnosis:** A race condition between **Historical Data (REST)** and **Live Data (WebSocket)**.
    *   *Process:* App requests history (slow) and subscribes to socket (fast).
    *   *Fail State:* If a live socket update arrives *while* history is downloading, the history download finishes later and blindly *overwrites* the buffer, deleting the new live candle.
*   **Proposed Fix:** Implement a "New Merger Strategy" (Data Hub). The system must merge historical backfill with any live updates that accumulated in the buffer, rather than replacing the buffer entirely.

## 3. Trading Strategies Discussed
The team discussed specific technical analysis strategies to be automated.

### A. The "5-Minute Opening Range" Strategy (Sirrele's Model)
*   **Logic:**
    1.  Wait for the first 5-minute candle of the session (9:30-9:35 AM ET) to close.
    2.  Mark the **High** and **Low** of this candle (Horizontal Lines).
    3.  Wait 10-15 minutes to observe "Resistance and Support" against these lines.
    4.  **Signal:** A breakout in one direction indicates the trend for the day.

### B. The "Time Window / Goldback" Strategy (Fresco's Model)
*   **Concept:** Markets move in "Fractal Windows" or blocks of time (4-hour, Daily, 5-minute).
*   **Logic:**
    1.  Identify the Previous Window (e.g., the previous 4-hour block).
    2.  Mark the **High** and **Low** of that previous block.
    3.  **Signal:**
        *   **Sweep & Reverse:** Price breaks the line (sweep) and immediately reverses back into the range.
        *   **Break & Retest:** Price breaks the line, comes back to touch it (now as support), and continues away.
*   **Application:** Can be applied to Options by using these macro timeframe signals to pick direction, then 5-minute charts for entry.

## 4. Automation & Future Roadmap
*   **Scanner:** currently disabled to save costs, but capable of filtering "Big Caps" vs "Small Caps" using sentiment and short interest.
*   **Auto-Trading:** "Remove the guardrails." The system currently auto-selects contracts and populates the order panel. Next step is to allow it to auto-submit to Alpaca.
*   **Journaling / Mirroring:**
    *   **Request:** A "Mirror" feature to record trading sessions or, more practically, to **visually marker entries/exits** on the chart automatically.
    *   **Goal:** Allow "Game Film" review. See exactly where the AI/User entered and exited to refine prompts and strategy.

## 5. Deployment & Infrastructure
*   **Server:** Python Fast API wrapper + Node.js.
*   **Scaling:** Discussion of "Fanning out" (Load Balancing/Auto-scaling) on GCP/Cloud Run when user load increases.
*   **Immediate Plan:** "Stabilize and Deploy." Fix the chart bugs, dockerize the app, and get it running in a cloud environment to test the automation on a paper account continuously.

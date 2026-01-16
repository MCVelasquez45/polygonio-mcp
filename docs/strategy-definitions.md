# Trading Strategy Definitions

This document defines the specific rules, entry criteria, and management logic for the automated trading strategies discussed by the team (Sirrele & Fresco).

## 1. The "Time Window" Strategy (Goldback)

**Core Concept:** Markets move in fractal time blocks. The High and Low of a *previous* macro time block serve as critical liquidity levels (Support/Resistance) for the *current* pricing action.

### Configuration
*   **Macro Window:** The reference timeframe to define levels (e.g., Previous 4-Hour Candle, Previous Daily Candle, or a specific time range like 09:30-10:30).
*   **Micro Window:** The execution timeframe (e.g., 5-minute or 1-minute chart).
*   **Assets:** Futures (ES, NQ) or Index Options (SPY, QQQ).

### Setup Logic
1.  **Identify the Macro Range:**
    *   Find the High price ($H_{macro}$) and Low price ($L_{macro}$) of the *completed* previous window.
    *   *Example:* At 14:00 ET, look at the 10:00-14:00 4-hour candle.
2.  **Draw Levels:**
    *   Plot Horizontal Line at $H_{macro}$.
    *   Plot Horizontal Line at $L_{macro}$.

### Entry Triggers

#### A. The "Sweep & Reverse" (Fake-out)
*   **Context:** Price breaks *beyond* the level ($H_{macro}$ or $L_{macro}$) to "sweep" liquidity, then fails to hold.
*   **Trigger Condition:**
    1.  Price creates a High above $H_{macro}$.
    2.  Price *closes* the Micro candle (5m) **back inside** the range (below $H_{macro}$).
*   **Trade:**
    *   **Action:** Short / Buy Put.
    *   **Stop Loss:** Just above the "Sweep" High.
    *   **Target:** Mid-range or opposite-side liquidity ($L_{macro}$).

#### B. The "Break & Retest" (Trend Continuation)
*   **Context:** Price breaks the level and establishes it as new support.
*   **Trigger Condition:**
    1.  Price closes firmly *outside* the level ($H_{macro}$).
    2.  Price pulls back to touch $H_{macro}$ (now Support).
    3.  Price bounces (green candle) from $H_{macro}$.
*   **Trade:**
    *   **Action:** Long / Buy Call.
    *   **Stop Loss:** Just below $H_{macro}$.
    *   **Target:** Measured move extension (1.5x range).

---

## 2. The "5-Minute Opening Range" Strategy (Sirrele's Model)

**Core Concept:** The first 5 minutes of the NYSE session (09:30-09:35 ET) set the initial balance. The breakout from this range often dictates the morning trend.

### Configuration
*   **Timeframe:** 5-Minute Chart.
*   **Session Start:** 09:30 AM ET.
*   **Wait Period:** 09:30 - 09:35 AM ET (First Candle).

### Setup Logic
1.  **Wait:** Do not trade during the first 5 minutes.
2.  **Mark Levels:**
    *   Record $H_{opening}$ (High of 09:30 candle).
    *   Record $L_{opening}$ (Low of 09:30 candle).
3.  **Observation Phase:**
    *   Wait for 10-15 minutes (2-3 more candles) to see how price reacts to these levels.

### Entry Triggers

#### A. Confirmed Breakout
*   **Condition:** A 5-minute candle *closes* above $H_{opening}$ or below $L_{opening}$.
*   **Confirmation:** Volume expansion on the breakout candle.
*   **Trade:**
    *   Enter in direction of breakout.
    *   **Stop Loss:** The midpoint of the opening range (or the opposite side for lower risk/higher accumulation).

#### B. Range Rejection (Fade)
*   **Condition:** Price attempts to break $H_{opening}$ but leaves a long upper wick and closes back inside.
*   **Trade:**
    *   Fade the move (Go Short).
    *   **Target:** $L_{opening}$ (Bottom of range).

---

## 3. Automation Requirements

To automate these, the System Agent must:
1.  **Access Historical Data:** To calculate $H_{macro}$ / $L_{macro}$ from past candles.
2.  **Monitor Live Feed:** To watch for "Sweeps" (High > Level) and "Closes" (Close < Level) in real-time.
3.  **Execute:** Submit orders to Alpaca when logic equates to TRUE.

# Custom Algorithm Use Cases (Min-Heap / Top-K)

The `MarketLeaderboard` algorithm (located in `agent/core/algo.py`) uses a **Min-Heap** data structure to efficiently maintain a list of the "Top K" items from any data stream or large dataset.

Because it operates with **O(1) insertion** for the heap (once full) and doesn't require sorting the entire dataset, it is ideal for processing large batches of API data or real-time streams to find signals.

## 1. Scanner Applications
*Filtering lists to find opportunities.*

### 🔍 Cross-Ticker "Market Scanner"
Instead of analyzing one stock, scan a watchlist (e.g., "The Magnificent 7") to find the best opportunities globally.
*   **Metric:** Any custom score (e.g., Highest Volume, Lowest IV).
*   **Logic:** Feed data from multiple API calls into a single global `MarketLeaderboard`.
*   **Agent Query:** "Find the top 5 cheapest calls (by IV rank) across NVDA, AMD, and INTC."

### 📰 "News Relevance" Scorer
Filter through hundreds of news headlines to find the ones that actually matter.
*   **Metric:** Keyword Weighted Score.
    *   Title contains Ticker: +10 pts
    *   Source is "Breaking News": +5 pts
    *   Source is "Opinion": -5 pts
*   **Logic:** Rank 100+ articles from `get_polygon_ticker_sentiment` and return only the Top 3.
*   **Agent Query:** "What are the top 3 most critical news stories for AAPL today?"

### 🚀 "Earnings Surprise" Hunter
Identify companies that vastly outperformed expectations.
*   **Metric:** `(Actual EPS - Estimated EPS) / Estimated EPS`
*   **Logic:** Fetch earnings history for a sector and rank by the surprise percentage.
*   **Agent Query:** "Which Tech stocks beat earnings by the widest margin last quarter?"

---

## 2. Flow & "Smart Money" Analysis
*Analyzing trade tape and volume.*

### 🐋 "Unusual Whales" Tape Reader
Filter the raw trade tape to find massive institutional block trades.
*   **Metric:** `trade_size * trade_price` (Notional Value).
*   **Logic:** Process thousands of rows from `get_polygon_option_trades` and keep only the largest prints.
*   **Agent Query:** "Show me the top 10 largest block trades for SPY today executed above the ask."

### 🏛️ "Suspicious" Politician Ranking
Highlight potential insider trading or lack of transparency.
*   **Metric:** `(Reporting Date - Trade Date).days` (Reporting Lag).
*   **Logic:** Rank Capitol Trades data to find politicians who waited months to report a trade.
*   **Agent Query:** "Which politicians waited the longest to report their trades?"

### 💧 "Most Liquid" Contract Finder
Help execution by finding contracts with the tightest spreads.
*   **Metric:** `(Ask - Bid) / Mid Price` (Spread %).
*   **Logic:** Use the heap to keep the **Smallest** values (tightest spreads).
*   **Agent Query:** "Which AAPL call strike has the tightest spread right now?"

---

## 3. Advanced Quant Analysis
*Derived metrics and technical indicators.*

### 🍋 The "Gamma Squeeze" Detector
Identify price levels where Market Makers are forced to hedge aggressively.
*   **Metric:** `Gamma * Open Interest * 100` (Total Gamma Exposure).
*   **Logic:** Scan the option chain and rank strikes by their total GEX.
*   **Agent Query:** "What are the top 3 Gamma exposure levels for SPY?"

### 📉 "IV Percentile" Screener
Determine if options are historically cheap or expensive relative to themselves.
*   **Metric:** `(Current IV - Low IV_52wk) / (High IV_52wk - Low IV_52wk)`.
*   **Logic:** Compare current snapshot IV against historical daily bar volatility.
*   **Agent Query:** "Is Disney volatility cheap or expensive right now compared to the last year?"

### 📊 "RSI" Oversold/Overbought Scanner
Technical analysis sorting.
*   **Metric:** RSI(14) Value.
*   **Logic:**
    *   **Oversold:** Keep Lowest values (e.g., RSI < 30).
    *   **Overbought:** Keep Highest values (e.g., RSI > 70).
*   **Agent Query:** "Which Dow 30 stocks are currently oversold on the 1-hour chart?"

---

## 4. Architectural Port (Node.js)
*Real-time Dashboard Feature.*

### ⚡ Server-Side "Live Movers" Widget
*   **Implementation:** Port `MarketLeaderboard` to **TypeScript** in `server/src`.
*   **Usage:** Attach to the WebSocket stream in `deskInsight.ts`.
*   **Benefit:** Allows the Dashboard UI to display a live-updating "Top 5 Gainers" widget that updates every millisecond with O(1) efficiency, without frontend lag.

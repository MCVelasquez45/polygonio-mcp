# Opening Range Directional Options Strategy (ORBD)

## 1. Thesis & Hypothesis
The market’s first few minutes establish an information-dense price range that reflects overnight positioning and opening order flow. If price subsequently accepts above or below this range, confirmed by higher-timeframe candles (15–30 minutes), the market is likely to trend in that direction for a meaningful portion of the session. This directional bias can be efficiently expressed using short-dated options with predefined risk and reward.

## 2. Decision Engine vs. Execution Mechanics

### Strategy Intent (Decision Engine)
These are the core logic parameters that define the strategy's edge and are worth optimizing:
- **Opening Range Duration**: Typically 5 minutes (can be 3, 10, etc.).
- **Confirmation Timeframes**: 15m and 30m candle closes relative to the Opening Range (OR).
- **Breakout Condition**: Price holds above OR High (Bullish) or below OR Low (Bearish).
- **Option Type Selection**: Inferred from direction (Call for Bullish, Put for Bearish).
- **Days to Expiry (DTE)**: Selection of 0DTE or 1-3 DTE contracts.
- **Delta Target**: Target delta (e.g., 0.15–0.30) for leverage and decay management.
- **Stop Loss Rule**: Percentage of premium (e.g., -30%) or OR invalidation.
- **Take Profit Rule**: Fixed ROI (e.g., +50%) or technical target.
- **Position Size**: % of account or fixed risk.

### Execution Mechanics (Broker Layer)
These should be handled by the execution engine, not defined in the strategy thesis:
- Bid/Mid/Ask pricing.
- Limit vs. Market orders.
- Order chaining/bracket orders.
- Exact entry price derivation.

## 3. Implementation Patterns
The strategy should output an **Intent** (Buy Call/Put), **Instrument** (based on Delta/DTE), and **Risk Rules** (Stop/Target). The execution layer then decides *how* to fulfill that intent (e.g., placing a limit at mid).

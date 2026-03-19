# Strategy Backtest Engine

This document describes the current server-side strategy backtest engine used by the Strategy Pipeline.

## Scope

The backtest engine consumes:

- a validated `StrategyRuntimeSpec`
- historical OHLCV bars from Massive.com

It does not modify:

- parser behavior
- AST generation
- DSL generation
- frontend rendering

## Data Source

Historical bars are fetched from Massive aggregates:

- endpoint: `/v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}`
- provider file: `server/src/features/marketData/massiveProvider.ts`

The provider includes:

- ascending deterministic ordering
- pagination through `next_url`
- in-memory caching by symbol + timeframe + date range
- basic retry handling for `429`
- normalization to `{ timestamp, open, high, low, close, volume }`

Option symbols are normalized to Massive format:

- valid example: `O:SPY251219C00650000`

## Session Logic

Backtests operate on regular U.S. equity session bars only:

- market session timezone: `America/New_York`
- regular hours: `9:30 AM` to `4:00 PM` ET
- DST is handled by timezone conversion, not hardcoded UTC windows

Session VWAP is reset by ET trading day, not UTC date.

## Execution Assumptions

Execution remains deterministic.

- no randomness
- same runtime spec + same historical data => same result
- same ordering of bars and indicators => same trades

The engine currently applies:

- deterministic slippage of `0.05%`
- long/short direction from `runtimeSpec.execution.action`
- indicator set:
  - RSI (Wilder smoothing)
  - session VWAP
  - EMA 9
  - EMA 20
  - MACD-derived signal

## Symbol Resolution

Ticker resolution order:

1. `runtimeSpec.symbol` if present
2. `STRATEGY_BACKTEST_TICKER`
3. `SPY`

This preserves backward compatibility while allowing future runtime-spec symbol support.

## Environment

Required:

- `MASSIVE_API_KEY`

Useful overrides:

- `STRATEGY_BACKTEST_TICKER`
- `STRATEGY_BACKTEST_FROM`
- `STRATEGY_BACKTEST_TO`
- `MASSIVE_BACKTEST_CACHE_TTL_MS`
- `MASSIVE_BACKTEST_MAX_RETRIES`
- `MASSIVE_BACKTEST_MAX_PAGES`

## Validation Checklist

Recommended manual checks before merging major engine changes:

1. Cross-day VWAP reset
   - confirm VWAP resets per ET session day
2. DST boundary behavior
   - test a range spanning a DST change
3. Cache repeatability
   - same request twice should return identical results and avoid duplicate provider fetches
4. Option ticker normalization
   - verify option contracts keep `O:` with no embedded whitespace
5. Empty-data handling
   - confirm the engine fails cleanly when too few regular-session bars are returned

## Current Limitations

- no commissions model beyond deterministic slippage
- no partial fills
- no spread-aware option execution model
- no corporate action adjustments beyond provider response
- no paper-trading/live handoff in this engine layer

# PROJECT STORY: additional-auto-features

## Session History
| Date | Summary |
|------|---------|
| 2026-02-27 | Reviewed backtest results and credit spread simulation engine progress |
| 2026-02-27 | Discussion with Robert re: VectorBT Pro integration vs custom backtester |
| 2026-03-01 | Full backtesting engine audit — identified 3 critical, 4 high, 2 medium issues |

## Context
- **Branch**: `additional-auto-features`
- **Repo**: polygonio-mcp
- **Location**: `/Users/sirrelesteinfeld_1/projects/polygonio-mcp`

## Current State
### Credit Spread Backtest Engine — Working
- Root cause identified: backtest was running SMA crossover fallback instead of credit spread strategy
- `strategy_template_type: '0dte'` was being stripped in routes before reaching engine
- Full credit spread simulation engine built in `futuresBacktest.service.ts`
- Version history shows progression from broken (v9: -5.25%, 28.6% WR) to working (v13: +2.03%, 98.2% WR, Sharpe 13.45)

### Changes Already Made
1. Credit spread simulation engine with delta-to-OTM conversion, entry filters, risk management
2. Route fix — stopped stripping `strategy_template_type`
3. Profit factor bug fix (was fake formula `1 + totalReturnPct * 2`)
4. Type updates for `profitFactor` in metrics

### AI Suggestions Pending
- Increase `option_delta_target` from 0.05 to 0.08
- Tighten risk management rules (1.5x credit max loss, 10-15min timer, 1% daily cap)
- Refine entry rules (0.7% distance on VIX>20, 1.1x ATR filter, dashboard confirmations)
- Disable iron condor variant during optimization

## Decisions Made
- Credit spread engine uses inverse normal CDF + ATR-based volatility for OTM distance
- Afternoon price excursion modeled from daily OHLC
- Entry filters: up/down day detection, ATR volatility, trend clarity, daily risk limit

## Changes This Session

### 1. Credit Spread Engine — AI Suggestion Parameters (Task 1)
**File**: `server/src/features/futures/services/futuresBacktest.service.ts`
- Added `allowIronCondor` toggle to `CreditSpreadConfig` (default true, disableable)
- Added `highVolMinDistancePct` (0.7% floor on high-vol days, ~VIX>20)
- Added `highVolThreshold` (daily vol pct threshold for adaptive distance)
- Added `newTradeCutoffPct` (stop new trades when daily DD > 0.7%)
- New entry filter: drawdown cutoff gate before OTM distance calc
- High-vol adaptive OTM distance: floor at 0.7% when daily vol exceeds threshold
- All new fields parsed from strategy params and risk management rules
- Diagnostics now include `skippedDrawdownCutoff`, `highVolDays`, and full config

### 2. Stress Test Engine (Task 2)
**Files**: `futuresBacktest.service.ts`, `futures.routes.ts`, `client/src/api/futures.ts`, `client/src/types/futures.ts`
- 8 built-in stress scenarios: Baseline, Vol Shock 2x/3x, Afternoon Frac 0.50/0.65, Wide Spreads+High Vol, Tight Stops 1x, Loose Stops 3x
- New `runStressTest()` export runs all scenarios against same bar data
- New `POST /backtest/stress-test` endpoint
- Client types: `StressTestScenarioResult`, `StressTestResponse`
- Client API: `futuresApi.runStressTest()`

### 3. UI Enhancements (Task 3)
**File**: `client/src/components/lab/BacktestResultsPanel.tsx`
- Individual suggestion toggles: checkboxes on each suggestion card, click to select/deselect
- Selection counter: "3/4 selected" in header
- Apply/Iterate buttons show count and disable when none selected
- Only selected suggestions get sent to backend
- New Stress Test panel with "Run Stress Test" button
- Stress results table with scenario name, all metrics, and delta-vs-baseline badges
- Deselected suggestions visually dimmed (0.45 opacity), hover to preview

### 4. v18 AI Suggestion Implementation (Session 2 — 2026-02-27)
**File**: `server/src/features/futures/services/futuresBacktest.service.ts`
- **VIX proxy filter**: New `vixChangePctMax` field in `CreditSpreadConfig` — skips days where ATR increased >3.5% day-over-day (proxy for intraday VIX spike)
- **`entry_volatility_filters` parsing**: Now reads `vix_intraday_change_pct_max` and `atr_ratio_max` from strategy params
- **Updated defaults for v18**:
  - `maxLossMultiple`: 2.0 → 1.2 (tighter stop on spread losses)
  - `minLayersBetween`: 3 → 4 (more S/R layers required between price and strike)
  - `dailyRiskPct`: 0.02 → 0.0075 (0.75% daily risk cap)
  - `atrFilterMultiple`: now sourced from `entry_volatility_filters.atr_ratio_max` (default 1.1)
  - `vixChangePctMax`: 3.5% (new filter)
- **Stress test**: Added "Relaxed VIX Filter (7.5%)" scenario
- **Diagnostics**: Added `vixChangePctMax`, `minLayersBetween`, `skippedVixChange` to output

### 5. Vol Shock Bug Fix (Session 3 — 2026-02-27)
**File**: `server/src/features/futures/services/futuresBacktest.service.ts`
- Stress test Vol Shock 2x/3x was showing 100% win rate + higher returns — backwards
- Root cause: `volMultiplier` increased OTM distance but afternoon excursion used actual bar data
- Fix: Scale afternoon excursion by `volMultiplier` so price swings are proportionally larger

### 6. Stress Test → AI Suggestions Integration (Session 3)
**Files**: `server/src/features/lab/lab.routes.ts`, `client/src/components/lab/BacktestResultsPanel.tsx`
- AI review endpoint now accepts optional `stressTestResults` in request body
- Stress results injected into AI prompt with instructions to flag failing scenarios
- Client passes `stressResults` when calling AI review if stress test has been run

### 7. Version Comparison UI (Session 3)
**File**: `client/src/components/lab/BacktestResultsPanel.tsx`
- Added `computeParamDiff()` — diffs params between two version snapshots
- Expanded version detail now shows:
  - Parameter changes with color-coded diff (added/removed/changed)
  - Revert button to roll back strategy to a prior version
  - Toggle to show/hide full parameter snapshot
- Added `revertToVersion()` client API call
- CSS styles for diff indicators (green=added, red=removed, blue=changed)

### 8. Paper Trading Bridge (Session 3)
**Files**: `server/src/features/futures/services/paperRuntime.service.ts`, `server/src/features/futures/futures.routes.ts`, `client/src/api/futures.ts`
- **Strategy-aware paper sessions**: Pass strategy rules when starting paper session
- **Signal engine integration**: `createStrategyTimer()` evaluates rules on each 3-second tick instead of random fills
- **Real price initialization**: `fetchInitialPriceData()` pulls last 50 daily bars from Polygon.io for indicator warmup
- **Mark price**: Starts from real Polygon.io close, not hardcoded base price
- **Signal-driven fills**: Trades based on SMA/EMA/RSI/ATR rule evaluation, not random 20% chance
- **Proper PnL tracking**: Slippage, fees, realized/unrealized split, risk metrics
- **Socket.io events**: Fill events now include `signalSource` and `reason`
- **Route integration**: `/paper/start` loads strategy rules from DB and passes to runtime
- **Backward compatible**: Sessions without strategy rules use original simulated timer

### 9. Backtesting Engine Audit (Session 4 — 2026-03-01)
- Full code audit of data layer, signal engine, and backtest simulation
- Identified 3 critical, 4 high, 2 medium issues

### 10. Backtesting Engine Fixes (Session 4 — 2026-03-01)
All 6 audit findings implemented:

**`databentoGateway.service.ts`:**
- Synthetic data now throws by default; requires explicit `allowSyntheticData: true`
- Fixed upward bias in synthetic data (`random() - 0.49` → `random() - 0.5`)
- Added `proxyTicker` and `requestedSymbol` fields to `FuturesBarResponse`

**`polygonGateway.service.ts` (rewritten):**
- Tries actual symbol first via Polygon; only falls back to ETF proxy if no data
- ETF proxy bars are now price-scaled by approximate ratio (ES: 10x, NQ: 40x, etc.)
- Proxy usage tracked in response (`proxyTicker`, `requestedSymbol`, `sourceMessage`)

**`signalEngine.service.ts`:**
- RSI now uses Wilder's smoothed RSI (seed SMA → exponential smoothing)
- New `precomputeIndicators()` — O(n) single-pass for SMA, EMA, RSI, ATR
- SMA/EMA rule matchers now use captured period (e.g., "50-period SMA" → `computeSMA(history, 50)`)

**`futuresBacktest.service.ts`:**
- **Look-ahead bias eliminated**: entry decision uses previous bar, strike placement uses today's open, outcome uses today's high/low
- Stress test loop updated with same look-ahead fix
- Directional backtest uses `precomputeIndicators()` — O(1) per-bar lookup
- History window dynamically sized based on max period in strategy rules
- Diagnostics include `proxyTicker` and `requestedSymbol`

## Action Items
- [x] Apply AI suggestions to engine config
- [x] Add stress test scenarios
- [x] Build individual suggestion toggles in UI
- [x] Add stress test panel to BacktestResultsPanel
- [x] Implement v18 parameter suggestions (VIX filter, max loss 1.2x, 4 layers, 0.75% daily cap)
- [x] Fix vol shock stress test bug (afternoon excursion scaling)
- [x] Wire stress test results into AI review prompt
- [x] Version comparison UI with param diffs and revert
- [x] Paper trading bridge with signal engine integration
- [x] **FIX: ETF proxy → try actual symbol first, price-scaled proxy fallback**
- [x] **FIX: Synthetic data guard (throws unless explicit opt-in)**
- [x] **FIX: RSI → Wilder's smoothed RSI**
- [x] **FIX: Look-ahead bias eliminated (prev bar decision, open entry, high/low outcome)**
- [x] **FIX: O(n^2) → O(n) precomputed indicators**
- [x] **FIX: SMA/EMA period from rules now used by pattern matchers**
- [ ] Switch to intraday bars for 0-DTE credit spread simulation
- [ ] VectorBT Pro integration for data + backtest engine
- [ ] Run actual backtest with v18 parameters and compare to previous results
- [ ] Run stress test and evaluate results with fixed engine
- [ ] Test paper trading deployment end-to-end

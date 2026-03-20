# TradingView-Style Chart Integration Plan

## Background

- The current `ChartPanel` (`client/src/components/trading/ChartPanel.tsx`) renders Massive option aggregates with Recharts area/volume pairs.
- The new `trade-chart-client-refference` project ships a TradingView experience using `react-ts-tradingview-widgets` → `AdvancedRealTimeChart`, which relies on TradingView’s hosted data feed.
- Requirement: upgrade our trading chart to the TradingView look/feel while continuing to source data from Massive (where possible).

## Findings

| Option | Pros | Cons | Notes |
| --- | --- | --- | --- |
| Embed `AdvancedRealTimeChart` widget (`react-ts-tradingview-widgets`) | Fastest drop-in, auto-resizable, full TradingView UI | Cannot ingest custom data; must use TradingView’s own feeds; license terms limit auth-only dashboards | Works like the reference Next.js app but would sidestep our Massive data entirely |
| TradingView Charting Library (hosted locally) | Production-grade UI, custom datafeeds, indicators | Requires TradingView license + client side hosting of opaque bundle | Would still need to write a Massive-backed `Datafeed` adapter |
| `lightweight-charts` (open source from TradingView) | No license friction, full control over data + theming, supports custom overlays | Doesn’t include full TradingView UI (no built-in toolbar/drawings) so we’d re-create a limited UX | Feasible to drive entirely from our Massive aggregates + websockets |

Given we must keep using Massive’s option candles (intraday + daily), **`lightweight-charts` is the most practical path**. We can still deliver TradingView visuals (colors, gradients, crosshair) without depending on TradingView’s proprietary feed.

## Proposed Approach

1. **Add lightweight charts**  
   - Install `lightweight-charts` + React bindings (either `lightweight-charts` directly with our own wrapper or `lightweight-charts-react`).  
   - Build a new `TradingViewChart` component that accepts `{ candles, indicators, volume, timeframes }`.

2. **Map Massive data to chart series**  
   - Use existing `AggregateBar` arrays for candle series (open/high/low/close/volume).  
   - Reuse SMA indicator output for overlay line.  
   - Pipe streaming updates (when available) into `series.update`.

3. **Reuse existing controls**  
   - Keep the timeframe buttons + metadata from `ChartPanel`.  
   - Swap the Recharts block for the new component so the rest of the panel stays the same.

4. **Add cursor + tooltip parity**  
   - Show crosshair tooltips styled like TradingView.  
   - Display price/percent change for hovered candles; fall back to last close.

5. **Performance considerations**  
   - Destroy/recreate charts when timeframe changes to avoid ghost listeners.  
   - Cap number of candles (e.g., 500) to prevent DOM bloat.

## Implementation Steps

1. **Research/POC**  
   - Prototype `TradingViewChart` inside `client/src/components/trading/experimental/` using static data to validate theming + tooltips.  
   - Confirm we can render both candles + volume histogram inside the same chart (two panes).

2. **Wire to real data**  
   - Map `AggregateBar[]` to `{ time, open, high, low, close, volume }`.  
   - Transform `indicators?.sma?.values` to line series.  
   - Ensure timezone handling matches TradingView (UNIX seconds).

3. **Component swap**  
   - Replace the Recharts block in `ChartPanel` with `<TradingViewChart ... />`.  
   - Keep fallback UI (loading, “select contract”) unchanged.

4. **Testing & polish**  
   - Verify intraday + daily frames.  
   - Check dark mode visual parity with reference (colors, gradients).  
   - Add Cypress/Playwright snapshot or Storybook example for regression coverage.

## Open Questions

1. **Data Source** – Should we allow toggling between Massive data and TradingView feed (if user has TradingView API access)? Default will be Massive-only; confirm if TradingView feed is acceptable as fallback.
2. **Drawing Tools** – Do we need advanced drawing/indicator controls immediately, or is a read-only chart sufficient for v1?
3. **WebSocket Updates** – We currently refresh aggregates via REST. Do we need to wire Massive’s websockets for real-time updates before swapping charts?

## Tracking

Create an enhancement issue titled “Upgrade trading chart to TradingView experience” with the following checklist:

- [ ] Add lightweight chart dependency + wrapper component.
- [ ] Map Massive aggregates to candle + volume series.
- [ ] Integrate new component into `ChartPanel`.
- [ ] Add crosshair/tooltips styled after TradingView.
- [ ] Validate intraday/daily timeframes + SMA overlay.

Link the issue to this plan (`docs/tradingview-chart-plan.md`).

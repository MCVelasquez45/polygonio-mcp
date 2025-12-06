# Watchlist Architecture

This doc describes how watchlist data flows through the app on both the server and
client. Start here when you need to modify the watchlist sidebar, scanner notes,
or the supporting APIs.

## Data Sources

1. **Massive snapshots** – `/api/market/watchlist` returns per-symbol snapshots
   (price, change, greeks, reference contract). The client sidebar relies on this
   for live prices and name updates.
2. **Options analytics** – the Node server calls `getMassiveOptionsSnapshot` and
   `getRecentAggregateBars` to build structured context for the watchlist report
   generator.
3. **Agent service (optional)** – when `AGENT_API_URL` is configured, the server
   asks the FastAPI MCP service to summarize the watchlist context into desk
   notes. If the agent is offline, the code falls back to deterministic Massive
   snapshots so the UI still shows notes.

## Server Modules

- `server/src/features/options/services/watchlistReports.ts`
  - `buildWatchlistContext()` collects snapshots + recent bars for each ticker.
  - `fetchAgentReports()` sends the context to the agent and parses the JSON
    reply into `WatchlistReport` objects.
  - `buildSnapshotReports()` is the fallback path (no agent) that derives basic
    headlines from Massive snapshots.
  - `getWatchlistReports()` is exported to `/api/analysis/watchlist` and returns
    both the reports and the source (`agent`, `snapshot`, or `empty`).

Environment variables:

| Variable | Purpose |
| --- | --- |
| `AGENT_API_URL` / `FASTAPI_URL` | Enables AI summaries. When missing, the code always falls back to snapshot-based notes. |

## Client Modules

- `client/src/components/layout/TradingSidebar.tsx`
  - Hydrates the user-defined watchlist from `localStorage` and seeds it with
    default symbols until live data arrives.
  - Calls `marketApi.getWatchlistSnapshots()` whenever the watchlist changes to
    refresh prices/names.
  - Persists the list back to `localStorage` so tabs retain the user’s symbols.
  - Emits `onWatchlistChange` so higher-level components can trigger analysis
    (e.g., `OptionsScanner`).

## Typical Flow

1. User adds/removes symbols in the sidebar. The component stores the new list
   locally and fires `onWatchlistChange`.
2. App-level state reacts and calls `/api/analysis/watchlist`, which in turn
   executes `getWatchlistReports()`.
3. The server tries the agent first; when unavailable it builds snapshot notes.
4. The client renders those notes (see `OptionsScanner`) and continues polling
   `/api/market/watchlist` for price updates.

## Extending

- **New analytics**: add a helper to `watchlistReports.ts` so the agent prompt
  includes additional metrics (e.g., IV rank, unusual volume) and update the
  fallback builder accordingly.
- **Alternate storage**: if you need multi-user watchlists, replace the
  localStorage logic with API calls from the sidebar. The component is already
  structured around `onWatchlistChange`, so swapping the persistence layer is
  straightforward.
- **Alerts**: the `alerts` array in `TradingSidebar.tsx` is just placeholder
  data. Replace it with real signals by wiring up another API call or websocket
  feed.

# Watchlist Architecture

This doc describes how watchlist data flows through the app on both the server and
client. Start here when you need to modify the watchlist sidebar, scanner notes,
or the supporting APIs.

## Data Sources

1. **Authoritative watchlist** – `/api/watchlist` returns the server-side symbol
   universe from MongoDB. This is the single source of truth for the operator
   sidebar, scanner inputs, research, and automation universe.
2. **Massive snapshots** – `/api/market/watchlist` returns per-symbol snapshots
   (price, change, greeks, reference contract). The client sidebar relies on this
   for live prices and name updates.
3. **Options analytics** – the Node server calls `getMassiveOptionsSnapshot` and
   `getRecentAggregateBars` to build structured context for the watchlist report
   generator.
4. **Agent service (optional)** – when `AGENT_API_URL` is configured, the server
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
  - Hydrates the user-defined watchlist from `/api/watchlist`; no localStorage
    watchlist copy and no hardcoded symbol seed are used.
  - Accepts app-preloaded server symbols so late-mounted mobile scanner views
    render the authoritative universe immediately while the richer sidebar data
    finishes loading.
  - Calls `marketApi.getWatchlistSnapshots()` whenever the watchlist changes to
    refresh prices/names.
  - Emits `onWatchlistChange` so higher-level components can respond (for
    example, enabling manual scans in `OptionsScanner` when the list updates).

## Typical Flow

1. User adds/removes symbols in the sidebar. The component writes through
   `/api/watchlist`, reloads from the server, and fires `onWatchlistChange`.
2. The Scanner view offers a manual “Run AI scan” button, which triggers
   `/api/analysis/watchlist` and `/api/analysis/checklist` when enabled in
   Settings.
3. The server tries the agent first; when unavailable it builds snapshot notes.
4. The client renders those notes (see `OptionsScanner`) and continues polling
   `/api/market/watchlist` for price updates.

## Extending

- **New analytics**: add a helper to `watchlistReports.ts` so the agent prompt
  includes additional metrics (e.g., IV rank, unusual volume) and update the
  fallback builder accordingly.
- **Multi-user watchlists**: add user/account scoping to the server watchlist
  routes and preserve the same `onWatchlistChange` contract in the sidebar.
- **Alerts**: the current intel tab is static operator context. Replace it with
  persisted signal or news events before treating it as production alerting.

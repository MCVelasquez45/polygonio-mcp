# Vite React TypeScript Client

This SPA renders the trading experience (watchlist, chart panels, options chain,
AI features). It communicates with the Node server via REST/WebSocket calls.

## Getting Started

```bash
cd client
npm install
npm run dev
```

Navigate to `http://localhost:5173`. The dev server automatically proxies API
requests to `http://localhost:4000`.

## Environment

| Variable | Description |
| --- | --- |
| `VITE_API_URL` | Base URL for the backend (defaults to `http://localhost:4000`). |

## Architecture

- **Entry point**: `src/App.tsx` orchestrates global view state (trading vs
  scanner vs portfolio) and manages data fetching via `marketApi`.
- **Components**: grouped by domain under `src/components` (e.g.,
  `components/trading`, `components/options`, `components/layout`). Each module
  focuses on presentation and uses callbacks from `App.tsx` for data updates.
- **APIs**: `src/api` contains lightweight wrappers around REST endpoints.
- **Types**: shared TypeScript models live under `src/types`.

## Logging

- `[CLIENT]` entries in the browser console show API requests/responses and
  WebSocket activity. Useful for debugging fetch loops.

## Data Flow

1. A user selects a ticker or option contract.
2. `App.tsx` triggers API calls (aggregates, chain, watchlist, checklists).
3. Responses are cached in component state or refs to avoid redundant calls.
4. Components receive props/state updates and render charts, tables, or watchlist
   summaries accordingly.

## Trading UI quickstart

Switch to the **Trading Desk** view in the header, enter an underlying (e.g.,
`SPY`), and select a contract from the options chain. The chart, quote, and
order ticket panels will load live data as long as the backend has access to
Massive (`MASSIVE_API_KEY` set inside `server/.env`).

# Vite React TypeScript Client

## Start
```bash
cd client
npm run dev
```

## Environment

* `VITE_API_URL=http://localhost:4000`

## Logging

* `[CLIENT]` API requests and chart updates print to browser console
* `[CLIENT]` WebSocket events show real-time messages

## Trading UI

The top navigation exposes a second view called **Trading Desk** that streams Massive option data (aggregates, SMA, quotes, trades, contract detail). Enter an underlying (e.g., `SPY`), click any contract in the chain, and the chart/quote panels will load live data for that leg. Set `MASSIVE_API_KEY` in `server/.env` so `/api/market/*` endpoints respond.

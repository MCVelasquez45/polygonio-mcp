# Broker Feature

This module provides the `/api/broker` surface backed by Alpaca's REST API. All
calls currently target the paper trading base URL but can be pointed to live
endpoints via env vars in the future.

## Files

| File | Purpose |
| --- | --- |
| `broker.routes.ts` | Express router exposing `/alpaca/account`, `/alpaca/options/positions`, `/alpaca/options/orders`. Includes lightweight caching to limit Alpaca calls. |
| `services/alpaca.ts` | Minimal Alpaca REST wrapper built on the server's shared `axios` dependency; exports helper functions for paper account, clock, positions, orders, and governed options order actions. |

## Environment Variables

| Variable | Description |
| --- | --- |
| `ALPACA_API_KEY` / `ALPACA_API_SECRET` | Primary credentials. Legacy names `ALPACA_KEY_ID` / `ALPACA_SECRET_KEY` still work. |
| `ALPACA_API_BASE` | Overrides the base URL. Defaults to paper (`https://paper-api.alpaca.markets`). Set to `https://api.alpaca.markets` for live trading. |
| `ALPACA_PAPER`, `ALPACA_HTTP_TIMEOUT_MS` | Paper/live runtime assertion and REST timeout. |

## Paper vs Live

The production automation path is certified for Alpaca paper trading only.
`getAlpacaEnvironment()` exposes the paper flag and base URL without credentials
so automation can reject non-paper configuration before any broker submission.

## Error Handling

The routes log incoming payloads and responses. Exceptions fall through to the
global Express error middleware, so the UI receives consistent error messages.

## Future Enhancements

- Add stock order support through the same governed REST wrapper.
- Wire up WebSocket `trade_updates` so the client sees fills in real time.
- Harden payload validation before hitting Alpaca (e.g., using zod or yup).

# Broker Feature

This module provides the `/api/broker` surface backed by Alpaca's REST API. All
calls currently target the paper trading base URL but can be pointed to live
endpoints via env vars in the future.

## Files

| File | Purpose |
| --- | --- |
| `broker.routes.ts` | Express router exposing `/alpaca/account`, `/alpaca/options/positions`, `/alpaca/options/orders`. Includes lightweight caching to limit Alpaca calls. |
| `services/alpaca.ts` | Wrapper around `@alpacahq/alpaca-trade-api`; exports helper functions apt for both paper and (future) live usage. |

## Environment Variables

| Variable | Description |
| --- | --- |
| `ALPACA_API_KEY` / `ALPACA_API_SECRET` | Primary credentials. Legacy names `ALPACA_KEY_ID` / `ALPACA_SECRET_KEY` still work. |
| `ALPACA_API_BASE` | Overrides the base URL. Defaults to paper (`https://paper-api.alpaca.markets`). Set to `https://api.alpaca.markets` for live trading. |
| `ALPACA_DATA_BASE_URL`, `ALPACA_PAPER`, `ALPACA_DATA_FEED`, `ALPACA_OPTION_FEED` | Optional overrides passed directly to the Alpaca SDK. |

## Paper vs Live

The SDK is instantiated once per process. When it's time to support live
accounts, set `ALPACA_PAPER=false` and `ALPACA_API_BASE=https://api.alpaca.markets`.
No code changes are required—the wrapper simply points at the new base URL.

## Error Handling

The routes log incoming payloads and responses. Exceptions fall through to the
global Express error middleware, so the UI receives consistent error messages.

## Future Enhancements

- Add stock order support (using `alpaca.createOrder`).
- Wire up WebSocket `trade_updates` so the client sees fills in real time.
- Harden payload validation before hitting Alpaca (e.g., using zod or yup).

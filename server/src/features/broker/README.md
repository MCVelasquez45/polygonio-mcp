# Broker Feature

Wraps Alpaca trading endpoints:
- `broker.routes.ts`: exposes `/api/broker` routes for account, positions, and options orders.
- `services/alpaca.ts`: thin wrapper around `@alpacahq/alpaca-trade-api` for account/position data and the experimental options order endpoints.

These endpoints expect Alpaca API keys (see `docs/setup-instructions.md`).

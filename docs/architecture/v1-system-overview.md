# AI-Trader V1 System Overview

Date: July 17, 2026
Release: `v1.0.1-production-hardened`
Baseline: `v1.0-autonomous-trading`

This document summarizes the Version 1 architecture without changing execution behavior. It exists to make ownership and release boundaries clear before Version 2 work begins.

## Architecture Overview

AI-Trader is split into three runtime surfaces:

- React client in `client/` for Trading, Scanner, Portfolio, Cockpit, The Lab, and Automation Command Center.
- Express/Socket.IO gateway in `server/` for market data, broker access, automation APIs, portfolio APIs, and websocket fanout.
- Development orchestration in `dev/` for local process control, health probes, dependency ordering, and logs.

The verified V1 environment is Alpaca paper trading with Massive/Polygon market data.

## Module Responsibilities

- `server/src/features/automation`: autonomous session lifecycle, evaluation orchestration, risk gating, order intent creation, scheduler and monitor control, broker/order reconciliation, position monitoring, and recovery.
- `server/src/features/broker`: broker-facing operations outside the autonomous scheduler path.
- `server/src/features/portfolio`: portfolio visibility, active-trade cockpit enrichment, timeline, live position snapshots, and operator action endpoints.
- `server/src/features/market` and `server/src/shared/data`: Massive/Polygon REST and websocket access, caching, snapshots, entitlement-aware behavior, and provider state.
- `client/src/components/cockpit`: active-trade management workspace for one automation-owned options position.
- `client/src/components/portfolio`: portfolio management and Automation Command Center.
- `client/src/components/trading`: manual trading workspace, chart, and order ticket.
- `client/src/components/lab`: strategy research and backtest workflows.

## State Ownership

- Broker truth: Alpaca paper broker state, reconciled through broker adapters and persisted broker order models.
- Automation truth: Mongo automation sessions, events, candidates, selections, risk decisions, order intents, broker orders, and positions.
- Active cockpit quote truth: `useCockpitQuote()` consuming the shared `useLiveQuote()` store, with active-position snapshot fallback.
- Portfolio truth: portfolio APIs backed by broker/account/position records.
- Automation visibility truth: automation visibility services and shared Socket.IO client stream.

## Automation Lifecycle

1. Startup loads environment and initializes Mongo.
2. Automation recovery runs reconciliation before readiness.
3. Scheduler obtains a DB-backed lease.
4. Market/session gates verify that entries are allowed.
5. Universe evaluation records accepted and rejected opportunities.
6. Contract selection records selected and rejected contracts.
7. Risk review approves or rejects a candidate.
8. Approved entries create durable order intents.
9. Broker submission uses idempotent client order IDs.
10. Broker/order reconciliation persists broker truth.
11. Position monitor handles open positions, exits, stale orders, and recovery conditions.
12. Closed positions persist realized outcome and exit reason.

Entries fail closed when market state, data state, broker state, reconciliation state, or emergency-stop state is unsafe. Exit/recovery work remains available for owned positions.

## Execution Flow

The execution boundary is explicit:

- Evaluation and contract selection do not submit broker orders directly.
- Risk-approved candidates create order intents.
- Broker submission is controlled by automation execution settings and idempotency keys.
- Operator controls do not bypass broker reconciliation.
- Broker state is reconciled into persisted order and position records before being trusted by the UI.

## Cockpit Overview

The cockpit is not a portfolio dashboard. It is the active-trade workspace for one automation-owned options position.

The Trade Header owns:

- Contract
- Direction
- Quantity
- Entry
- Mark
- P/L
- Return
- Bid
- Ask
- Mid
- Spread

Secondary cockpit panels own:

- Live Market: quote/provider freshness, greeks, volume/open interest, and recent prints when available.
- Exit Intelligence: active exit triggers and exit proximity.
- Bot Thinking: hold rationale and exit conditions.
- Execution: broker order state, fills, retries, timeouts, and cancel status.
- Position Health: risk, theta, DTE, buying-power impact, MFE/MAE, time in trade, and exposure.
- Market Context: captured market regime and delayed-data status.
- Opportunity: captured selection attribution, winner, alternatives, and rejection reasons.

Unavailable data must be explained honestly. The cockpit must not render fake zeros, placeholders, duplicate quote stores, or conflicting values.

## Automation Command Center

The Automation Command Center is the operational control plane for:

- Session status and emergency stop.
- Watchlist and automation universe state.
- Scheduler, monitor, and recovery status.
- Risk and broker readiness.
- Operator-level recovery actions.

Engineering telemetry belongs here or behind developer diagnostics, not as dominant cockpit content.

## Logging And Observability

V1.0.1 introduces shared safe logging for request-boundary redaction and structured server logs. Logs should include:

- timestamp
- component
- module
- event
- severity
- request id, session id, or trade id when applicable
- redacted context

Secrets, credentials, authorization headers, cookies, tokens, API keys, and passwords must not be printed.

## Version 1 Freeze

After `v1.0.1-production-hardened`, Version 1 feature work is closed. Future work should target Version 2 unless it is a critical fix that preserves validated V1 behavior.

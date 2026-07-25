# ADR 007: Strategy Promotion Requires Deterministic Evidence and Human Approval

Date: 2026-07-25
Status: Accepted

## Context

The audit found partial strategy versioning and backtesting, but no complete promotion architecture. The v2 Strategy Engine requires deterministic governance before paper execution expansion.

## Decision

Strategy promotion requires deterministic evidence and human approval. Required evidence includes strategy version, feature versions, dataset versions, configuration snapshot, reproducible backtest, walk-forward validation, out-of-sample validation, naive baseline comparison, risk review, and reviewer attribution.

## Consequences

- AI and ML may propose changes but cannot promote them.
- Backtest-only success is insufficient for promotion.
- Promotion and rejection are durable events.


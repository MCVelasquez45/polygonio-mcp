# ADR 004: Massive Advanced Options Data Is the Initial Feature Boundary

Date: 2026-07-25
Status: Accepted

## Context

The platform is entitlement-limited, not capability-limited. The certified baseline uses Massive Advanced Options Market Data and intentionally avoids dependence on unauthorized premium equity real-time feeds.

## Decision

AI-Trader v2 features must be designed around the current Massive options-market entitlement boundary: options chains, contracts, quotes, trades, snapshots, greeks, implied volatility, open interest, volume, spreads, authorized aggregates, and market status.

## Consequences

- No feature may assume premium real-time equity data.
- Every feature must carry provider source, entitlement status, timestamp, freshness, calculation version, missing-data behavior, and quality status.
- Equity-derived context must be labeled delayed, snapshot, unauthorized, or derived as appropriate.


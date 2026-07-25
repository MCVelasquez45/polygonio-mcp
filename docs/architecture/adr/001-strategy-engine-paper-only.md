# ADR 001: Strategy Engine Remains Paper-Only During v2 Foundation

Date: 2026-07-25
Status: Accepted

## Context

The certified `v1.1-enterprise-baseline` is an options-first paper-trading platform. The Enterprise Strategy Engine Readiness Audit found that the platform is stable for paper trading but lacks the identity, RBAC, durable eventing, feature provenance, backtesting reproducibility, and experiment tracking required for autonomous live-money execution.

## Decision

The Strategy Engine may be designed and implemented only for simulation and paper trading during the v2 foundation. It must not be connected to live-money execution paths.

## Consequences

- Strategy contracts, signal logic, feature-store design, backtests, experiments, and paper execution may proceed.
- Live broker adapters, live order submission, and live-money automation remain prohibited.
- Any future live-money program requires a separate architecture review, security review, compliance review, runbook, and certification cycle.


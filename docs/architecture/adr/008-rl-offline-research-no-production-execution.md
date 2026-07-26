# ADR 008: Reinforcement Learning Remains Offline Research With No Production Execution Path

Date: 2026-07-25
Status: Accepted

## Context

Both the enterprise audit and NVIDIA strategy found that RL is high risk at this stage. The issue is not GPU cost; the issue is false alpha, reward hacking, overfit backtests, and weak explainability.

## Decision

Reinforcement learning remains offline, paper-only research. No RL policy may execute orders, promote strategies, alter risk rules, or participate in production execution.

## Consequences

- Learning work focuses on datasets, labels, reward candidates, experiment tracking, and human review.
- RL experiments require naive baselines and walk-forward validation.
- Any future RL-to-production discussion requires a separate ADR and certification cycle.


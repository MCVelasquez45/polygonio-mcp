# ADR 005: GPU Services Are Optional Research Infrastructure

Date: 2026-07-25
Status: Accepted

## Context

The NVIDIA Brev strategy found that the highest-value use of the owner's approximate `$25` credits is short-lived embedding, reranking, RAG, and benchmarking work. GPU infrastructure is not a cost-saver for the current hosted AI usage.

## Decision

NVIDIA Brev and other GPU services are optional research, indexing, training, and benchmarking infrastructure. They must not become required for production trading, health, execution, or operator workflows.

## Consequences

- GPU jobs must be measurable, stoppable, and documented.
- Production must continue operating when Brev is unavailable.
- Hosted AI remains in place until measurements justify migration.


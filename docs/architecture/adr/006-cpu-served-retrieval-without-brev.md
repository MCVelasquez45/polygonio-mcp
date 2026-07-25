# ADR 006: CPU-Served Retrieval Remains Available Without Brev

Date: 2026-07-25
Status: Accepted

## Context

The NVIDIA report recommends embeddings and reranking as the first useful GPU work, but only as an additive advisory capability. The GPU should index or validate, then shut down.

## Decision

AI-Trader retrieval must serve from a CPU-accessible vector store after indexing. Brev/NVIDIA GPU services may generate embeddings or rerank during batch jobs, but production retrieval must degrade gracefully when Brev is unavailable.

## Consequences

- Vector data is persisted outside the GPU instance.
- The retrieval service includes fallback behavior.
- GPU outages or shutdowns cannot break the production request path.


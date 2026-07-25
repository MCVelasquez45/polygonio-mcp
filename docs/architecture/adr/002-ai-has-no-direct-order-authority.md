# ADR 002: AI Has No Direct Order-Execution Authority

Date: 2026-07-25
Status: Accepted

## Context

AI-Trader already uses advisory AI surfaces and an agent proxy. The audit found that AI should consume evidence and assist operators, but deterministic systems must retain execution authority.

## Decision

AI may summarize, retrieve, explain, draft, and recommend. AI may not submit orders, approve risk, promote strategies, clear emergency stops, modify execution rules, or bypass deterministic gates.

## Consequences

- AI output is advisory context only.
- Order authority remains in deterministic execution gateways, broker adapters, risk gates, and human approvals.
- RAG and future learning systems must not gain direct execution privileges.


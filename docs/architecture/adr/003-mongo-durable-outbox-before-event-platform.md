# ADR 003: Mongo Durable Outbox Before Introducing Another Event Platform

Date: 2026-07-25
Status: Accepted

## Context

The current platform already uses MongoDB for application state and Socket.IO for UI fanout. The audit found that Socket.IO is not a durable system of record, but adding Kafka, NATS, or another event platform before contracts are proven would add operational complexity.

## Decision

AI-Trader v2 will begin with a Mongo-backed transactional outbox or equivalent durable event log. A larger event bus may be considered only after event schemas, replay semantics, and projector patterns are proven.

## Consequences

- Durable events can be introduced without new infrastructure.
- Replays must be side-effect safe and must not call broker/provider APIs.
- Socket.IO remains a projection/fanout layer, not the source of truth.


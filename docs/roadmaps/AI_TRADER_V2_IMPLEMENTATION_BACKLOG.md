# AI-Trader v2 Implementation Backlog

Date: 2026-07-25
Authority: `docs/architecture/AI_TRADER_V2_MASTER_ARCHITECTURE.md`
Scope: v2 foundation only. Do not implement live trading or production reinforcement learning tickets from this backlog.

## Backlog Governance

Every item must preserve the certified `v1.1-enterprise-baseline` unless explicitly approved in a future implementation sprint. Every item is paper-trading-only unless it is documentation-only. GPU services are optional research infrastructure and must not become production dependencies.

## V2-BL-001: Preserve Architecture Reports

Description: Preserve the Enterprise Strategy Engine Readiness Audit and NVIDIA Brev Enterprise Integration Strategy as local Markdown documents.

- Source requirement IDs: V2-001, V2-052
- Priority: Critical
- Dependencies: none
- Security impact: ensures recommendations are not lost; no secrets may be added
- Data impact: none
- Expected files/modules: `docs/audits/`, `docs/architecture/`
- Tests required: docs path/link validation, secret scan, `git diff --check`
- Documentation required: source report docs
- Rollback plan: revert documentation-only files
- Definition of done: both reports exist and preserve all major findings
- Allowed production behavior: none changed
- Prohibited production behavior: any runtime code/config change

## V2-BL-002: Create Architecture Decision Records

Description: Record v2 foundation decisions as ADRs, including paper-only Strategy Engine, AI authority limits, Mongo outbox, Massive entitlement boundary, optional GPU, CPU-served retrieval, human promotion, and offline-only RL.

- Source requirement IDs: V2-002, V2-004, V2-012, V2-013, V2-035, V2-036, V2-041
- Priority: Critical
- Dependencies: V2-BL-001
- Security impact: formalizes safety boundaries
- Data impact: none
- Expected files/modules: `docs/architecture/adr/`
- Tests required: docs link validation
- Documentation required: ADR index and docs README update
- Rollback plan: revert ADR docs
- Definition of done: ADRs exist and are linked from docs index
- Allowed production behavior: none changed
- Prohibited production behavior: changing execution paths

## V2-BL-003: Global Authentication Foundation

Description: Add authenticated request identity to backend routes, with staged rollout and compatibility plan.

- Source requirement IDs: V2-010, V2-021, V2-023, V2-024
- Priority: Critical
- Dependencies: V2-BL-002
- Security impact: high; establishes actor identity and account isolation
- Data impact: future records gain `actorId` and `accountId`
- Expected files/modules: future auth domain module, `server/src/index.ts`, route middleware, tests
- Tests required: unauthenticated rejection, authenticated success, identity propagation, audit attribution
- Documentation required: auth architecture, setup instructions, operator runbook
- Rollback plan: feature-flag enforcement; retain read-only access while resolving rollout issues
- Definition of done: protected state-changing routes receive actor identity
- Allowed production behavior: staged auth enforcement
- Prohibited production behavior: enabling live trading

## V2-BL-004: RBAC and Route Authorization

Description: Implement viewer, trader, operator, and administrator roles with route-level authorization.

- Source requirement IDs: V2-022, V2-023, V2-025
- Priority: Critical
- Dependencies: V2-BL-003
- Security impact: high; restricts state-changing operations
- Data impact: audit records include role and actor
- Expected files/modules: auth domain, route middleware, watchlist, broker, automation, portfolio, lab, strategy, intelligence routes
- Tests required: role matrix tests for protected routes
- Documentation required: RBAC matrix and route inventory update
- Rollback plan: feature flag per route class; no bypass for broker submissions
- Definition of done: route-level authorization enforced and tested
- Allowed production behavior: paper controls only by authorized roles
- Prohibited production behavior: granting AI or unauthenticated actors execution authority

## V2-BL-005: Durable Mongo Event Outbox

Description: Add a Mongo-backed transactional outbox/event log as the v2 system of record for strategy, signal, risk, order, position, journal, backtest, experiment, and emergency events.

- Source requirement IDs: V2-008, V2-011, V2-012
- Priority: Critical
- Dependencies: V2-BL-003
- Security impact: actor attribution and replay safety
- Data impact: new durable event collection and projector model
- Expected files/modules: future events domain module, Mongo models, projector utilities
- Tests required: event schema, idempotency, transaction/outbox writes, projector replay without external side effects
- Documentation required: event schema reference
- Rollback plan: write outbox in observe-only mode before making projections authoritative
- Definition of done: events are durable, versioned, idempotent, and replay-safe
- Allowed production behavior: event capture for paper baseline
- Prohibited production behavior: replay causing broker/API side effects

## V2-BL-006: Unified Strategy Contract

Description: Define canonical strategy contract and lifecycle across lab, strategy, automation, and future engine domains.

- Source requirement IDs: V2-002, V2-007, V2-028, V2-055
- Priority: Critical
- Dependencies: V2-BL-005
- Security impact: promotion gates and actor approval
- Data impact: strategy records gain canonical IDs, versions, lifecycle, feature requirements
- Expected files/modules: future strategy-engine domain module, existing strategy/lab models, docs
- Tests required: schema validation, lifecycle transition tests, rollback tests
- Documentation required: strategy contract reference
- Rollback plan: compatibility adapter from existing strategy/lab records
- Definition of done: new strategies can be represented without altering execution behavior
- Allowed production behavior: paper-only strategy definitions
- Prohibited production behavior: automatic live or paper execution from draft strategies

## V2-BL-007: Feature Schema and Provenance

Description: Define feature schema, versioning, data quality, provenance, freshness, entitlement status, and missing-data behavior.

- Source requirement IDs: V2-013, V2-015, V2-016, V2-017, V2-018, V2-019, V2-020
- Priority: High
- Dependencies: V2-BL-005
- Security impact: prevents misleading data claims
- Data impact: new feature definitions and feature windows
- Expected files/modules: future feature-store domain module, market-data integration docs
- Tests required: feature validation, staleness rejection, entitlement status propagation, point-in-time reads
- Documentation required: feature catalog
- Rollback plan: read-only feature projection first
- Definition of done: features can be replayed with source/timestamp/version/quality
- Allowed production behavior: paper/advisory feature recording
- Prohibited production behavior: using unauthorized equity data as live feature input

## V2-BL-008: Backtesting Reproducibility

Description: Harden backtesting around immutable datasets, feature versions, strategy versions, config snapshots, slippage/commission models, and baseline comparisons.

- Source requirement IDs: V2-026, V2-027, V2-030, V2-031, V2-032
- Priority: High
- Dependencies: V2-BL-006, V2-BL-007
- Security impact: reduces false promotion risk
- Data impact: dataset and artifact records
- Expected files/modules: future backtesting domain module, strategy backtest services, Python screener compatibility
- Tests required: deterministic replay, no look-ahead bias, dataset immutability, baseline comparison
- Documentation required: backtest methodology
- Rollback plan: run new backtesting in parallel with existing routes
- Definition of done: a backtest can be reproduced from IDs alone
- Allowed production behavior: research and paper-only evidence
- Prohibited production behavior: live promotion from backtest alone

## V2-BL-009: Experiment Tracking

Description: Add first-class experiment records with run IDs, metrics, artifacts, dataset versions, feature versions, strategy versions, seeds, and review decisions.

- Source requirement IDs: V2-029, V2-033, V2-034
- Priority: High
- Dependencies: V2-BL-008
- Security impact: promotion audit trail
- Data impact: experiment collections and artifact metadata
- Expected files/modules: future experiment-tracking domain module
- Tests required: run creation/completion, artifact references, promotion/rejection linkage
- Documentation required: experiment tracking reference
- Rollback plan: observe-only experiment capture
- Definition of done: every strategy experiment has lineage and review outcome
- Allowed production behavior: paper-only experiment recording
- Prohibited production behavior: automated promotion without human approval

## V2-BL-010: Paper-Only Execution Gates

Description: Extend explicit paper-only guards for v2 Strategy Engine integration and ensure live broker paths cannot be activated accidentally.

- Source requirement IDs: V2-002, V2-003, V2-004, V2-025
- Priority: Critical
- Dependencies: V2-BL-004, V2-BL-006
- Security impact: blocks live-money execution
- Data impact: execution events include paper/live prohibition state
- Expected files/modules: automation config, execution gateway, broker adapters, strategy engine gates
- Tests required: live config rejection, AI order rejection, strategy direct submit rejection, paper-only submission tests
- Documentation required: paper-only execution runbook
- Rollback plan: default all new v2 execution paths disabled
- Definition of done: v2 engine cannot route to live broker
- Allowed production behavior: paper-only controlled execution
- Prohibited production behavior: live-money trading

## V2-BL-011: RAG Proof of Concept

Description: Build optional advisory RAG prototype using embeddings/reranking and CPU-served vector storage, with GPU only for indexing/validation.

- Source requirement IDs: V2-036, V2-037, V2-038, V2-039, V2-040, V2-041, V2-042
- Priority: Medium
- Dependencies: V2-BL-001, V2-BL-003 for production exposure; can prototype offline earlier
- Security impact: corpus redaction and no-secret indexing required
- Data impact: vector index and corpus/index version records
- Expected files/modules: future ai-retrieval domain module, agent/orchestrator integration, docs corpus config
- Tests required: no secrets in corpus, retrieval fallback, citation/provenance, Brev-unavailable behavior
- Documentation required: retrieval architecture and operating runbook
- Rollback plan: retrieval disabled flag; hosted AI remains unchanged
- Definition of done: advisory answer can cite retrieved context and still works without Brev
- Allowed production behavior: advisory retrieval only
- Prohibited production behavior: GPU-required trading path or AI execution authority

## V2-BL-012: GPU Cost Controls

Description: Add operating runbooks/scripts/checklists for Brev GPU sessions, including price confirmation, auto-stop, shutdown verification, and experiment records.

- Source requirement IDs: V2-040, V2-042, V2-043, V2-044, V2-045, V2-046, V2-047, V2-048, V2-049, V2-050
- Priority: Medium
- Dependencies: V2-BL-011
- Security impact: prevents credential/corpus leakage and runaway spend
- Data impact: experiment cost records
- Expected files/modules: future runbook docs or scripts only unless approved
- Tests required: docs validation; optional dry-run script test
- Documentation required: Brev GPU operating procedure
- Rollback plan: delete runbook/script docs
- Definition of done: no GPU session can be run without cost and shutdown checklist
- Allowed production behavior: none
- Prohibited production behavior: persistent GPU dependency

## V2-BL-013: Test Reliability Cleanup

Description: Investigate and fix the Vitest teardown/RPC flake observed after `commandCenter.test.tsx`.

- Source requirement IDs: V2-051
- Priority: High
- Dependencies: none
- Security impact: none
- Data impact: none
- Expected files/modules: client tests/setup or affected test file
- Tests required: repeat `npm --prefix client test` multiple times
- Documentation required: test reliability note if root cause is non-obvious
- Rollback plan: revert isolated test harness change
- Definition of done: repeated client test runs exit 0 without teardown errors
- Allowed production behavior: none
- Prohibited production behavior: changing app runtime logic unless root cause requires it and is separately approved

## V2-BL-014: Documentation Drift Cleanup

Description: Correct stale references such as `VITE_API_URL`, old aggregate worker paths, and unsupported auth claims.

- Source requirement IDs: V2-052, V2-053
- Priority: Medium
- Dependencies: V2-BL-001
- Security impact: reduces operational mistakes
- Data impact: none
- Expected files/modules: `docs/`, `docker-compose.yml` if explicitly approved
- Tests required: docs link validation and config review
- Documentation required: changelog note
- Rollback plan: revert docs/config changes
- Definition of done: docs match implementation
- Allowed production behavior: docs-only unless config change is separately scoped
- Prohibited production behavior: silently changing production deployment config

## V2-BL-015: Load and Soak Test Plan

Description: Design load/soak suites for Socket.IO fanout, Massive queues, options subscriptions, automation visibility, broker reconciliation, and AI latency.

- Source requirement IDs: V2-054
- Priority: Medium
- Dependencies: V2-BL-005
- Security impact: protects availability
- Data impact: benchmark artifacts
- Expected files/modules: future test-plan docs, future test harness
- Tests required: synthetic load plan, acceptance thresholds
- Documentation required: load test plan and runbook
- Rollback plan: docs-only initial phase
- Definition of done: production-like load scenarios and metrics are defined
- Allowed production behavior: none
- Prohibited production behavior: load testing production without explicit maintenance approval

## Prohibited Backlog Categories

Do not create implementation tickets for:

- Live-money autonomous trading.
- Production RL execution.
- AI direct order submission.
- GPU-required production execution.
- Multi-account automation before identity isolation.
- Multi-position autonomous automation before explicit future design and certification.

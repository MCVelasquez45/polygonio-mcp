# AI-Trader Documentation Index

This index defines the canonical documentation hierarchy for AI-Trader after the `v1.1-enterprise-baseline` certification.

## Canonical Hierarchy

0. Enterprise release candidate (v2.0.0-enterprise): `docs/release/AI_TRADER_ENTERPRISE_RC1.md`
1. Production certification: `docs/release/PRODUCTION_CERTIFICATION.md`
2. Enterprise baseline: `docs/release/ENTERPRISE_BASELINE.md`
3. Enterprise readiness audit: `docs/audits/ENTERPRISE_STRATEGY_ENGINE_READINESS_AUDIT.md`
4. NVIDIA Brev integration strategy: `docs/architecture/NVIDIA_BREV_ENTERPRISE_INTEGRATION_STRATEGY.md`
5. AI-Trader v2 master architecture: `docs/architecture/AI_TRADER_V2_MASTER_ARCHITECTURE.md`
6. Implementation backlog: `docs/roadmaps/AI_TRADER_V2_IMPLEMENTATION_BACKLOG.md`
7. Architecture decision records: `docs/architecture/adr/`

## Authoritative v2 Planning Document

`docs/architecture/AI_TRADER_V2_MASTER_ARCHITECTURE.md` is authoritative for AI-Trader v2 planning.

When source reports, older planning documents, transcripts, runbooks, or implementation notes conflict with the master architecture, follow the master architecture unless a new ADR explicitly changes the decision.

## Architecture Decision Records

Current v2 ADRs:

- `docs/architecture/adr/001-strategy-engine-paper-only.md`
- `docs/architecture/adr/002-ai-has-no-direct-order-authority.md`
- `docs/architecture/adr/003-mongo-durable-outbox-before-event-platform.md`
- `docs/architecture/adr/004-massive-advanced-options-initial-feature-boundary.md`
- `docs/architecture/adr/005-gpu-services-optional-research-infrastructure.md`
- `docs/architecture/adr/006-cpu-served-retrieval-without-brev.md`
- `docs/architecture/adr/007-strategy-promotion-requires-evidence-and-human-approval.md`
- `docs/architecture/adr/008-rl-offline-research-no-production-execution.md`

## Documentation Governance

Future agents and contributors must:

- Read `docs/architecture/AI_TRADER_V2_MASTER_ARCHITECTURE.md` before architectural changes.
- Preserve the certified `v1.1-enterprise-baseline` unless a later release explicitly supersedes it.
- Update the traceability matrix when requirements change.
- Add or revise an ADR for consequential design decisions.
- Keep documentation and implementation in sync.
- Never silently weaken a safety, security, paper-trading, production, or entitlement gate.
- Never promote raw notes or transcripts above canonical architecture docs.
- Never commit secrets, cookies, credentials, account tokens, private login URLs, or authentication artifacts.
- Keep NVIDIA/GPU services optional and outside the required production hot path.
- Keep Strategy Engine v2 foundation paper-trading-only until a separate live-money certification exists.
- Keep AI advisory unless deterministic systems and human approvals explicitly authorize a future workflow.

## Related Existing Documentation

Useful supporting docs include:

- `docs/architecture/ENTERPRISE_GROWTH_STRATEGY.md`
- `docs/automation/execution-boundary.md`
- `docs/automation/paper-trading-operations-runbook.md`
- `docs/automation/sprint-2f-production-alignment.md`
- `docs/market-data/options-advanced-alignment-audit.md`
- `docs/market-data/options-advanced-alignment-delivery.md`
- `docs/massive/README.md`
- `docs/hardening/AUTHENTICATION_FOUNDATION.md`
- `docs/api-reference.md`

These supporting documents remain valuable, but they are not the authority for v2 architecture when they conflict with the master architecture or ADRs.

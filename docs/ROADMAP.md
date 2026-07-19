# AI-Trader Roadmap

## Version 1: Autonomous Paper Trading

Status: Complete after `v1.0.1-production-hardened`.

Scope:

- Autonomous signal evaluation.
- Risk review.
- Options contract selection.
- Alpaca paper broker submission.
- Position monitoring.
- Automated exits and recovery.
- Portfolio synchronization.
- Operator Cockpit.
- Automation Command Center.
- Production hardening and release documentation.

Version 1 is frozen after the production-hardened release. Additional feature work should move to Version 2.

## Version 2: Trading Intelligence Platform

Status: In progress. Milestones 1, 2, 3, 4, and 5 are implemented.

Guardrails:

- Do not optimize from one trade, one trading day, or anecdotal evidence.
- Treat rejected opportunities as first-class data.
- Prefer instrumentation and experiments before production threshold changes.
- Keep the AI Coach advisory only.
- Use feature flags for behavior changes.
- Preserve the validated V1 autonomous execution engine.

Milestones:

1. Trading Session Capture
2. Trade Intelligence Reports
3. Daily Intelligence Report
4. Decision Journal
5. Strategy Analytics
6. Missed Opportunity Analytics
7. AI Coach
8. Historical Intelligence Workspace

Milestone 1 through 5 implementation docs:

- `docs/V2_ARCHITECTURE.md`
- `docs/features/trading-session-capture.md`
- `docs/features/trade-intelligence-reports.md`
- `docs/features/daily-intelligence-reports.md`
- `docs/features/decision-journal.md`
- `docs/features/strategy-analytics.md`
- `docs/architecture/v2-trading-session-source-map.md`
- `docs/architecture/v2-trade-report-source-map.md`
- `docs/architecture/v2-daily-report-source-map.md`
- `docs/architecture/v2-decision-journal-source-map.md`
- `docs/architecture/v2-strategy-analytics-source-map.md`
- `docs/api/trading-intelligence-sessions.md`
- `docs/api/trading-intelligence-trades.md`
- `docs/api/trading-intelligence-daily.md`
- `docs/api/trading-intelligence-decisions.md`
- `docs/api/trading-intelligence-analytics.md`

## Live Trading Readiness Track

Status: Not started.

Required before live-money deployment:

- Production authentication and authorization.
- Environment-restricted CORS and Socket.IO origins.
- Rate limiting and security headers.
- Credential rotation confirmation.
- Live broker approval workflow.
- Expanded market calendar testing.
- Load and soak testing.
- Operator incident runbooks.
- External monitoring and alerting.
- Compliance and regulatory review.

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

Status: Planned.

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
3. Daily Trading Report
4. Decision Journal
5. Missed Opportunity Analytics
6. Strategy Analytics
7. AI Coach
8. Historical Intelligence Workspace

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

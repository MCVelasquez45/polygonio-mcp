# AI-Trader

Autonomous options-trading platform for paper-traded signal evaluation, risk review, contract selection, broker execution, position monitoring, and operator oversight.

Version 1 is the first verified autonomous trading baseline. It successfully executed, monitored, and closed Alpaca paper-trading options positions while preserving durable automation records and cockpit visibility.

## Current Release

- Baseline tag: `v1.0-autonomous-trading`
- Hardened release tag: `v1.0.1-production-hardened`
- Environment verified: Alpaca paper trading
- Current development branch: `feature/trading-intelligence-engine`

Version 1 is a paper-trading release. It is not cleared for live-money deployment until the known production blockers in the release checklist are addressed.

## Core Workspaces

- Trading: chart-first manual trading workspace and order ticket.
- Scanner: market and options discovery workflow.
- Portfolio: account-level positions, balances, orders, buying power, history, and Automation Command Center.
- Cockpit: one active automation-owned options trade, live quote state, exit strategy, execution state, and AI hold rationale.
- The Lab: strategy research and backtest workflow.
- Automation Command Center: session control, watchlist state, risk status, operational recovery, and automation health.
- Trading Intelligence: Version 2 reporting, analytics, and research layer.

## V1 Capabilities

- Autonomous signal evaluation.
- Deterministic risk review before broker submission.
- Options contract selection with selection/rejection attribution.
- Alpaca paper broker order submission through the automation execution boundary.
- Durable order intents and broker order persistence.
- Scheduler and monitor leases for duplicate-execution protection.
- Position monitoring with broker reconciliation.
- Automated exit handling, timeout cancellation, and overnight recovery.
- Cockpit active-trade display with shared quote ownership and honest unavailable states.
- Portfolio synchronization and Automation Command Center operations.
- Structured logging and request-boundary redaction.

## Safety Boundaries

Version 1 deliberately preserves these boundaries:

- Automation entries require market/session gates, clean reconciliation, and inactive emergency stop.
- Live broker configuration is rejected in the verified automation path.
- Broker reconciliation is not bypassed by cockpit or operator controls.
- Execution, risk, broker, GPT prompt, trade-evaluation, and Mongo schema behavior are frozen for the V1 release.
- The AI Coach planned for Version 2 is advisory only and must never automatically change production trading rules.

## Local Verification

Run the V1 release checks from the repository root:

```bash
npm --prefix client test
npm --prefix client run build
npm --prefix server run build
npm --prefix server run test:automation
npm run test:dev
```

Some server automation and dev-platform tests bind local ports. In restricted sandboxes they may need to run outside the sandbox.

## Documentation Map

- Architecture overview: `docs/architecture/v1-system-overview.md`
- First autonomous trade milestone: `docs/milestones/2026-07-16-first-autonomous-trade.md`
- Production hardening report: `docs/hardening/2026-07-17-v1-production-hardening.md`
- V1.0.1 release readiness checklist: `docs/releases/v1.0.1-production-hardened.md`
- Product/Figma handoff: `docs/product/figma/README.md`
- Automation lifecycle docs: `docs/automation/`
- Version history: `docs/VERSION_HISTORY.md`
- Roadmap: `docs/ROADMAP.md`
- Trading Intelligence plan: `docs/plans/trading-intelligence-engine.md`
- Trading Session Capture: `docs/features/trading-session-capture.md`
- Trade Intelligence Reports: `docs/features/trade-intelligence-reports.md`
- Daily Intelligence Reports: `docs/features/daily-intelligence-reports.md`
- Decision Journal: `docs/features/decision-journal.md`
- Strategy Analytics: `docs/features/strategy-analytics.md`

## Local Development

Install dependencies inside each package as needed:

```bash
npm --prefix client install
npm --prefix server install
npm install
```

Start the full development platform:

```bash
npm run dev
```

Common focused starts:

```bash
npm run dev:frontend
npm run dev:backend
npm run dev:trading
```

Each layer reads its own environment file. Never commit real API keys, broker credentials, database credentials, auth tokens, or local secrets.

## Release Status

Recommendation: Version 1 Complete for autonomous paper trading.

Known blockers before live trading:

- Production authentication and authorization.
- Environment-restricted CORS and Socket.IO origins.
- Rate limiting and security headers for exposed endpoints.
- Live-broker operational approval and controls.
- Credential rotation confirmation for any historical secret exposure.
- Load/soak testing for quote sockets, automation visibility, and broker recovery.
- Exchange-calendar test corpus for holidays and early closes.

## Disclaimer

AI-Trader is software for research and paper-trading automation. It does not provide financial, investment, legal, tax, or trading advice. Paper-trading results are not live-money performance. You are responsible for validating data, system behavior, broker configuration, regulatory obligations, and operational risk before relying on any output.

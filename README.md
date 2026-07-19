# AI-Trader

Autonomous options-trading platform for paper-traded signal evaluation, risk review, contract selection, broker execution, position monitoring, and operator oversight.

Version 1 is the first verified autonomous trading baseline. It successfully executed, monitored, and closed Alpaca paper-trading options positions while preserving durable automation records and cockpit visibility.

## Current Release

- Baseline tag: `v1.0-autonomous-trading`
- Hardened release tag: `v1.0.1-production-hardened`
- Environment verified: Alpaca paper trading
- Current development branch: `feature/trading-intelligence-engine`
- Current release candidate: AI-Trader V3 RC1 / PR #57

RC1 is a paper-trading release candidate. It is not cleared for live-money deployment.

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
npm --prefix server run test
npm --prefix server run test:automation
npm run test:dev
npm audit --omit=dev
git diff --check
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

## Deployment

This project deploys with native buildpacks:

- Backend: Render Node service from `server/`
- Frontend: Vercel Vite app from `client/`

Render backend:

```bash
Build command: npm install && npm run build
Start command: npm start
Health check: /health
```

Required Render environment variables by name:

- `NODE_ENV=production`
- `PORT`
- `CORS_ORIGINS`
- `FRONTEND_ORIGIN`
- `MONGO_URI` or `MONGODB_URI`
- `MASSIVE_API_KEY`
- `MASSIVE_BASE_URL`
- `MASSIVE_SUBSCRIPTION_PROFILE`
- `MASSIVE_OPTIONS_WS_URL`
- `MASSIVE_OPTIONS_WS_ENABLED`
- `MASSIVE_STOCKS_WS_ENABLED`
- `APCA_API_KEY_ID`
- `APCA_API_SECRET_KEY`
- `APCA_API_BASE_URL`
- `APCA_DATA_BASE_URL`
- `ALPACA_PAPER`
- `ALPACA_DATA_FEED`
- `ALPACA_OPTION_FEED`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `AUTH_JWT_SECRET`

Vercel frontend:

```bash
Build command: cd client && npm install && npm run build
Output directory: client/dist
```

Required Vercel environment variables by name:

- `VITE_API_URL`
- `VITE_AUTH_TOKEN` only if using the local/dev token flow
- `VITE_AUTH_ROLE` only if using the local/dev token flow

For production, `VITE_API_URL` must be the Render backend URL. Do not use a
localhost URL in Vercel. The backend `CORS_ORIGINS`/`FRONTEND_ORIGIN` values must
include the Vercel frontend origin.

## Massive Entitlement Status

The current validated Massive profile is `options-advanced`:

- Real-time options REST and options WebSocket are expected.
- Real-time stocks WebSocket is not included and is disabled by default.
- Current-day stock intraday aggregates are not authorized under this profile.
- Underlying data surfaced through options snapshots must be labeled as delayed.
- The app must never display `LIVE` for data that came from a delayed snapshot,
  stale cache, disconnected socket, or unauthorized endpoint.

## Release Status

Recommendation: RC1 targets autonomous paper-trading validation only.

Known limitations before live-money trading:

- Production authentication and authorization.
- Rate limiting and security headers for exposed endpoints.
- Live-broker operational approval and controls.
- Credential rotation confirmation for any historical secret exposure.
- Load/soak testing for quote sockets, automation visibility, and broker recovery.
- Exchange-calendar test corpus for holidays and early closes.

## Disclaimer

AI-Trader is software for research and paper-trading automation. It does not provide financial, investment, legal, tax, or trading advice. Paper-trading results are not live-money performance. You are responsible for validating data, system behavior, broker configuration, regulatory obligations, and operational risk before relying on any output.

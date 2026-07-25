# AI-Trader Enterprise Baseline

Date: 2026-07-25
Release: `v1.1-enterprise-baseline`

## Current Architecture

AI-Trader v1.1 is an options-first paper-trading platform:

- `client/`: React/Vite trading application with chart workspace, options
  matrix, order ticket, watchlist, portfolio, cockpit, automation command
  center, health dashboard, AI desk, and trading intelligence views.
- `server/`: Node/Express API for Massive market data, Socket.IO fanout, MongoDB
  persistence, automation scheduling and monitoring, governed broker execution,
  health reporting, and AI agent proxying.
- `agent/`: FastAPI advisory AI service used through the backend proxy.
- MongoDB Atlas: durable state for watchlist, automation records, intents,
  conversations, journals, reports, and operational history.
- Alpaca: paper broker truth for account, positions, clock, orders, fills, and
  reconciliation.
- Massive: market data owner for options chains, snapshots, quotes, trades,
  aggregates, greeks, IV, OI, market status, news, sentiment, and related
  context under the current entitlement profile.

## Current Massive Capabilities

The enterprise baseline maximizes the current Massive `options-advanced`
profile:

- Real-time options REST snapshots.
- Real-time options WebSocket channels for quotes and trades.
- Options aggregate support where authorized.
- Greeks, implied volatility, open interest, bid/ask, day stats, expirations,
  strikes, and contract metadata.
- Market status for session gating.
- News and sentiment context for AI workflows where available.
- Short-interest and short-volume context for equity risk framing.
- Entitlement-aware fallback for stock data, with snapshot/delayed labels.
- Shared caching, in-flight request deduplication, priority queues, endpoint
  entitlement blocks, and provider retry discipline.

The baseline does not depend on stocks WebSocket or unauthorized current-day
stock intraday aggregates.

## Current Production Health

Local baseline health and verification are green:

| Area | Status |
| --- | --- |
| Backend | GREEN |
| Mongo | GREEN |
| Socket.IO | GREEN |
| Massive | GREEN |
| Automation | GREEN |
| AI | GREEN |
| Broker | GREEN |
| Charts | GREEN |
| Health Dashboard | GREEN |
| Desktop | GREEN |
| Tablet | GREEN |
| iPhone | GREEN |
| Security audits | GREEN |
| Build | GREEN |
| Lint | GREEN |

Production health is verified after the baseline commit and
`v1.1-enterprise-baseline` tag deploy to Render and Vercel.

## Resolved Issues

- Mobile watchlist hydration race fixed. The scanner no longer shows a false
  empty universe while server watchlist hydration is pending.
- Watchlist source of truth clarified. The app now preloads `/api/watchlist` and
  passes the authoritative symbol list into late-mounted sidebar views.
- Watchlist empty/loading states corrected. Empty state appears only after the
  server response is known.
- Added watchlist hydration regression tests.
- Removed vulnerable Alpaca SDK dependency. Broker calls now use a minimal axios
  REST wrapper for the Alpaca v2 endpoints needed by the platform.
- Removed vulnerable `ts-node-dev` development dependency by moving the server
  dev runner to `tsx`.
- Tracked client and server package locks so clean CI installs are reproducible.
- Updated client build tooling to patched Vite/PostCSS releases and preserved
  the no-loopback production bundle guard under Vite 8 output.
- Serialized production Playwright against the live hosted stack to avoid
  false failures from concurrent long-polling Socket.IO browser contexts.
- Tightened production Playwright workflow coverage for real Positions,
  Automation, AI Desk, watchlist selection, top-of-book, and Time & Sales
  surfaces.
- Mobile Matrix now includes the top-of-book ladder and Time & Sales surface
  instead of only the option-chain table.
- Corrected stale client and root docs that referenced `VITE_API_URL`; standard
  production uses Vercel same-origin rewrites.

## Remaining Known Limitations

- Certified broker execution is Alpaca paper only. Live-money trading requires a
  separate approval, control, and testing cycle.
- Stocks WebSocket and current-day stock intraday aggregates are not available
  under the current Massive profile and are not production dependencies.
- AI is advisory. It does not autonomously change strategy, risk, or execution
  rules.
- Watchlists are server-backed but not yet user/account scoped.
- The sidebar intel tab still needs persisted real signal/news events before it
  can be treated as production alerting.
- Production deployment IDs are recorded in the release evidence and align to
  the tagged baseline commit.

## Enterprise Readiness

The codebase is ready to transition from production stabilization to enterprise
trading platform development. Post-deployment verification confirms the tagged
release is live on all hosted systems.

Local readiness evidence:

```text
npm run lint                         PASS
npm run build                        PASS
npm --prefix server test             PASS, 425 passed
npm --prefix client test             PASS, 138 passed
npm --prefix client run test:e2e     PASS, 31 passed / 1 skipped
npm --prefix client run test:e2e:prod configured with --workers=1
npm ci                               PASS
npm ci --prefix server               PASS
npm ci --prefix client               PASS
npm audit                            PASS, 0 vulnerabilities
npm --prefix client audit            PASS, 0 vulnerabilities
npm --prefix server audit            PASS, 0 vulnerabilities
git diff --check                     PASS
```

Production readiness evidence:

```text
GitHub Actions CI                    PASS
Render backend                       live tagged commit
Render agent                         live tagged commit
Vercel production                    live tagged commit
Backend /api/system/health           GREEN
Backend /api/agent/health            ok
Agent /health                        ok
npm --prefix client run test:e2e:prod PASS, 31 passed / 1 skipped
production console/page/network/5xx  0
```

## Future Roadmap

- User/account-scoped watchlists and workspace persistence.
- Persisted alert/event feed for watchlist intel, catalysts, unusual options
  activity, risk changes, and news.
- Expanded greeks and volatility persistence in trading intelligence reports.
- Offline flat-file ingestion for research and historical strategy analytics.
- Production load/soak suites for Socket.IO, quote cache fanout, automation
  visibility, broker reconciliation, and AI latency.
- Advanced operator dashboards for queue depth, cache health, provider blocks,
  websocket subscriptions, broker latency, AI latency, memory, CPU, and bundle
  size.
- Live-money readiness program with stronger authentication, authorization,
  approval workflows, credential rotation, compliance review, and kill-switch
  drills.

## Certification

Certification criteria:

- Local lint, build, tests, audits, and Playwright pass.
- Production Playwright passes with no console errors, page errors, network
  errors, HTTP 5xx responses, hydration failures, or responsive layout failures.
- Backend, Mongo, Socket.IO, Massive, Automation, AI, Broker, Charts, and Health
  Dashboard report green for their certified responsibilities.
- Render backend, Render agent, Vercel frontend, and GitHub reference the same
  tagged release.
- No known production blocker remains.

Certification state: certified. No known production blocker remains for the
enterprise baseline scope.

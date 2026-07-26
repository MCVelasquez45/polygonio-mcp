# AI-Trader Enterprise — Release Candidate 1 (v2.0.0-enterprise)

Release engineering report for PR #59 (`v2/autonomous-system-integration` → `main`).

- Status legend: ✅ verified · ⚠️ known limitation · ⏳ pending post-merge fill-in
- Report generated during release execution; the "Production verification" and
  "Release artifacts" sections are completed after merge + deployment.

---

## 1. Executive summary

This release promotes the AI-Trader Enterprise stack to its first production
release candidate. It layers a full enterprise intelligence pipeline —
Authentication foundation, Decision Intelligence, Event Intelligence, Strategy
Orchestrator, Enterprise Risk Engine, Trade Lifecycle Manager, Autonomous
Trading Coordinator, Learning Intelligence, System status/metrics — plus Vercel
Analytics + Speed Insights and an operator Cockpit, on top of the existing
Massive market-data and Alpaca **paper** execution platform.

The release is **additive and inert by default**: every new scheduler defaults
to auto-start OFF, autonomous trading defaults to `shadow` (submits no broker
orders), and live-money execution is structurally impossible. All new
intelligence engines are advisory/read-model layers that delegate any execution
to the single existing Execution Gateway.

Validation: `lint` ✅ · `build` ✅ · server tests **460/460** ✅ · client tests
**144/144** ✅ · CI (Vercel + build-test) ✅.

Outcome: **MERGED to `main` (PR #59), tagged `v2.0.0-enterprise`, deployed, and
verified PRODUCTION STABLE** (see §13–§15).

## 2. Architecture summary

Central wiring: `server/src/index.ts` — one Express app, one Socket.IO server,
each feature router mounted once, each scheduler with a matched start/stop pair
wired into both `start()` and `gracefulShutdown()`.

Enterprise pipeline (advisory → single execution owner):

```text
Massive → Event → Decision → Strategy → Risk → Lifecycle
        → Autonomous Coordinator → Shadow Execution or Block
        → Execution Gateway → Alpaca Paper → Evaluation → Learning
```

Ownership boundaries (verified):

- **One** Socket.IO server (`index.ts:236`); **one** Massive options-WS owner
  (`optionsSubscriptionManager.service.ts`); stocks-WS is a distinct stream,
  gated off by default. Two `MassiveWsClient` instances total, no overlap.
- **One** broker submission function, reached only via two risk-gated lanes
  (automation engine + manual gateway). Autonomous/Shadow/AI are read-models
  with no broker access. Legacy direct broker route is fail-closed (HTTP 410).
- 30 route base paths mounted once; `/api/automation` intentionally split across
  two disjoint routers; `futuresRouter` intentionally aliased (lab + engine).

## 3. Modules included

| Module | Surface | Scheduler default | Execution authority |
|---|---|---|---|
| Authentication foundation | `/api/*` identity middleware | observe mode | none |
| Decision Intelligence | `/api/decision-engine` | auto-start OFF | none (advisory) |
| Event Intelligence | `/api/event-intelligence` | auto-start OFF | none (advisory) |
| Strategy Orchestrator | `/api/strategy-orchestrator` | auto-start OFF | none (advisory) |
| Enterprise Risk Engine | `/api/risk-engine` | auto-start OFF | approve/reject only |
| Trade Lifecycle Manager | `/api/trade-lifecycle` | autostart OFF | delegates to gateway |
| Autonomous Coordinator | `/api/autonomous-trading` | coordinator OFF, mode shadow | none (read-model + shadow sim) |
| Learning Intelligence | `/api/learning` | sync OFF | none (read-only, append-only) |
| System status/metrics | `/api/system/status`, `/metrics` | n/a | none |
| Vercel Analytics + Speed Insights | React root | n/a | none |

## 4. Validation evidence

- `npm run lint` → exit 0, 0 warnings.
- `npm run build` (server `tsc` + client `vite`) → exit 0. Postbuild guard:
  "single HTTP client, single socket client, no backend/loopback origin in the
  bundle."
- `npm --prefix server test` → **460 passed / 0 failed** (includes auth,
  decision, event, strategy, risk, lifecycle, autonomous, learning suites).
- `npm --prefix client test` → **144 passed / 0 failed** (includes cockpit +
  Vercel observability suites).
- Hygiene: no conflict markers, no secrets in tracked files, no duplicate
  routes/schedulers/WS owners/HTTP clients (guards enforce singletons).

## 5. Security boundaries

- **Authentication (staged, observe mode).** `AI_TRADER_AUTH_ENFORCEMENT`
  defaults to `observe` — identity is stamped and logged, nothing is rejected.
  The production frontend does not send a bearer token, so `required` mode is
  intentionally **not** enabled for this single-operator release (enabling it
  would break the UI). Unsafe actions remain constrained by the execution
  gateway, paper-only guard, ownership leases, Risk Engine, and Emergency Stop.
  Full multi-user auth (Google/JWT sessions) is explicitly out of scope here.
- **AI has no direct order authority** (ADR-002). The coordinator only reads
  journals and summarizes; deterministic gateways are the sole submitters.
- **No live-money path.** `assertPaperConfiguration()` throws if `ALPACA_PAPER`
  is false or the live host is configured; runs at adapter construction and
  before every submit/close.

## 6. Paper-trading guarantees

- Single paper-only Alpaca client; live URL structurally blocked.
- Risk/approval gating precedes every submission on both lanes; persist-then-act
  with deterministic `client_order_id` idempotency prevents double submission.
- Autonomous entry and exit remain disabled unless explicitly enabled; shadow
  mode simulates fills and submits nothing.
- Emergency Stop blocks applicable automated actions; broker-truth freshness is
  enforced; manual trades are separate from autonomous ownership.

## 7. Deployment configuration (required)

Backend (Render) required env — canonical names (see `server/.env.example`):

```bash
NODE_ENV=production
PORT=<render-provides>
CORS_ORIGINS=https://polygonio-mcp-beryl.vercel.app
FRONTEND_ORIGIN=https://polygonio-mcp-beryl.vercel.app
MONGO_URI=<atlas-uri>            # MONGODB_URI is the compatibility fallback
MONGO_OPTIONAL=false             # fail closed on the durable-state backend
MASSIVE_API_KEY=<key>
MASSIVE_BASE_URL=https://api.massive.com
MASSIVE_SUBSCRIPTION_PROFILE=options-advanced
MASSIVE_OPTIONS_WS_ENABLED=true
MASSIVE_STOCKS_WS_ENABLED=<per-entitlement>
# Alpaca PAPER (first non-empty of each family wins):
APCA_API_KEY_ID=<paper-key>
APCA_API_SECRET_KEY=<paper-secret>
APCA_API_BASE_URL=https://paper-api.alpaca.markets
ALPACA_PAPER=true
OPENAI_API_KEY=<key>
# Enterprise engines — safe production defaults (inert):
AUTONOMOUS_TRADING_ENABLED=false
AUTONOMOUS_TRADING_MODE=shadow
AUTONOMOUS_COORDINATOR_AUTO_START=false
AUTONOMOUS_ENTRY_ENABLED=false
AUTONOMOUS_EXIT_ENABLED=false
DECISION_ENGINE_AUTO_START=false
EVENT_INTELLIGENCE_AUTO_START=false
STRATEGY_ORCHESTRATOR_AUTO_START=false
RISK_ENGINE_AUTO_START=false
TRADE_LIFECYCLE_AUTOSTART=false
LEARNING_SYNC_ENABLED=false
```

> Phantom variables removed from the examples in this release (were documented
> but never read in code): `AUTH_JWT_*`, `AUTH_DEV_*`, `MONGO_LOCAL_*`,
> `MONGO_FORCE_IPV4`, `MASSIVE_WS_EAGER_CONNECT`, `APCA_DATA_BASE_URL`,
> `ALPACA_DATA_FEED`, `ALPACA_OPTION_FEED`, `VITE_AUTH_TOKEN`, `VITE_AUTH_ROLE`.

### Render deployment checklist

- Build: `npm install && npm run build` · Start: `npm start` · Health: `/health`.
- Readiness probes: `/api/system/status`, `/api/autonomous-trading/health`.
- Graceful shutdown on SIGTERM/SIGINT (releases scheduler leases).
- Options WS start deferred 30s in production for zero-downtime rollout overlap.
- Agent service: `uvicorn api:app` (`/health` on its port).

### Vercel deployment checklist

- Framework `vite`, build `npm run build`, output `client/dist`.
- Same-origin `/api/*` + `/socket.io*` rewrites → Render backend (`vercel.json`).
- `VITE_API_BASE_URL` / `VITE_SOCKET_URL` set to the frontend's own origin (the
  build guard rejects a Render/loopback origin in the bundle).
- Analytics + Speed Insights mount exactly once at the React root.

## 8. Provider verification

### Massive
| Source | Status | Notes |
|---|---|---|
| Market status | ✅ VERIFIED_REST | `/v1/marketstatus/now`, 30s TTL |
| News / company news | ✅ VERIFIED_REST | `/v2/reference/news` w/ `insights` |
| Fed / treasury / inflation / labor | ✅ VERIFIED_REST | Massive economy endpoints |
| Options chains / snapshots / aggregates | ✅ VERIFIED_REST | via wrapper; `adjusted:true`; paginated |
| Options WebSocket | ✅ single owner | refcounted, 1000-contract cap, reconnect+backoff |
| Rate limit / cache / retry | ✅ | unified `massiveRetry`, TTL caches |
| Sentiment (`/v1/sentiment/{ticker}`) | ⚠️ BEST_EFFORT | undocumented endpoint; `.catch()`→empty (silent). Should derive from news `insights`. |
| Earnings via `/vX/reference/financials` | ⚠️ BEST_EFFORT | legacy Polygon path absent from Massive; `.catch()`→empty. Should use `/rest/stocks/fundamentals/*`. |

No duplicate Massive clients. The two BEST_EFFORT sources degrade to empty
without error and do not affect execution safety.

### Alpaca Paper — ✅ SAFE
Single paper-only client; hard paper guard; single submission owner via two
risk-gated lanes; AI/autonomous/shadow have no broker access; legacy direct
route fail-closed (410); duplicate-order protection + broker-truth freshness
enforced; manual and autonomous ownership separated.

### MongoDB — ✅ verified in production
Production `/api/system/status` reports `mongo: CONNECTED` with `automation:
READY`. Startup drops a stale `strategyversions` index and ensures market-cache
indexes. Recommendation stands to set `MONGO_OPTIONAL=false` on the durable-state
backend so a DB outage fails health loudly rather than serving DB-less.

## 9. Shadow Mode readiness — ✅

Coordinator is a read-model; shadow adapter simulates a midpoint fill with
slippage and submits no broker order. Default mode is shadow with entries/exits
disabled. Safe to observe-and-simulate during live sessions.

## 10. Manual Trading regression status

Manual trading path is independent of autonomous ownership, gated by the
execution gateway (`authorizeManualSubmission`) with fail-closed checks and an
operational kill switch (`MANUAL_TRADING_ENABLED`). Covered by broker/execution
regression suites within the 460 server tests. ⏳ Production read-path smoke
recorded post-deploy.

## 11. Rollback plan

- Pre-merge: draft PR; nothing to roll back.
- Post-merge: revert the merge commit (`git revert -m 1 <merge-sha>`) and push;
  Render + Vercel redeploy the prior build. Learning data is append-only /
  versioned (no destructive migration).
- Instant kill without revert: set `AUTONOMOUS_TRADING_MODE=off`, keep all
  `*_AUTO_START=false`, or trigger Emergency Stop in Mission Control.

## 12. Known limitations

- Massive sentiment + earnings-financials sources are BEST_EFFORT (silent empty)
  pending re-pointing to documented endpoints.
- Auth runs in observe mode for this single-operator release (documented, by
  design); full multi-user auth is future work.
- Pre-existing cross-feature circular-import web (market/automation centered) is
  tracked tech debt; not introduced or worsened by this PR; out of RC scope.
- `aggregatesWorker` interval lacks a shutdown stop (default-off worker).
- No committed `render.yaml` (infra dashboard-managed).

## 13. Production verification  ✅ (completed 2026-07-26 ~03:12–03:20 UTC)

Deploy signal: the new `/api/system/status` route flipped 404 → live after merge,
confirming the new backend rolled over; `/health` stayed 200 throughout (Render
zero-downtime, no outage).

| Check | Result |
|---|---|
| Backend `/health`, `/api/health` | ✅ 200 |
| `/api/system/status` | ✅ 503 by design (idle advisory scanners; see note) |
| `/api/system/metrics` | ✅ 200 |
| Autonomous status/health, event/strategy/risk/lifecycle/learning status | ✅ 200 |
| `/api/decision-engine/latest` | ✅ 404 by design ("no journaled scan yet") |
| **No 500 across the new endpoint surface** | ✅ |
| Frontend loads | ✅ 200 |
| Vercel Analytics + Speed Insights runtime scripts served | ✅ `/_vercel/insights/script.js` 200, `/_vercel/speed-insights/script.js` 200 |
| Same-origin `/api` routing; no backend/localhost origin in bundle | ✅ frontend `/api/health` 200; `onrender.com`/`localhost:4000` count = 0 in bundle |
| Massive REST / Options WS / Stocks WS | ✅ all HEALTHY |
| Alpaca paper account reachable; live mode impossible | ✅ `/api/broker/account` 200, ACTIVE, paper-scale balances; hard paper guard active |
| MongoDB connected; automation READY | ✅ `mongo: CONNECTED`, `automation: READY`, scheduler/monitor ACTIVE, broker-truth current |
| Stability window (~7.5 min) | ✅ uptime monotonic 194→447s (no restart), RSS flat ~117–122 MB, scheduler `[ACTIVE ACTIVE]`, no crash/rate-limit loop |

> **On the `503`/`BLOCKED` system-status rollup:** this is the route's *designed*
> response when the advisory intelligence scanners (Decision/Event/Strategy/Risk)
> report no recent run. They are intentionally **auto-start OFF** per the release
> safety posture, so the rollup is BLOCKED while the core platform (Mongo,
> automation engine, schedulers, Massive feeds, broker truth) is fully healthy.
> The Render liveness probe is `/health` (200), so this does not affect the
> deployment. Enabling the scanners is a post-release operational decision, not a
> release fix — doing so here would violate the inert-by-default safety boundary.

## 14. Release artifacts

- Final merge SHA: **`d48788ad8b0febefbbd7643865da3daeb8ed93c6`** (PR #59, merged 2026-07-26T03:10:42Z)
- Release tag: **`v2.0.0-enterprise`** → `d48788a` (annotated tag `72aa301`)
- Vercel deployment: GitHub deployment `5606891714`, environment Production, SHA
  `d48788a` — status **success** (project deployment `28DkUhwbCGmDCBtuH5MeKc7HDyNw`)
- Render backend deployment: verified **via HTTP** (new `/api/system/status`
  route live; `/health` 200; process uptime continuous). Render posts no GitHub
  status and no authenticated Render tooling is available in this environment, so
  the internal Render deployment ID could not be captured programmatically.
- Render agent deployment: agent `/health` reachable; internal deployment ID not
  obtainable via available tooling (same limitation).
- Production URLs: frontend `https://polygonio-mcp-beryl.vercel.app` · backend
  `https://polygonio-backend.onrender.com`

## 15. Final recommendation — ✅ PRODUCTION STABLE

PR #59 is merged to `main`, tagged `v2.0.0-enterprise`, and deployed. The
frontend (Vercel) and backend (Render) are live and healthy; MongoDB is
connected; Massive feeds are healthy; Alpaca paper is reachable with live-money
structurally blocked; autonomous trading runs in shadow with all enterprise
schedulers inert by default; no 500s; the process is stable across the
observation window. No rollback required. Residual items are the documented
BEST_EFFORT Massive sources and tracked pre-existing tech debt (§12) — none
production-blocking.

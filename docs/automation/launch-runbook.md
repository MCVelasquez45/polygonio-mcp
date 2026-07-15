# Watchlist-Driven Paper Automation — Launch Runbook

Operational commands for the watchlist-driven Alpaca **paper** options automation.
All paths are read-only unless noted. Secrets are never printed.

## 0. One-time launch config (`.env`, never committed)

```env
AUTOMATION_ENABLED=true
AUTOMATION_SIGNAL_MODE=OPTIONS_NATIVE_FLOW
AUTOMATION_BROKER=alpaca-paper
AUTOMATION_MAX_CONCURRENT_POSITIONS=1
MANUAL_TRADING_ENABLED=true
AUTOMATION_WATCHLIST_CACHE_TTL_MS=30000
# Armed by the operator at supervised launch (see step 4). Safe default: false.
AUTOMATION_SUBMIT_APPROVED_INTENTS=false
```
`APCA_API_BASE_URL` must be `https://paper-api.alpaca.markets/...`.

## 1. Preflight (read-only, never trades)

```bash
cd server
npm run automation:preflight          # readiness (submission-off is a warning)
npm run automation:preflight:launch   # launch mode (submission MUST be enabled)
```
Exit `0` = ready. Nonzero prints the failing checks (config, paper URL, Mongo,
watchlist provider, ≥1 automation symbol, reconciliation CLEAN, Alpaca paper
auth, broker clock, live Massive chain, scheduler config, emergency stop).

## 2. Curate the watchlist (no restart required)

```bash
# Seed a conservative launch watchlist (idempotent)
DOTENV_CONFIG_PATH=./.env node scripts/seed-launch-watchlist.mjs SPY

# Or via the API
curl -s localhost:4000/api/watchlist
curl -s -X POST localhost:4000/api/watchlist -H 'Content-Type: application/json' -d '{"symbol":"SPY","automationEnabled":true,"priority":10}'
curl -s -X POST localhost:4000/api/watchlist/SPY/automation -H 'Content-Type: application/json' -d '{"enabled":true}'
curl -s -X PATCH localhost:4000/api/watchlist/SPY -H 'Content-Type: application/json' -d '{"priority":10,"minDTE":7,"maxDTE":21,"maxSpreadPercent":8,"maxPositionSize":1}'
curl -s localhost:4000/api/watchlist/universe      # resolved automation universe
```

## 3. Startup

```bash
cd server && npm run build && npm start   # or: npm run dev
```
Watch for: Mongo connected · `RECONCILIATION_COMPLETE status=CLEAN` · `AUTOMATION_READY` ·
`SCHEDULER_STARTED` + `MONITOR_STARTED` (separate `ownerId`s) · `EVALUATION_HEARTBEAT` +
`MONITOR_HEARTBEAT` (both `ownsLease:true`).

## 4. Health / scheduler / status checks

```bash
curl -s localhost:4000/api/automation/health     # gate-by-gate readiness
curl -s localhost:4000/api/automation/scheduler   # evaluation controller state
curl -s localhost:4000/api/automation/status      # full dashboard snapshot
```
`status` shows: automationEnabled, submissionEnabled, signalMode, emergencyStop,
evaluation/monitor scheduler health + lease owners, watchlist counts + universe,
open/exiting/manualReview positions, last evaluation.

To arm submission at supervised launch: set `AUTOMATION_SUBMIT_APPROVED_INTENTS=true`
and restart (or `npm run dev` reloads). Verify `status.submissionEnabled=true`.

## 5. Broker-state inspection

```bash
curl -s localhost:4000/api/automation/status | jq '.positions'
# Alpaca paper positions/orders are reconciled at startup; unknown (non-automation)
# positions are NEVER adopted (reconciliation stays CLEAN).
```

## 6. Emergency stop / pause / resume

```bash
curl -s -X POST localhost:4000/api/automation/emergency-stop -d '{"reason":"operator"}' -H 'Content-Type: application/json'
curl -s -X POST localhost:4000/api/automation/emergency-stop/clear
```
The stop sets a **durable** session flag (survives restart). It blocks new entries
and approved-intent submission immediately; the monitoring scheduler flattens open
positions from the flag. Reconciliation and monitoring keep running.

## 7. Session report

```bash
curl -s "localhost:4000/api/automation/report?date=$(date -u +%F)"
```
Returns evaluations, outcome breakdown, approved intents, orders submitted,
positions opened/closed, realized P&L, and current open broker state.

## 8. Graceful shutdown / restart recovery

`SIGTERM`/`SIGINT` releases both scheduler leases (`SCHEDULER_STOPPED` +
`MONITOR_STOPPED`). On restart, `initializeAutomation` reconciles broker truth to
`CLEAN`, options-flow baselines and positions are durable in Mongo, and the
emergency-stop flag persists.

## Launch checklist — Wednesday 2026-07-15

- [ ] `npm run automation:preflight:launch` → exit 0
- [ ] `ALPACA_PAPER`/base URL = paper; `status.submissionEnabled` intentional
- [ ] Watchlist has 1–few liquid automation-enabled symbols (`/api/watchlist/universe`)
- [ ] Reconciliation CLEAN; no unknown positions adopted
- [ ] Both schedulers ACTIVE; both leases healthy; heartbeats current
- [ ] Emergency stop verified (activate → clear)
- [ ] Arm `AUTOMATION_SUBMIT_APPROVED_INTENTS=true`, restart, confirm status
- [ ] Observe the first legitimate paper lifecycle — do **not** force a signal.
      No qualifying signal = `NO VALID SIGNAL — SYSTEM REMAINED HEALTHY AND SAFE`.
```

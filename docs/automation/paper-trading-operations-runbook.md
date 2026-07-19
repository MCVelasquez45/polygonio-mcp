# Paper-Trading Operations Runbook

Operating the Phase 2C live paper-trading system. **Paper only** — the Alpaca
adapter refuses any live configuration, and the mock broker is refused in
production.

## Startup / restart

1. MongoDB must be connected (fail-closed gate).
2. Configuration is validated (`validateAutomationConfig`) — startup fails on
   contradictory cutoffs / non-positive stop-target-timeout / `mock` broker in
   production; warns on `EQUITY_MOMENTUM` and non-`options-advanced` profile.
3. Automation indexes are built (idempotency constraints are load-bearing).
4. Startup reconciliation runs and must not FAIL before readiness.
5. The scheduler acquires its lease and begins ticking; restart re-reconciles
   before resuming, and risk counters can be rebuilt from durable closed trades.

## Health & observability

Structured events (ISO timestamps, secrets redacted) cover: scheduler status,
market session, entry cutoff, options subscriptions, broker events, last signal,
last submission, last position mark, last reconciliation, open positions,
pending orders, daily risk utilization, flattening status. Watch
`GET /api/automation/health` and `GET /api/portfolio/operations`.

## Common procedures

- **Pause new entries:** `POST /api/portfolio/automation/pause` — monitoring and
  exits continue.
- **Resume:** `POST /api/portfolio/automation/resume` — refused unless emergency
  stop is clear, reconciliation is CLEAN, and health gates pass.
- **Emergency stop + flatten:** `POST /api/portfolio/automation/emergency-stop`
  — sets `EMERGENCY_STOPPED` and submits highest-priority exits immediately.
- **Cancel an automation order:** `POST /api/portfolio/orders/:intentId/cancel`.
- **Close an automation position:** `POST /api/portfolio/positions/:id/close`
  (durable `OPERATOR_CLOSE` EXIT intent).

## Failure modes

| Symptom | Behavior | Action |
|---|---|---|
| Massive quote stale on an open position | price exits suppressed, warning raised, entries blocked, reconciliation continues | investigate feed; position never abandoned |
| Ambiguous submit (timeout) | intent parked `SUBMITTING` for reconciliation | reconcile by `client_order_id`; never blind-retry |
| Position not confirmed closed at flatten | session paused + critical alert | manual review / next-session reconcile |
| Reconciliation not CLEAN | entries blocked (risk gate) | resolve mismatch, then resume |

## Real-paper smoke test (market hours only)

Run only during the regular session; do not force a fill or bypass risk:

```bash
# 1. Confirm the market is open (authoritative clock)
curl -s localhost:4000/api/automation/health | jq '.gates.marketClock'
# 2. Inspect the configured universe + a live evaluation
curl -s localhost:4000/api/automation/universe | jq
# 3. Observe the operational picture
curl -s localhost:4000/api/portfolio/operations | jq '.risk, .health.automationReady'
# 4. If a controlled paper order was placed, retrieve + cancel if unfilled
curl -s -X POST localhost:4000/api/portfolio/orders/<intentId>/cancel | jq
```

Never run a production smoke outside market hours.

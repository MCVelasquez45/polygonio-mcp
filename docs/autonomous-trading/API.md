# Autonomous Trading API

Base path:

```text
/api/autonomous-trading
```

All endpoints are read-only.

## GET `/status`

Purpose: operator status summary.

```bash
curl http://localhost:4000/api/autonomous-trading/status
```

```json
{
  "status": {
    "status": "Running",
    "mode": "Shadow",
    "market": "Closed",
    "broker": "Alpaca Paper",
    "modeBanner": "SHADOW MODE - No broker orders will be submitted."
  }
}
```

Failure cases: subsystem unavailable, Mongo unavailable. Required flags: none.

## GET `/current`

Purpose: current canonical pipeline record.

```bash
curl http://localhost:4000/api/autonomous-trading/current
```

```json
{
  "pipeline": {
    "pipelineId": "atp_...",
    "state": "RISK_REJECTED",
    "symbol": "OXY",
    "riskContext": { "approved": false, "reasonCodes": ["MAX_SECTOR_EXPOSURE"] }
  }
}
```

Failure cases: subsystem read failure. Required flags: none.

## GET `/active`

Purpose: active autonomous lifecycle records and automation positions.

```bash
curl http://localhost:4000/api/autonomous-trading/active
```

```json
{ "trades": [], "positions": [] }
```

Failure cases: lifecycle unavailable. Required flags: none.

## GET `/pending`

Purpose: pending lifecycle records, order intents, and current opportunity.

```bash
curl http://localhost:4000/api/autonomous-trading/pending
```

```json
{
  "current": {
    "symbol": "OXY",
    "riskStatus": "APPROVED",
    "entryStatus": "WAITING",
    "blockingReason": "MARKET_NOT_OPEN"
  }
}
```

Failure cases: Mongo unavailable. Required flags: none.

## GET `/recent-decisions`

Purpose: concise decision feed.

```bash
curl 'http://localhost:4000/api/autonomous-trading/recent-decisions?limit=10'
```

```json
{ "decisions": [{ "action": "REJECTED", "subsystem": "Risk Engine", "reason": "MAX_SECTOR_EXPOSURE" }] }
```

Failure cases: journal unavailable. Required flags: none.

## GET `/timeline`

Purpose: unified timeline across autonomous systems.

```bash
curl 'http://localhost:4000/api/autonomous-trading/timeline?limit=25'
```

```json
{ "events": [{ "event": "Risk rejected", "actor": "risk-engine", "reason": "MAX_SECTOR_EXPOSURE" }] }
```

Failure cases: journal unavailable. Required flags: none.

## GET `/metrics`

Purpose: metrics grouped by `SHADOW_SIMULATION`, `AUTONOMOUS_PAPER`, and `MANUAL_PAPER`.

```bash
curl http://localhost:4000/api/autonomous-trading/metrics
```

```json
{ "sources": [{ "source": "SHADOW_SIMULATION", "riskRejections": 1, "ordersSubmitted": 0 }] }
```

Failure cases: Mongo unavailable. Required flags: `AUTONOMOUS_METRICS_ENABLED=true` to surface in operations policy.

## GET `/health`

Purpose: single health and freshness model.

```bash
curl http://localhost:4000/api/autonomous-trading/health
```

```json
{
  "overall": "DEGRADED",
  "services": [{ "name": "Risk Engine", "status": "HEALTHY", "stale": false }]
}
```

Failure cases: subsystem health read failure. Required flags: none.

## GET `/pipeline/:pipelineId`

Purpose: fetch one persisted pipeline.

```bash
curl http://localhost:4000/api/autonomous-trading/pipeline/atp_abc123
```

```json
{ "pipeline": { "pipelineId": "atp_abc123", "timeline": [] } }
```

Failure cases: `AUTONOMOUS_PIPELINE_NOT_FOUND`. Required flags: none.


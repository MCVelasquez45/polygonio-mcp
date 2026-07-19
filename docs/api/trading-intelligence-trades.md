# Trading Intelligence Trades API

Base path:

```text
/api/intelligence
```

Read endpoints never trigger execution and never generate reports implicitly. State-changing generation/backfill endpoints are fail-closed unless `INTELLIGENCE_ADMIN_TOKEN` is configured and provided as `x-operator-token`.

## List Trade Reports

```bash
curl http://localhost:4000/api/intelligence/trades
```

Optional limit:

```bash
curl "http://localhost:4000/api/intelligence/trades?limit=25"
```

Response:

```json
{
  "reports": []
}
```

## Trade Report By ID

The ID may be a `reportId` or `tradeId`.

```bash
curl http://localhost:4000/api/intelligence/trades/trade:POSITION_ID
```

Returns:

- `200` with `{ "report": { ... } }`
- `404` with `TRADE_REPORT_NOT_FOUND`

## Trade Reports By Session

```bash
curl http://localhost:4000/api/intelligence/trades/session/paper:2026-07-16:SESSION_ID
```

Returns all reports linked to a trading session through `TradeReport.sessionId`.

## Generate One Trade Report

Admin-gated:

```bash
curl -X POST http://localhost:4000/api/intelligence/trades/POSITION_ID/generate \
  -H "x-operator-token: $INTELLIGENCE_ADMIN_TOKEN"
```

Behavior:

- Reads a closed `AutomationPosition`.
- Joins persisted evidence.
- Creates a report if none exists.
- Returns the existing report if already generated.
- Never calls a broker.
- Never changes execution state.

Responses:

- `201` when a new report is generated.
- `200` when the existing report is returned idempotently.
- `403` when admin auth is unavailable or invalid.
- `404` when the automation position is missing.
- `409` when the position is not closed or no trading session exists.

## Backfill Trade Reports By Date

Admin-gated:

```bash
curl -X POST http://localhost:4000/api/intelligence/trades/backfill/2026-07-16 \
  -H "x-operator-token: $INTELLIGENCE_ADMIN_TOKEN"
```

Preferred CLI:

```bash
npm --prefix server run intelligence:backfill-trades -- 2026-07-16
```

The backfill requires a Trading Session record for the date. It generates reports for closed trades referenced by that session.

## Report Shape

Each report includes:

- `reportId`
- `tradeId`
- `sessionId`
- `automationSessionId`
- `tradingDate`
- `identity`
- `lifecycle`
- `execution`
- `marketContext`
- `greeks`
- `signal`
- `performance`
- `grades`
- `lessons`
- `timeline`
- `evidence`
- `warnings`
- `generation`

Unavailable evidence is represented as `null` plus warnings or explanatory UI text. The API does not emit fake market values.

# Trading Intelligence Daily API

Base path:

```text
/api/intelligence
```

Read endpoints never trigger execution and never generate reports implicitly. State-changing generation/backfill endpoints are fail-closed unless `INTELLIGENCE_ADMIN_TOKEN` is configured and provided as `x-operator-token`.

## List Daily Reports

```bash
curl http://localhost:4000/api/intelligence/daily
```

Optional limit:

```bash
curl "http://localhost:4000/api/intelligence/daily?limit=25"
```

Response:

```json
{
  "reports": []
}
```

## Latest Daily Report

```bash
curl http://localhost:4000/api/intelligence/daily/latest
```

Returns:

- `200` with `{ "report": { ... } }`
- `404` with `DAILY_REPORT_NOT_FOUND`

## Daily Reports By Trading Date

```bash
curl http://localhost:4000/api/intelligence/daily/date/2026-07-16
```

Returns all Daily Reports for a trading date. Normally this is one report per Trading Session.

## Daily Report By ID

The ID may be a `reportId` or `sessionId`.

```bash
curl http://localhost:4000/api/intelligence/daily/daily:paper:2026-07-16:SESSION_ID
```

Returns:

- `200` with `{ "report": { ... } }`
- `404` with `DAILY_REPORT_NOT_FOUND`

## Generate One Daily Report

Admin-gated:

```bash
curl -X POST http://localhost:4000/api/intelligence/daily/paper:2026-07-16:SESSION_ID/generate \
  -H "x-operator-token: $INTELLIGENCE_ADMIN_TOKEN"
```

Behavior:

- Reads a persisted `TradingSession`.
- Reads linked `TradeReport` documents for the session.
- Creates one `DailyReport` if none exists.
- Returns the existing report if already generated.
- Never reads live runtime state.
- Never calls a broker.
- Never calls a market-data provider.
- Never changes execution state.

Responses:

- `201` when a new report is generated.
- `200` when the existing report is returned idempotently.
- `403` when admin auth is unavailable or invalid.
- `404` when the Trading Session is missing.

## Backfill Daily Reports By Date

Admin-gated:

```bash
curl -X POST http://localhost:4000/api/intelligence/daily/backfill/2026-07-16 \
  -H "x-operator-token: $INTELLIGENCE_ADMIN_TOKEN"
```

Preferred CLI:

```bash
npm --prefix server run intelligence:backfill-daily -- 2026-07-16
```

The backfill generates or returns Daily Reports for Trading Sessions on the requested date. It is explicit, idempotent, and safe to rerun.

## Report Shape

Each report includes:

- `reportId`
- `sessionId`
- `tradingDate`
- `environment`
- `status`
- `executiveSummary`
- `tradingSummary`
- `performance`
- `capital`
- `execution`
- `market`
- `grades`
- `evidenceQuality`
- `tradeReports`
- `tradeReportIds`
- `sessionReference`
- `timeline`
- `warnings`
- `generation`

Unavailable evidence is represented as `null`, warnings, or explanatory UI text. The API does not emit fake market values.

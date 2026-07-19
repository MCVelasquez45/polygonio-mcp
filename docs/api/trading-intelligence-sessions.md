# Trading Intelligence Sessions API

Base path:

```text
/api/intelligence
```

Read endpoints are safe and do not alter trading state. State-changing capture/finalization/backfill endpoints are fail-closed unless `INTELLIGENCE_ADMIN_TOKEN` is configured and provided as `x-operator-token`.

## List Sessions

```bash
curl http://localhost:4000/api/intelligence/sessions
```

Optional limit:

```bash
curl "http://localhost:4000/api/intelligence/sessions?limit=25"
```

Response:

```json
{
  "sessions": []
}
```

## Latest Session

```bash
curl http://localhost:4000/api/intelligence/sessions/latest
```

Returns `404` when no session has been captured.

## Sessions By Trading Date

```bash
curl http://localhost:4000/api/intelligence/sessions/date/2026-07-16
```

Trading date must be `YYYY-MM-DD`.

Malformed dates return `400`.

## Session By ID

```bash
curl http://localhost:4000/api/intelligence/sessions/paper:2026-07-16:aggregate
```

Returns `404` when the session id is not found.

## Capture Progress

Admin-gated:

```bash
curl -X POST http://localhost:4000/api/intelligence/sessions/capture \
  -H "content-type: application/json" \
  -H "x-operator-token: $INTELLIGENCE_ADMIN_TOKEN" \
  -d '{"tradingDate":"2026-07-16"}'
```

This reads persisted V1 evidence and updates a non-finalized session. It does not call the broker.

## Finalize Session

Admin-gated:

```bash
curl -X POST http://localhost:4000/api/intelligence/sessions/paper:2026-07-16:aggregate/finalize \
  -H "x-operator-token: $INTELLIGENCE_ADMIN_TOKEN"
```

Returns `409` when finalization is deferred by the gate.

## Backfill Session

Admin-gated:

```bash
curl -X POST http://localhost:4000/api/intelligence/sessions/backfill/2026-07-16 \
  -H "x-operator-token: $INTELLIGENCE_ADMIN_TOKEN"
```

Preferred CLI:

```bash
npm --prefix server run intelligence:backfill-session -- 2026-07-16
```

## Session Shape

The `session` object includes:

- `sessionId`
- `tradingDate`
- `status`
- `environment`
- `marketStatus`
- `watchlist`
- `evaluationSummary`
- `tradeSummary`
- `orderSummary`
- `portfolioSnapshot`
- `providerSummary`
- `automationHealth`
- `references`
- `warnings`
- `errors`
- `generation`

Unavailable evidence is represented as `null` and warning codes, not fake zeroes.

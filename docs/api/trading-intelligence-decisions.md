# Trading Intelligence Decisions API

Base path:

```text
/api/intelligence
```

Read endpoints never trigger execution and never backfill implicitly. The backfill endpoint is fail-closed unless `INTELLIGENCE_ADMIN_TOKEN` is configured and provided as `x-operator-token`.

## List Decision Journal Entries

```bash
curl http://localhost:4000/api/intelligence/decisions
```

Optional limit:

```bash
curl "http://localhost:4000/api/intelligence/decisions?limit=100"
```

Response:

```json
{
  "entries": []
}
```

## Decision Entry By ID

```bash
curl http://localhost:4000/api/intelligence/decisions/decision:risk:RISK_ID
```

Returns:

- `200` with `{ "entry": { ... } }`
- `404` with `DECISION_JOURNAL_ENTRY_NOT_FOUND`

## Entries By Session

```bash
curl http://localhost:4000/api/intelligence/decisions/session/paper:2026-07-16:SESSION_ID
```

Returns journal entries linked by `sessionId` or `automationSessionId`.

## Entries By Trade

```bash
curl http://localhost:4000/api/intelligence/decisions/trade/POSITION_ID
```

Returns journal entries linked to an automation position/trade.

## Backfill Decisions By Date

Admin-gated:

```bash
curl -X POST http://localhost:4000/api/intelligence/decisions/backfill/2026-07-16 \
  -H "x-operator-token: $INTELLIGENCE_ADMIN_TOKEN"
```

Preferred CLI:

```bash
npm --prefix server run intelligence:backfill-decisions -- 2026-07-16
```

Behavior:

- Reads Trading Sessions for the requested date.
- Reads persisted automation decision evidence for each session.
- Creates immutable journal entries with deterministic IDs.
- Returns existing entries idempotently.
- Never calls broker or provider APIs.
- Never changes execution state.

## Entry Shape

Each entry includes:

- `decisionId`
- `sessionId`
- `automationSessionId`
- `tradeId`
- `reportId`
- `timestamp`
- `decisionType`
- `source`
- `context`
- `evaluation`
- `inputs`
- `decision`
- `riskSnapshot`
- `executionReference`
- `evidenceQuality`
- `timeline`
- `generation`

Unavailable evidence is represented with `null`, missing-field lists, warnings, or explanatory UI text.

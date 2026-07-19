# Trading Intelligence Analytics API

Read-only analytics endpoints for Version 2 Strategy Analytics.

## Endpoints

### `GET /api/intelligence/analytics`

Returns recent analytics snapshots.

Query:

- `limit` optional, default `50`

Response:

```json
{ "analytics": [] }
```

### `GET /api/intelligence/analytics/latest`

Returns the most recent analytics snapshot.

Response:

```json
{ "analytics": {} }
```

Returns `404` when no analytics record exists.

### `GET /api/intelligence/analytics/window/:type`

Returns analytics snapshots for one window type.

Valid `:type` values:

- `DAILY`
- `WEEKLY`
- `MONTHLY`
- `ROLLING`

### `GET /api/intelligence/analytics/date/:date`

Returns analytics snapshots for a trading date.

Example:

```bash
curl http://localhost:4000/api/intelligence/analytics/date/2026-07-16
```

Returns `404` when no snapshot exists for the date.

### `POST /api/intelligence/analytics/generate`

Admin-gated generation endpoint.

Headers:

- `x-operator-token: <INTELLIGENCE_ADMIN_TOKEN>`

Body:

```json
{ "tradingDate": "2026-07-16", "windowType": "DAILY" }
```

Rules:

- idempotent
- read-only with respect to Version 1 execution state
- no broker or provider calls
- no GPT calls

## Example cURL

```bash
curl http://localhost:4000/api/intelligence/analytics
curl http://localhost:4000/api/intelligence/analytics/latest
curl http://localhost:4000/api/intelligence/analytics/window/DAILY
curl http://localhost:4000/api/intelligence/analytics/date/2026-07-16
```

## Failure Modes

- `400` for malformed dates or unsupported window types
- `403` for missing admin token on generation
- `404` when no analytics snapshot exists
- `500` for unexpected server failures

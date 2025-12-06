# Options Feature

Generates analytics and caches used by the options UI (checklist, scanner,
stored selections). It leans heavily on Massive data plus local Mongo stores.

## Files

| File | Purpose |
| --- | --- |
| `services/optionsChecklist.ts` | Builds entry checklists and persists results. Pulls sentiment (Massive + FastAPI) and technical metrics. |
| `services/watchlistReports.ts` | Summaries for the Options Scanner; uses Massive snapshots and optionally the agent service. |
| `services/optionsChainStore.ts` | Persists option chain snapshots per underlying/expiration. |
| `services/selectionStore.ts` | Remembers the last contract selection so the UI can restore context. |

## Dependencies

Shares aggregate persistence helpers from `../market/services/aggregatesStore` and
database access from `src/shared/db`. Massive client under `src/shared/data/massive`.

## Environment Variables

| Variable | Description |
| --- | --- |
| `FASTAPI_BASE_URL` / `AGENT_API_URL` | Optional. Enables sentiment/fed calendar lookups via the Python service. |
| `CHECKLIST_TTL_MS` | Cache duration before re-running a checklist (default 10 min). |
| `CHECKLIST_MINUTE_WINDOW`, `CHECKLIST_DAILY_WINDOW` | Number of bars fetched for calculations. |

## Flow

1. Checklist: load stored result → fallback to recomputing (daily/minute bars, snapshots).
2. Watchlist reports: attempt AI-enhanced summary, otherwise fallback to snapshot-based summary.
3. Chain/selection stores simply cache the latest user state to keep the UI snappy.

## Extending

When adding new scanners or analytics, reuse the aggregate helpers to reduce API
calls, and document new inputs in this README for future contributors.
